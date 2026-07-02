from __future__ import annotations
"""
Basic translation engine - 对接真实翻译API（DeepL/Google/腾讯翻译君）。

优先级：DeepL > Google Translate > 腾讯翻译君 > 内置字典（离线降级）
"""
from typing import Dict, Any, Optional
import asyncio
import logging
import hashlib
import hmac
import time
import json

import httpx

from .base import TranslationEngine

logger = logging.getLogger(__name__)

# 内置日汉字典（离线降级方案）
JA_ZH_DICT = {
    # 日常用语
    "こんにちは": "你好", "ありがとう": "谢谢", "すみません": "对不起",
    "おはよう": "早上好", "こんばんは": "晚上好", "さようなら": "再见",
    "はい": "是的", "いいえ": "不是", "お願いします": "拜托了",
    "いただきます": "我开动了", "ごちそうさま": "多谢款待",
    "大丈夫": "没关系", "すごい": "好厉害", "かわいい": "好可爱",
    "お兄ちゃん": "哥哥", "お姉ちゃん": "姐姐", "先生": "老师",
    "友達": "朋友", "好き": "喜欢", "大好き": "最喜欢",
    "待って": "等一下", "行くぞ": "上了", "やめて": "住手",
    "助けて": "救命", "信じて": "相信我", "約束": "约定",
    # 漫画常见拟声词 (50+)
    "ドドド": "轰轰轰", "ドン": "咚", "バン": "砰", "パン": "啪",
    "ガチャ": "咔嚓", "バタン": "哐当", "ガタン": "咣当",
    "ザワザワ": "嘈杂声", "ワイワイ": "喧闹声", "ガヤガヤ": "嘈杂",
    "シーン": "寂静", "ジー": "盯着", "ギロッ": "瞪眼",
    "ドキドキ": "心跳加速", "ドキッ": "怦然心动", "バクバク": "心砰砰跳",
    "キュン": "心头一紧", "ズキズキ": "阵阵刺痛", "チクチク": "刺痛",
    "ニコニコ": "笑眯眯", "ニヤニヤ": "坏笑", "ニッコリ": "莞尔一笑",
    "ゲラゲラ": "哈哈大笑", "クスクス": "窃笑", "ヘラヘラ": "傻笑",
    "ワハハ": "哇哈哈", "フフフ": "呵呵呵", "エヘヘ": "嘿嘿",
    "シクシク": "抽泣", "メソメソ": "啜泣", "ボロボロ": "泪流不止",
    "ウルウル": "泪眼汪汪", "ポロポロ": "泪珠滚落",
    "ゴゴゴ": "隆隆作响", "ズズズ": "轰轰", "ズーン": "沉重",
    "ビューン": "嗖", "シュッ": "咻", "ヒュッ": "呼",
    "スッ": "唰", "サッ": "倏地", "パッ": "忽地",
    "フワフワ": "轻飘飘", "フワッ": "飘然", "フラフラ": "摇摇晃晃",
    "グラグラ": "摇摇欲坠", "ユラユラ": "摇曳", "ブラブラ": "闲逛",
    "ペコペコ": "肚子饿", "グーグー": "咕咕叫", "ゴロゴロ": "咕噜/轰隆",
    "チラッ": "瞥一眼", "ジロジロ": "盯着看", "キョロキョロ": "东张西望",
    "ガンガン": "当当作响/头痛欲裂", "キンキン": "尖锐刺耳",
    "モグモグ": "大口咀嚼", "パクパク": "大快朵颐", "ゴクゴク": "咕咚喝下",
    "ペラペラ": "流利/翻页", "パラパラ": "翻书声", "バサバサ": "扑翼声",
    "ザーザー": "哗啦(雨)", "ポツポツ": "滴滴答答", "ピチャピチャ": "啪嗒水声",
    "ゴロゴロ": "轰隆(雷)/咕噜", "ピカッ": "闪电", "ゴロッ": "雷声",
    "メラメラ": "熊熊燃烧", "ボウボウ": "熊熊大火", "チリチリ": "焦灼",
    "ムカムカ": "怒气冲冲", "イライラ": "焦躁不安", "カッカ": "怒火中烧",
    "ウトウト": "昏昏欲睡", "スヤスヤ": "酣睡", "グッスリ": "熟睡",
    "ムクッ": "猛地起身", "ガバッ": "猛然坐起", "ハッ": "突然惊醒",
    "ウズウズ": "跃跃欲试", "ソワソワ": "坐立不安", "モジモジ": "扭扭捏捏",
    "テクテク": "步履稳健", "トボトボ": "垂头丧气地走", "スタスタ": "大步流星",
    "ダダダ": "哒哒哒(奔跑)", "タタタ": "嗒嗒嗒", "トトト": "小跑",
}

