from __future__ import annotations
"""
词典与假名标注服务 — PRD §2.7.3 假名/罗马音标注 + §2.7.4 单词即点即译

能力：
  1. lookup(word, lang)   — 单词查询：释义、词性、例句（多级：内置词典 → LLM → 翻译API）
  2. annotate(text, lang) — 为日文文本生成振假名(furigana)与罗马音(romaji)标注

设计原则：graceful degradation —
  · pykakasi/jaconv 可用时提供高质量假名/罗马音；不可用时降级为规则转换。
  · LLM key 存在时用 LLM 补全释义/例句；否则回退内置小词典 + 翻译API。
"""
import logging
import os
import re
from functools import lru_cache
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

# 内置高频漫画词汇小词典（离线兜底，覆盖阅读器最常点击的词）
# 格式: word -> {reading(平假名), romaji, pos(词性), definitions[], examples[]}
_BUILTIN_JA: Dict[str, Dict[str, Any]] = {
    "先輩": {"reading": "せんぱい", "pos": "名词", "definitions": ["前辈；学长/学姐"],
             "examples": [{"ja": "先輩、おはようございます。", "zh": "前辈，早上好。"}]},
    "馬鹿": {"reading": "ばか", "pos": "名词/形容动词", "definitions": ["笨蛋；傻瓜"],
             "examples": [{"ja": "この馬鹿！", "zh": "你这个笨蛋！"}]},
    "可愛い": {"reading": "かわいい", "pos": "形容词", "definitions": ["可爱的"],
              "examples": [{"ja": "猫が可愛い。", "zh": "猫很可爱。"}]},
    "大丈夫": {"reading": "だいじょうぶ", "pos": "形容动词", "definitions": ["没问题；不要紧"],
              "examples": [{"ja": "大丈夫ですか？", "zh": "你没事吧？"}]},
    "ありがとう": {"reading": "ありがとう", "pos": "感叹词", "definitions": ["谢谢"],
                 "examples": [{"ja": "本当にありがとう。", "zh": "真的谢谢你。"}]},
    "友達": {"reading": "ともだち", "pos": "名词", "definitions": ["朋友"],
             "examples": [{"ja": "友達と遊ぶ。", "zh": "和朋友玩。"}]},
    "戦う": {"reading": "たたかう", "pos": "动词", "definitions": ["战斗；对抗"],
             "examples": [{"ja": "敵と戦う。", "zh": "与敌人战斗。"}]},
    "諦める": {"reading": "あきらめる", "pos": "动词", "definitions": ["放弃；死心"],
              "examples": [{"ja": "諦めないで。", "zh": "别放弃。"}]},
}


# ============================================================
# 假名 / 罗马音 转换
# ============================================================

@lru_cache(maxsize=1)
def _get_kakasi():
    """惰性加载 pykakasi 转换器；不可用时返回 None。"""
    try:
        import pykakasi
        return pykakasi.kakasi()
    except Exception as e:  # pragma: no cover - 依赖缺失时降级
        logger.info(f"pykakasi unavailable, furigana falls back to rule-based: {e}")
        return None


# 平假名 → 罗马音 的最小规则表（pykakasi 不可用时兜底）
_KANA_ROMAJI = {
    "あ": "a", "い": "i", "う": "u", "え": "e", "お": "o",
    "か": "ka", "き": "ki", "く": "ku", "け": "ke", "こ": "ko",
    "さ": "sa", "し": "shi", "す": "su", "せ": "se", "そ": "so",
    "た": "ta", "ち": "chi", "つ": "tsu", "て": "te", "と": "to",
    "な": "na", "に": "ni", "ぬ": "nu", "ね": "ne", "の": "no",
    "は": "ha", "ひ": "hi", "ふ": "fu", "へ": "he", "ほ": "ho",
    "ま": "ma", "み": "mi", "む": "mu", "め": "me", "も": "mo",
    "や": "ya", "ゆ": "yu", "よ": "yo",
    "ら": "ra", "り": "ri", "る": "ru", "れ": "re", "ろ": "ro",
    "わ": "wa", "を": "wo", "ん": "n",
    "が": "ga", "ぎ": "gi", "ぐ": "gu", "げ": "ge", "ご": "go",
    "ざ": "za", "じ": "ji", "ず": "zu", "ぜ": "ze", "ぞ": "zo",
    "だ": "da", "ぢ": "ji", "づ": "zu", "で": "de", "ど": "do",
    "ば": "ba", "び": "bi", "ぶ": "bu", "べ": "be", "ぼ": "bo",
    "ぱ": "pa", "ぴ": "pi", "ぷ": "pu", "ぺ": "pe", "ぽ": "po",
    "ー": "-",
}


def _kana_to_romaji_fallback(kana: str) -> str:
    return "".join(_KANA_ROMAJI.get(ch, ch) for ch in kana)


def annotate_japanese(text: str) -> Dict[str, Any]:
    """
    为日文文本生成振假名与罗马音标注。

    Returns:
        {
          "text": 原文,
          "romaji": 整句罗马音,
          "tokens": [{"surface": 词面, "reading": 假名读音, "romaji": 罗马音}]
        }
    tokens 中只对含汉字的词给出振假名（reading != surface）。
    """
    if not text:
        return {"text": text, "romaji": "", "tokens": []}

    kks = _get_kakasi()
    tokens: List[Dict[str, str]] = []
    romaji_parts: List[str] = []

    if kks is not None:
        try:
            for item in kks.convert(text):
                surface = item.get("orig", "")
                hira = item.get("hira", surface)
                roma = item.get("hepburn", "") or _kana_to_romaji_fallback(hira)
                tokens.append({"surface": surface, "reading": hira, "romaji": roma})
                if roma:
                    romaji_parts.append(roma)
            return {
                "text": text,
                "romaji": " ".join(romaji_parts).strip(),
                "tokens": tokens,
            }
        except Exception as e:
            logger.warning(f"pykakasi convert failed, fallback: {e}")

    # 规则降级：按假名逐字转罗马音，汉字保留原样（无读音）
    for ch in text:
        roma = _KANA_ROMAJI.get(ch, "")
        tokens.append({"surface": ch, "reading": ch if roma else "", "romaji": roma})
        if roma:
            romaji_parts.append(roma)
    return {"text": text, "romaji": "".join(romaji_parts), "tokens": tokens}


