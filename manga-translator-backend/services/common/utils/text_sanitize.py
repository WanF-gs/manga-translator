from __future__ import annotations
"""OCR / 翻译文本校验与清洗 — 防止损坏输入导致服务挂死"""
import re
import unicodedata
from typing import Tuple

# 单区域 OCR 最大字符数（漫画气泡通常 <200 字）
MAX_OCR_TEXT_LENGTH = 500
# 翻译单区域最大字符数
MAX_TRANSLATION_TEXT_LENGTH = 2000


def _fullwidth_to_halfwidth(text: str) -> str:
    """全角拉丁字母/数字/标点 → 半角，保留日文假名和CJK汉字不变"""
    result = []
    for ch in text:
        cp = ord(ch)
        # 全角ASCII范围 0xFF01-0xFF5E → 半角 0x0021-0x007E
        if 0xFF01 <= cp <= 0xFF5E:
            result.append(chr(cp - 0xFEE0))
        # 全角空格
        elif cp == 0x3000:
            result.append(' ')
        else:
            result.append(ch)
    return ''.join(result)


def sanitize_ocr_text(text: str) -> str:
    """清洗 OCR 输出，剔除损坏/超长/无意义文本"""
    if not text:
        return ""
    text = text.strip()
    if not text:
        return ""

    # 全角→半角转换（拉丁字母/数字/标点），保留日文假名和汉字
    text = _fullwidth_to_halfwidth(text)

    if len(text) > MAX_OCR_TEXT_LENGTH:
        text = text[:MAX_OCR_TEXT_LENGTH]

    # 纯 bracket/标点垃圾（如 Tesseract 噪点误识别）
    meaningful = re.sub(r"[\s\{\}\[\]()（）「」『』…・。、，,.!?！？\-_=+|\\/:;\"'`~@#$%^&*]", "", text)
    if not meaningful:
        return ""

    # 单一字符占比过高（如 488M 个 '{'）
    if len(text) >= 8:
        from collections import Counter
        char, count = Counter(text).most_common(1)[0]
        if count / len(text) > 0.75:
            return ""

    # bracket 字符占比过高
    bracket_count = text.count("{") + text.count("}") + text.count("[") + text.count("]")
    if len(text) >= 4 and bracket_count / len(text) > 0.5:
        return ""

    return text


def validate_translation_source(text: str) -> Tuple[bool, str]:
    """校验待翻译原文，返回 (是否有效, 原因)"""
    if not text or not text.strip():
        return False, "empty"
    if len(text) > MAX_TRANSLATION_TEXT_LENGTH:
        return False, "too_long"
    meaningful = re.sub(r"[\s\{\}\[\]()（）「」『』…・。、，,.!?！？\-_=+|\\/:;\"'`~@#$%^&*]", "", text)
    if not meaningful:
        return False, "garbage"
    if len(text) >= 8:
        from collections import Counter
        _, count = Counter(text).most_common(1)[0]
        if count / len(text) > 0.75:
            return False, "repetitive"
    bracket_ratio = (text.count("{") + text.count("}")) / len(text)
    if bracket_ratio > 0.5:
        return False, "bracket_garbage"

    lines = [l.strip() for l in text.strip().split('\n') if l.strip()]
    if lines:
        short_lines = sum(1 for l in lines if len(l) <= 2)
        if len(lines) >= 3 and short_lines / len(lines) > 0.6:
            return False, "fragmented_ocr_noise"

    has_cjk = any('\u4e00' <= c <= '\u9FFF' for c in text)
    has_latin = any('A' <= c <= 'z' for c in text)

    if has_cjk and has_latin:
        stripped = re.sub(r'[\s\d]', '', text)
        cjk_count = sum(1 for c in stripped if '\u4e00' <= c <= '\u9FFF')
        if len(stripped) > 0 and cjk_count / len(stripped) < 0.5:
            return False, "mixed_script_noise"

    if has_latin and not has_cjk:
        word_count = len(re.findall(r'[A-Za-z]+', text))
        line_count = len(lines)
        if line_count > 3 and word_count < line_count * 0.3:
            return False, "ocr_noise"

    return True, "ok"