# 漫画常见拟声词 (日→英)
JA_EN_DICT = {
    # 日常用语
    "こんにちは": "Hello", "ありがとう": "Thank you", "すみません": "Excuse me",
    "おはよう": "Good morning", "こんばんは": "Good evening",
    "さようなら": "Goodbye", "はい": "Yes", "いいえ": "No",
    "お願いします": "Please", "いただきます": "Let's eat",
    "ごちそうさま": "Thanks for the meal", "大丈夫": "It's okay",
    "すごい": "Amazing", "かわいい": "Cute", "お兄ちゃん": "Big brother",
    "お姉ちゃん": "Big sister", "先生": "Teacher", "友達": "Friend",
    "好き": "I like you", "大好き": "I love you", "待って": "Wait",
    "行くぞ": "Let's go", "やめて": "Stop", "助けて": "Help",
    "信じて": "Believe me", "約束": "Promise",
    # 漫画常见拟声词 (50+)
    "ドドド": "Rumble rumble", "ドン": "Thud", "バン": "Bang", "パン": "Pop",
    "ガチャ": "Click", "バタン": "Slam", "ガタン": "Clatter",
    "ザワザワ": "Buzz", "ワイワイ": "Chatter", "シーン": "Silence",
    "ドキドキ": "Thump thump", "ドキッ": "Heart skip", "バクバク": "Pounding",
    "キュン": "Heart squeeze", "ズキズキ": "Throbbing",
    "ニコニコ": "Smiling", "ニヤニヤ": "Grinning", "ゲラゲラ": "Guffaw",
    "クスクス": "Giggle", "シクシク": "Sob", "ボロボロ": "Tears streaming",
    "ゴゴゴ": "Rumbling", "ビューン": "Whoosh", "シュッ": "Swoosh",
    "スッ": "Swiftly", "サッ": "Quickly",
    "フワフワ": "Fluffy", "フラフラ": "Staggering",
    "ペコペコ": "Starving", "グーグー": "Growling",
    "チラッ": "Glance", "ジロジロ": "Stare", "キョロキョロ": "Looking around",
    "モグモグ": "Munching", "パクパク": "Gobbling", "ゴクゴク": "Gulping",
    "ザーザー": "Pouring rain", "ポツポツ": "Dripping",
    "メラメラ": "Blazing", "ムカムカ": "Fuming", "イライラ": "Irritated",
    "ウトウト": "Dozing", "スヤスヤ": "Sleeping soundly",
    "テクテク": "Trudging", "トボトボ": "Plodding", "ダダダ": "Dashing",
}

# 语言代码映射
LANG_MAP_DEEPL = {
    "ja": "JA", "zh": "ZH", "zh-CN": "ZH", "zh-TW": "ZH",
    "en": "EN-US", "ko": "KO", "fr": "FR", "de": "DE",
    "es": "ES", "pt": "PT", "it": "IT", "ru": "RU",
}

LANG_MAP_GOOGLE = {
    "ja": "ja", "zh": "zh-CN", "zh-CN": "zh-CN", "zh-TW": "zh-TW",
    "en": "en", "ko": "ko", "fr": "fr", "de": "de",
    "es": "es", "pt": "pt", "it": "it", "ru": "ru",
}

LANG_MAP_TENCENT = {
    "ja": "ja", "zh": "zh", "zh-CN": "zh", "zh-TW": "zh-TW",
    "en": "en", "ko": "ko",
}