# ============================================================
# 单词查询
# ============================================================

_JISHO_API = "https://jisho.org/api/v1/search/words"


async def _lookup_jisho(word: str) -> Optional[Dict[str, Any]]:
    """查询 Jisho.org 公开 API（JMdict 数据）。失败返回 None。"""
    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            r = await client.get(_JISHO_API, params={"keyword": word})
            r.raise_for_status()
            data = r.json().get("data", [])
            if not data:
                return None
            first = data[0]
            japanese = first.get("japanese", [{}])[0]
            reading = japanese.get("reading", "")
            senses = first.get("senses", [])
            definitions: List[str] = []
            pos: List[str] = []
            for s in senses[:3]:
                definitions.extend(s.get("english_definitions", []))
                pos.extend(s.get("parts_of_speech", []))
            return {
                "word": word,
                "reading": reading,
                "romaji": _kana_to_romaji_fallback(reading) if reading else "",
                "pos": ", ".join(dict.fromkeys(pos)) if pos else "",
                "definitions": definitions[:5],
                "examples": [],
                "source": "jisho",
            }
    except Exception as e:
        logger.info(f"Jisho lookup failed for {word}: {e}")
        return None


async def _lookup_llm(word: str, lang: str) -> Optional[Dict[str, Any]]:
    """用 LLM 补全释义/词性/例句（需 OPENAI_API_KEY / DEEPSEEK_API_KEY）。"""
    api_key = os.getenv("OPENAI_API_KEY") or os.getenv("DEEPSEEK_API_KEY")
    if not api_key:
        return None
    base = os.getenv("OPENAI_BASE_URL") or (
        "https://api.deepseek.com/v1" if os.getenv("DEEPSEEK_API_KEY") else "https://api.openai.com/v1"
    )
    model = os.getenv("DICT_LLM_MODEL", "deepseek-chat" if os.getenv("DEEPSEEK_API_KEY") else "gpt-4o-mini")
    lang_name = {"ja": "日语", "en": "英语", "ko": "韩语"}.get(lang, "外语")
    prompt = (
        f"你是词典助手。请解释{lang_name}单词「{word}」，用简体中文输出严格 JSON："
        '{"reading":"假名或音标","pos":"词性","definitions":["释义1","释义2"],'
        '"examples":[{"src":"原文例句","zh":"中文翻译"}]}。只输出 JSON。'
    )
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.post(
                f"{base}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.3,
                    "response_format": {"type": "json_object"},
                },
            )
            r.raise_for_status()
            import json
            content = r.json()["choices"][0]["message"]["content"]
            parsed = json.loads(content)
            reading = parsed.get("reading", "")
            return {
                "word": word,
                "reading": reading,
                "romaji": _kana_to_romaji_fallback(reading) if lang == "ja" and reading else "",
                "pos": parsed.get("pos", ""),
                "definitions": parsed.get("definitions", [])[:5],
                "examples": [
                    {"ja": ex.get("src", ""), "zh": ex.get("zh", "")}
                    for ex in parsed.get("examples", [])[:3]
                ],
                "source": "llm",
            }
    except Exception as e:
        logger.info(f"LLM lookup failed for {word}: {e}")
        return None


async def lookup_word(word: str, lang: str = "ja") -> Dict[str, Any]:
    """
    单词查询（多级回退）：内置词典 → Jisho(日语) → LLM。
    始终返回结构化结果（即使只有假名标注），不抛异常。
    """
    word = (word or "").strip()
    if not word:
        return {"word": word, "reading": "", "romaji": "", "pos": "", "definitions": [], "examples": [], "source": "empty"}

    # 1) 内置词典（精确命中）
    if lang == "ja" and word in _BUILTIN_JA:
        e = _BUILTIN_JA[word]
        return {
            "word": word,
            "reading": e["reading"],
            "romaji": _kana_to_romaji_fallback(e["reading"]),
            "pos": e["pos"],
            "definitions": e["definitions"],
            "examples": e["examples"],
            "source": "builtin",
        }

    # 2) 日语：Jisho（JMdict）
    if lang == "ja":
        jisho = await _lookup_jisho(word)
        if jisho and jisho["definitions"]:
            # 若无罗马音，补一个句级假名标注
            if not jisho.get("reading"):
                ann = annotate_japanese(word)
                jisho["reading"] = "".join(t["reading"] for t in ann["tokens"])
                jisho["romaji"] = ann["romaji"]
            return jisho

    # 3) LLM 兜底（含英/韩）
    llm = await _lookup_llm(word, lang)
    if llm and llm["definitions"]:
        return llm

    # 4) 最终兜底：至少给出假名/罗马音标注（日语），保证前端有内容展示
    if lang == "ja":
        ann = annotate_japanese(word)
        return {
            "word": word,
            "reading": "".join(t["reading"] for t in ann["tokens"]),
            "romaji": ann["romaji"],
            "pos": "",
            "definitions": [],
            "examples": [],
            "source": "annotate_only",
            "message": "未找到释义，仅提供读音标注",
        }
    return {
        "word": word, "reading": "", "romaji": "", "pos": "",
        "definitions": [], "examples": [], "source": "not_found",
        "message": "未找到该词条",
    }