class BasicEngine(TranslationEngine):
    """Basic translation engine using real translation APIs."""

    _client: Optional[httpx.AsyncClient] = None

    def get_engine_name(self) -> str:
        return "basic"

    @classmethod
    async def _get_client(cls) -> httpx.AsyncClient:
        if cls._client is None or cls._client.is_closed:
            transport = httpx.AsyncHTTPTransport(retries=1)
            cls._client = httpx.AsyncClient(
                transport=transport,
                timeout=httpx.Timeout(connect=3, read=10, write=3, pool=3),
                limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
            )
        return cls._client

    async def translate(
        self,
        text: str,
        source_lang: str,
        target_lang: str,
        context: Optional[Dict[str, Any]] = None,
    ) -> str:
        """Translate using real API with dictionary fallback."""
        if not text or not text.strip():
            return text

        # 术语标记处理
        if text.startswith("{{") and text.endswith("}}"):
            return text[2:-2]

        # 先查字典（快速路径）
        dict_result = self._dict_lookup(text, source_lang, target_lang)
        if dict_result:
            return dict_result

        # 调用真实翻译 API
        api_result = await self._translate_api(text, source_lang, target_lang)
        if api_result:
            return api_result

        # 最终兜底：标记未翻译
        return self._mark(text, target_lang)

    def _dict_lookup(self, text: str, source_lang: str, target_lang: str) -> Optional[str]:
        """字典查词"""
        if source_lang == "ja" and target_lang.startswith("zh"):
            if text in JA_ZH_DICT:
                return JA_ZH_DICT[text]
        elif source_lang == "ja" and target_lang.startswith("en"):
            if text in JA_EN_DICT:
                return JA_EN_DICT[text]
        return None

    async def _translate_api(self, text: str, source_lang: str, target_lang: str) -> Optional[str]:
        """按优先级尝试各翻译 API（无 key 直接跳过）"""
        from common.core.config import settings

        # DeepL — 有 key 才调用
        if settings.DEEPL_API_KEY:
            result = await self._translate_deepl(text, source_lang, target_lang)
            if result:
                return result

        # Google — 有 key 才调用
        if settings.GOOGLE_TRANSLATE_API_KEY:
            result = await self._translate_google(text, source_lang, target_lang)
            if result:
                return result

        # 腾讯 — 有 key 才调用
        if settings.TENCENT_SECRET_ID and settings.TENCENT_SECRET_KEY:
            result = await self._translate_tencent(text, source_lang, target_lang)
            if result:
                return result

        # MyMemory 免费翻译 API（无需 key，日→中 效果好）— 终极 API 回退
        result = await self._translate_mymemory(text, source_lang, target_lang)
        if result:
            return result

        return None

    async def _translate_deepl(self, text: str, source_lang: str, target_lang: str) -> Optional[str]:
        """DeepL 翻译"""
        from common.core.config import settings

        dl_source = LANG_MAP_DEEPL.get(source_lang, source_lang.upper())
        dl_target = LANG_MAP_DEEPL.get(target_lang, target_lang.upper().split("-")[0])

        try:
            client = await self._get_client()
            response = await client.post(
                settings.DEEPL_API_URL,
                data={"text": text, "source_lang": dl_source, "target_lang": dl_target},
                headers={"Authorization": f"DeepL-Auth-Key {settings.DEEPL_API_KEY}", "Content-Type": "application/x-www-form-urlencoded"},
            )
            response.raise_for_status()
            translations = response.json().get("translations", [])
            if translations:
                return translations[0].get("text", "")
        except Exception as e:
            logger.warning(f"DeepL failed: {e}")
        return None

    async def _translate_google(self, text: str, source_lang: str, target_lang: str) -> Optional[str]:
        """Google Cloud Translation API"""
        from common.core.config import settings

        gl_source = LANG_MAP_GOOGLE.get(source_lang, source_lang)
        gl_target = LANG_MAP_GOOGLE.get(target_lang, target_lang)

        try:
            client = await self._get_client()
            url = f"https://translation.googleapis.com/language/translate/v2?key={settings.GOOGLE_TRANSLATE_API_KEY}"
            response = await client.post(url, json={"q": text, "source": gl_source, "target": gl_target, "format": "text"})
            response.raise_for_status()
            translations = response.json().get("data", {}).get("translations", [])
            if translations:
                return translations[0].get("translatedText", "")
        except Exception as e:
            logger.warning(f"Google failed: {e}")
        return None

    async def _translate_tencent(self, text: str, source_lang: str, target_lang: str) -> Optional[str]:
        """腾讯云机器翻译 API"""
        from common.core.config import settings

        tc_source = LANG_MAP_TENCENT.get(source_lang, source_lang)
        tc_target = LANG_MAP_TENCENT.get(target_lang, target_lang)

        service = "tmt"
        host = "tmt.tencentcloudapi.com"
        endpoint = f"https://{host}"
        action = "TextTranslate"
        version = "2018-03-21"
        region = settings.TENCENT_TMT_REGION
        timestamp = int(time.time())
        date = time.strftime("%Y-%m-%d", time.gmtime(timestamp))

        payload = json.dumps({"SourceText": text, "Source": tc_source, "Target": tc_target, "ProjectId": 0})

        canonical_headers = f"content-type:application/json; charset=utf-8\nhost:{host}\n"
        signed_headers = "content-type;host"
        hashed_payload = hashlib.sha256(payload.encode("utf-8")).hexdigest()
        canonical_request = f"POST\n/\n\n{canonical_headers}\n{signed_headers}\n{hashed_payload}"
        credential_scope = f"{date}/{service}/tc3_request"
        string_to_sign = f"TC3-HMAC-SHA256\n{timestamp}\n{credential_scope}\n{hashlib.sha256(canonical_request.encode('utf-8')).hexdigest()}"

        def _sign(key, msg):
            return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()

        secret_date = _sign(("TC3" + settings.TENCENT_SECRET_KEY).encode("utf-8"), date)
        secret_service = _sign(secret_date, service)
        secret_signing = _sign(secret_service, "tc3_request")
        signature = hmac.new(secret_signing, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()

        authorization = f"TC3-HMAC-SHA256 Credential={settings.TENCENT_SECRET_ID}/{credential_scope}, SignedHeaders={signed_headers}, Signature={signature}"

        try:
            client = await self._get_client()
            response = await client.post(
                endpoint,
                content=payload,
                headers={
                    "Authorization": authorization,
                    "Content-Type": "application/json; charset=utf-8",
                    "Host": host,
                    "X-TC-Action": action,
                    "X-TC-Version": version,
                    "X-TC-Timestamp": str(timestamp),
                    "X-TC-Region": region,
                },
            )
            response.raise_for_status()
            resp = response.json().get("Response", {})
            if resp.get("Error"):
                logger.warning(f"Tencent error: {resp['Error']}")
                return None
            return resp.get("TargetText", "")
        except Exception as e:
            logger.warning(f"Tencent failed: {e}")
        return None

    async def _translate_mymemory(self, text: str, source_lang: str, target_lang: str) -> Optional[str]:
        """MyMemory 免费翻译 API（无需 API Key，每个 IP 每天1000字符限制）。
        
        支持语言对：日→中 (ja|zh-CN), 日→英 (ja|en) 等。
        返回译文或 None（失败时）。
        """
        # 语言代码映射：MyMemory 使用 ISO 639-1
        mm_source = source_lang[:2] if source_lang else "ja"
        mm_target = target_lang[:2] if target_lang else "zh"
        # 修正常见映射
        lang_fix = {"ja": "ja", "zh": "zh-CN", "ko": "ko", "en": "en", "fr": "fr", "es": "es"}
        mm_source = lang_fix.get(mm_source, mm_source)
        mm_target = lang_fix.get(mm_target, mm_target)

        try:
            client = await self._get_client()
            response = await client.get(
                "https://api.mymemory.translated.net/get",
                params={
                    "q": text,
                    "langpair": f"{mm_source}|{mm_target}",
                },
                timeout=8.0,
            )
            response.raise_for_status()
            data = response.json()
            match = data.get("responseData", {}).get("translatedText", "")
            if match and match != text:  # 确保译文不等于源文
                return match
        except Exception as e:
            logger.debug(f"MyMemory failed: {e}")
        return None

    def _mark(self, text: str, target_lang: str) -> str:
        """标记未翻译的文本"""
        if target_lang.startswith("zh"):
            return f"【{text}】"
        return f"[{text}]"
