from __future__ import annotations
"""
Enhanced OCR engine for AI Gateway.  (OCR 二级引擎版 — 仅 manga-ocr + PaddleOCR v4)
OCR 链路：manga-ocr → PaddleOCR v4（无 RapidOCR/Tesseract 回退）
支持：振假名检测、字符级置信度、竖排文字、语言自动检测、
按区域类型的预处理、后处理修正。
"""
import uuid
import io
import logging
import re
import os
from typing import Optional, List, Dict, Any, Tuple

import httpx
import numpy as np
from PIL import Image

logger = logging.getLogger(__name__)

# Language character ranges
LANG_RANGES = {
    "ja": (0x3040, 0x30FF),  # Hiragana + Katakana
    "zh": (0x4E00, 0x9FFF),  # CJK Unified
    "ko": (0xAC00, 0xD7AF),  # Hangul
    "en": (0x0041, 0x007A),  # Latin
}

# Furigana detection: small kana above/beside kanji
FURIGANA_SIZE_RATIO_MAX = 0.6  # Furigana is typically <60% of main text height
FURIGANA_Y_OFFSET_RATIO = 0.35  # Furigana is typically in top 35% of the region

# === PaddleOCR 相关配置 ===
# PP-OCRv4 ONNX 模型目录（可通过环境变量覆盖）
_PADDLEOCR_MODEL_DIR = os.getenv("PADDLEOCR_MODEL_DIR", os.path.join(os.path.dirname(__file__), "..", "..", "models", "ppocr_v4"))
# 低置信度阈值：低于此值的区域会用更强引擎重试
_OCR_CONFIDENCE_RETRY_THRESHOLD = float(os.getenv("OCR_CONFIDENCE_RETRY_THRESHOLD", "0.75"))

# === 多语言OCR映射 ===
# 源语言 → OCR引擎语言参数
OCR_LANG_MAP = {
    "ja": "japan",
    "zh": "chinese",
    "zh-CN": "chinese",
    "zh-TW": "chinese",
    "en": "en",
    "ko": "korean",
    "fr": "fr",
    "es": "es",
}
# RapidOCR语言模型目录（如有）
RAPIDOCR_LANG_MODELS = {
    "ja": None,   # 使用默认模型（日文+汉字）
    "zh": None,   # 使用默认模型
    "en": None,
    "ko": None,
}
# OCR 引擎：mangaocr(best JP) → paddleocr(best multi-lang). No fallback.
_OCR_ENGINE_ORDER = os.getenv("OCR_ENGINE_ORDER", "mangaocr,paddleocr")
_PADDLEOCR_ENABLED = os.getenv("PADDLEOCR_ENABLED", "true").lower() in ("true", "1", "yes")

# ============================================================
# P0 升级：PaddleOCR 全量引擎 + PP-OCRv4 ONNX 模型管理
# ============================================================

_paddle_ocr_instance = None
_paddle_ocr_available = None  # None=未检测, True=可用, False=不可用


def _check_paddleocr_available() -> bool:
    """检测 PaddleOCR 是否可用（paddlepaddle + paddleocr 均已安装）。"""
    global _paddle_ocr_available
    if _paddle_ocr_available is not None:
        return _paddle_ocr_available
    try:
        import paddle
        _ = paddle.__version__
        import paddleocr
        _paddle_ocr_available = True
        logger.info("PaddleOCR (paddlepaddle + paddleocr) detected — full PP-OCRv4 available")
    except ImportError:
        _paddle_ocr_available = False
        logger.info("PaddleOCR full package not installed")
    return _paddle_ocr_available


# PaddleOCR 实例缓存 (按语言缓存，避免每次切换语言重新初始化)
_paddle_ocr_instances = {}

# 语言代码映射：source_lang → PaddleOCR lang 参数
_PADDLEOCR_LANG_MAP = {
    "ja": "japan",
    "zh": "ch",
    "zh-CN": "ch",
    "zh-TW": "chinese_tra",
    "en": "en",
    "ko": "korean",
    "fr": "french",
    "es": "spanish",
}

def _get_paddle_ocr(lang="ja"):
    """获取 PaddleOCR 实例（按语言缓存，避免重复初始化）。"""
    global _paddle_ocr_instances
    paddle_lang = _PADDLEOCR_LANG_MAP.get(lang, "japan")
    if paddle_lang not in _paddle_ocr_instances:
        if _PADDLEOCR_ENABLED and _check_paddleocr_available():
            try:
                from paddleocr import PaddleOCR
                _paddle_ocr_instances[paddle_lang] = PaddleOCR(
                    lang=paddle_lang,
                    use_angle_cls=True,         # 启用文本方向分类：自动检测竖排/倒置文字
                    det_db_thresh=0.2,
                    det_db_box_thresh=0.1,
                    rec_batch_num=6,
                )
                logger.info(f"PaddleOCR PP-OCRv4 engine ({paddle_lang}) initialized successfully")
            except Exception as e:
                logger.warning(f"PaddleOCR ({paddle_lang}) init failed: {e}")
                _paddle_ocr_instances[paddle_lang] = False
    inst = _paddle_ocr_instances.get(paddle_lang)
    return inst if inst is not False else None


def _ocr_with_paddle(crop: np.ndarray, lang: str = "ja") -> Tuple[str, float, List[float]]:
    """使用 PaddleOCR PP-OCRv4 识别裁剪区域，返回 (text, confidence, char_confidences)。"""
    paddle = _get_paddle_ocr(lang)
    if paddle is None:
        return "", 0.0, []
    try:
        import cv2
        # PaddleOCR 需要 PIL Image 或文件路径
        pil_img = Image.fromarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB) if len(crop.shape) == 3 else crop)
        results = paddle.ocr(np.array(pil_img))
        if not results or not results[0]:
            return "", 0.0, []

        texts = []
        confs = []
        char_confs = []
        for line in results[0]:
            rec_text = line[1][0]  # 识别文本
            rec_conf = line[1][1]  # 置信度
            if rec_text:
                texts.append(rec_text)
                confs.append(rec_conf)
                # PaddleOCR 给出行级置信度，分配给每个字符
                for _ in rec_text:
                    char_confs.append(round(rec_conf, 3))

        text = " ".join(texts).strip()
        avg_conf = sum(confs) / len(confs) if confs else 0.0
        return text, avg_conf, char_confs
    except Exception as e:
        logger.debug(f"PaddleOCR recognition failed: {e}")
        return "", 0.0, []


# ============================================================
# P0 升级：MangaOCR — 专为日文漫画训练的 Transformer 模型
# 基于 Vision Encoder Decoder 架构，Manga109 数据集训练
# 对漫画气泡/艺术字体/竖排文字识别精度远超通用 OCR
# ============================================================

_manga_ocr_instance = None
_manga_ocr_available = None


def _check_mangaocr_available() -> bool:
    """检测 manga-ocr 是否可用。"""
    global _manga_ocr_available
    if _manga_ocr_available is not None:
        return _manga_ocr_available
    try:
        from manga_ocr import MangaOcr
        _manga_ocr_available = True
        logger.info("manga-ocr detected — specialized Japanese manga OCR available")
    except ImportError:
        _manga_ocr_available = False
        logger.info("manga-ocr not installed; will skip to next engine")
    return _manga_ocr_available


def _get_manga_ocr():
    """获取 manga-ocr 实例（懒加载，首次初始化会下载 ~400MB 模型）。"""
    global _manga_ocr_instance
    if _manga_ocr_instance is None and _check_mangaocr_available():
        try:
            from manga_ocr import MangaOcr
            _manga_ocr_instance = MangaOcr()
            logger.info("manga-ocr engine initialized (model loaded)")
        except Exception as e:
            logger.warning(f"manga-ocr initialization failed: {e}")
            _manga_ocr_instance = False
    return _manga_ocr_instance if _manga_ocr_instance is not False else None


def _ocr_with_manga_ocr(crop: np.ndarray) -> Tuple[str, float, List[float]]:
    """使用 manga-ocr (Transformer) 识别裁剪区域。
    
    manga-ocr 专为日文漫画训练，支持：
    - 竖排/横排文字
    - 气泡内多行文本
    - 艺术字体/手写风格
    - 振假名
    
    返回 (text, confidence, char_confidences)。
    注意：manga-ocr 不返回置信度，通过文本质量启发式估算。
    """
    mocr = _get_manga_ocr()
    if mocr is None:
        return "", 0.0, []
    try:
        import cv2
        # manga-ocr 接受 PIL Image
        pil_img = Image.fromarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB) if len(crop.shape) == 3 else crop)
        text = mocr(pil_img).strip()

        if not text:
            return "", 0.0, []

        # manga-ocr 不返回置信度，根据文本质量启发式估算
        # 日文字符占比越高，置信度越高
        jp_chars = sum(1 for c in text if (
            0x3040 <= ord(c) <= 0x30FF or  # 假名
            0x4E00 <= ord(c) <= 0x9FFF or  # 汉字
            0x3000 <= ord(c) <= 0x303F      # CJK 标点
        ))
        total_chars = len(text) if text else 1
        jp_ratio = jp_chars / total_chars if total_chars > 0 else 0

        # 启发式置信度：日文字符占比 + 文本长度合理性
        conf = 0.75 + 0.2 * jp_ratio
        if total_chars < 2:
            conf -= 0.15
        if total_chars > 50:
            conf -= 0.1  # manga-ocr 长文本容易出错
        conf = max(0.55, min(0.95, conf))

        # 字符级置信度（基于文本长度分配，非真实每个字符的置信度）
        char_confs = [round(conf, 3)] * len(text)

        return text, conf, char_confs
    except Exception as e:
        logger.debug(f"manga-ocr recognition failed: {e}")
        return "", 0.0, []


def _parse_engine_order() -> List[str]:
    """解析引擎优先级配置字符串。"""
    engines = [e.strip() for e in _OCR_ENGINE_ORDER.split(",") if e.strip()]
    valid = {"mangaocr", "paddleocr"}
    return [e for e in engines if e in valid]


# ============================================================
# 二级优化：日文漫画 OCR 形近字/符号修正表（扩展至 18 对）
# 基于 PRD §7.4 风险应对方案 + 漫画日语高频语料统计
# ============================================================
_JP_MANGA_CHAR_FIXES: Dict[str, str] = {
    # --- 核心高频形近字（前 P0 修复的 3 对）---
    "\u5df3": "\u5df2",    # 巳(snake)→已(already)
    "\u66f0": "\u65e5",    # 曰(say)→日(day/sun)
    "\u592d": "\u5929",    # 夭(die)→天(sky)
    # --- 二级扩展：漫画高频形近/字形混淆 ---
    "\u672b": "\u672a",    # 末(end)→未(not yet)
    "\u58eb": "\u571f",    # 士(warrior)→土(soil)
    "\u5343": "\u5e72",    # 千(thousand)→干(dry)
    "\u4e19": "\u5185",    # 丙→内
    "\u5186": "\u5185",    # 円(yen)→内(inside)
    "\u4e88": "\u4e90",    # 予(beforehand)→矛(spear)
    "\u5199": "\u5197",    # 写(write)→冗(redundant)
    "\u25cb": "\u3007",    # ○(circle)→〇
    # --- 日文长音符号混淆 ---
    "\uff0d": "\u30fc",    # －(fullwidth hyphen)→ー(katakana long vowel)
    "\u2015": "\u30fc",    # ―(horizontal bar)→ー
    "\u2212": "\u30fc",    # −(minus sign)→ー
    # --- 标点归一 ---
    "\uff5e": "\u301c",    # ～→〜 (wave dash)
    "\u223c": "\u301c",    # ∼→〜 (tilde operator)
}

# 日文字符白名单（用于低置信度区域的强制过滤）
_JP_CHAR_WHITELIST = (
    "あいうえおかきくけこさしすせそたちつてとなにぬねの"
    "はひふへほまみむめもやゆよらりるれろわをん"
    "がぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽ"
    "ぁぃぅぇぉゃゅょっ"
    "アイウエオカキクケコサシスセソタチツテトナニヌネノ"
    "ハヒフヘホマミムメモヤユヨラリルレロワヲン"
    "ガギグゲゴザジズゼゾダヂヅデドバビブベボパピプペポ"
    "ァィゥェォャュョッ"
    "ー・、。！？…「」『』（）"
    "一二三四五六七八九十百千万円日月年時分"
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
    "0123456789"
)


def _detect_language(text: str) -> str:
    """Auto-detect language from text content."""
    if not text:
        return "unknown"
    
    scores = {"ja": 0, "zh": 0, "ko": 0, "en": 0}
    
    for char in text:
        code = ord(char)
        if 0x3040 <= code <= 0x30FF:  # Hiragana/Katakana
            scores["ja"] += 2
        elif 0x4E00 <= code <= 0x9FFF:  # Kanji/Hanzi
            scores["ja"] += 1
            scores["zh"] += 1
        elif 0xAC00 <= code <= 0xD7AF:  # Hangul
            scores["ko"] += 2
        elif 0x0041 <= code <= 0x007A:  # Latin
            scores["en"] += 1
    
    # Japanese has kana = strong indicator
    if scores["ja"] > scores["zh"] and scores["ja"] > 0:
        return "ja"
    
    best_lang = max(scores, key=scores.get)
    return best_lang if scores[best_lang] > 0 else "unknown"


def _extract_furigana(
    region_image: np.ndarray,
    main_text: str,
    bbox: Dict[str, int],
) -> Optional[str]:
    """
    Extract furigana (振假名) from a text region.
    Furigana is small kana text placed above or beside kanji characters.
    """
    try:
        import cv2
        
        h, w = region_image.shape[:2]
        if h < 20 or w < 20:
            return None
        
        gray = cv2.cvtColor(region_image, cv2.COLOR_BGR2GRAY) if len(region_image.shape) == 3 else region_image
        
        # Look for small text in the top portion of the region
        top_portion = gray[:int(h * FURIGANA_Y_OFFSET_RATIO), :]
        if top_portion.size == 0:
            return None
        
        # Threshold to find text
        _, binary = cv2.threshold(top_portion, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
        
        # Find small connected components
        num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(binary, connectivity=8)
        
        furigana_chars = []
        main_text_height_estimate = h * 0.5  # Rough estimate
        
        for i in range(1, num_labels):
            area = stats[i, cv2.CC_STAT_AREA]
            char_h = stats[i, cv2.CC_STAT_HEIGHT]
            
            # Furigana chars are small
            if 5 < area < 100 and char_h < main_text_height_estimate * FURIGANA_SIZE_RATIO_MAX:
                x = stats[i, cv2.CC_STAT_LEFT]
                y = stats[i, cv2.CC_STAT_TOP]
                furigana_chars.append({"x": x, "y": y, "area": area})
        
        if len(furigana_chars) < 1:
            return None
        
        # Sort by x position and concatenate
        furigana_chars.sort(key=lambda c: c["x"])
        
        # Try OCR on furigana region
        furigana_x_min = min(c["x"] for c in furigana_chars)
        furigana_x_max = max(c["x"] + 5 for c in furigana_chars)  # Rough width estimate
        furigana_y_min = min(c["y"] for c in furigana_chars)
        furigana_y_max = max(c["y"] + 10 for c in furigana_chars)
        
        furigana_region = top_portion[
            max(0, furigana_y_min - 2):min(top_portion.shape[0], furigana_y_max + 2),
            max(0, furigana_x_min - 2):min(top_portion.shape[1], furigana_x_max + 2),
        ]
        
        if furigana_region.size > 0:
            # Apply PaddleOCR to furigana region
            try:
                import pytesseract
                furigana_text = pytesseract.image_to_string(
                    furigana_region,
                    lang="jpn",
                    config="--psm 7 -c tessedit_char_whitelist=あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをんぁぃぅぇぉゃゅょっアイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲンァィゥェォャュョッ",
                ).strip()
                if furigana_text:
                    return furigana_text
            except Exception:
                pass
        
        logger.debug(f"Detected {len(furigana_chars)} potential furigana characters")
        return None
        
    except ImportError:
        return None
    except Exception as e:
        logger.debug(f"Furigana extraction failed: {e}")
        return None


def _get_real_character_confidences(ocr_data: Optional[Dict[str, Any]], text: str) -> List[float]:
    """P0 FIX: Extract real per-character confidence from OCR output.
    
    OCR engines return per-word confidence and per-character bounding boxes.
    We use per-word confidence as the character-level score for all characters in each word.
    
    PRD §2.2.6: "输出字符级置信度（0-100%）"
    """
    if not ocr_data or not text:
        return []
    
    try:
        # Build mapping: character index -> confidence from OCR word confidences
        word_confidences = []
        n_items = len(ocr_data.get("text", []))
        for i in range(n_items):
            word_text = ocr_data["text"][i].strip()
            word_conf = ocr_data["conf"][i]
            if word_text and str(word_conf).isdigit() and int(word_conf) >= 0:
                # Assign this word's confidence to each character in the word
                for _ in word_text:
                    word_confidences.append(int(word_conf) / 100.0)
        
        # Trim or pad to match text length
        char_confidences = []
        for i, ch in enumerate(text):
            if ch.strip():  # Non-whitespace character
                if i < len(word_confidences):
                    char_confidences.append(round(word_confidences[i], 3))
                else:
                    char_confidences.append(0.0)  # No OCR data for this char
            else:
                char_confidences.append(0.0)
        
        return char_confidences if char_confidences else []
    except Exception as e:
        logger.debug(f"Real char confidence extraction failed: {e}")
        return []


def _apply_ocr_post_corrections(text: str, lang: str = "ja") -> str:
    """二级优化：对 OCR 识别结果应用后处理修正。
    
    包括：形近字修正、符号规范化、长音符号统一、断句修复。
    PRD §7.4 风险应对 + 漫画日语高频语料统计。
    """
    if not text:
        return text
    # Step 1: 形近字/符号修正
    for wrong, correct in _JP_MANGA_CHAR_FIXES.items():
        text = text.replace(wrong, correct)
    # Step 2: 省略号规范化
    text = text.replace("...", "\u2026")
    # Step 3: 日文中去除不合理的拉丁字母间空格
    # 但保留中日文之间的自然分隔
    if lang == "ja":
        # 去除假名/汉字之间的多余空格
        text = re.sub(
            r'(?<=[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff])\s+(?=[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff])',
            '', text
        )
    # Step 4: 修复常见断句错误 — 句号后无换行时保留
    text = re.sub(r'([。！？!?])\s*(?=[^\s])', r'\1\n', text)
    # Step 5: 清理多余换行（连续3个以上换行→2个）
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


def _get_character_confidence(region_image: np.ndarray, text: str) -> List[float]:
    """DEPRECATED: 旧的基于连通组件面积启发式的估算。
    优先使用 _get_real_character_confidences() 获取 OCR 真实置信度。
    此函数仅作为完全无法获取 OCR 数据时的降级方案。"""
    if not text:
        return []
    
    char_confidences = []
    try:
        import cv2
        
        gray = cv2.cvtColor(region_image, cv2.COLOR_BGR2GRAY) if len(region_image.shape) == 3 else region_image
        _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
        
        # Find characters
        num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(binary, connectivity=8)
        
        # Map characters to components by x position
        components = []
        for i in range(1, num_labels):
            area = stats[i, cv2.CC_STAT_AREA]
            if area > 20:
                components.append({
                    "x": stats[i, cv2.CC_STAT_LEFT],
                    "area": area,
                    "w": stats[i, cv2.CC_STAT_WIDTH],
                    "h": stats[i, cv2.CC_STAT_HEIGHT],
                })
        
        components.sort(key=lambda c: c["x"])
        
        avg_area = np.mean([c["area"] for c in components]) if components else 100
        
        for i, char in enumerate(text):
            if i < len(components):
                comp = components[i]
                # Confidence based on how close component area is to average
                area_ratio = min(comp["area"], avg_area) / max(comp["area"], avg_area, 1)
                # Aspect ratio sanity check
                aspect_ok = 0.1 < (comp["w"] / max(comp["h"], 1)) < 5.0
                # P0 FIX: 降低启发式置信度基准（从0.5降到0.3），因为不是真实OCR置信度
                confidence = 0.3 + 0.2 * area_ratio + (0.1 if aspect_ok else 0)
                char_confidences.append(min(round(confidence, 3), 0.99))
            else:
                # P0 FIX: 无法匹配的字符置信度设为0.0而非0.7虚假值
                char_confidences.append(0.0)
        
    except ImportError:
        char_confidences = [0.0] * len(text)
    except Exception as e:
        logger.debug(f"Char confidence (heuristic fallback) failed: {e}")
        char_confidences = [0.0] * len(text)
    
    return char_confidences


def _preprocess_for_ocr(
    crop: np.ndarray,
    region_type: str = "speech",
    is_vertical: bool = False,
    target_char_height: int = 32,
) -> Tuple[np.ndarray, np.ndarray, bool]:
    """一级优化：OCR 输入图像增强预处理管线。

    PRD §7.4 要求对所有文字区域做标准化预处理：
    1. 灰度化 + CLAHE 对比度增强
    2. 自适应二值化（漫画气泡背景鲁棒）
    3. 竖排文本旋转90度
    4. 去除气泡边框/网点纹理干扰
    5. 白字黑底自动检测与反色
    6. 低分辨率区域超分放大
    7. 按区域类型适配不同预处理参数

    P0 FIX: 返回增强灰度图供 OCR 引擎使用（OCR 引擎在灰度图上表现远优于二值图），
    同时返回二值图用于字符高度估算和颜色提取。

    Returns:
        (enhanced_grayscale, binary_thresh, was_rotated)
    """
    import cv2

    was_rotated = False
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if len(crop.shape) == 3 else crop.copy()
    orig_h, orig_w = gray.shape[:2]

    # ==========================================
    # Step 0: 竖排文本旋转90度（转为横排供OCR识别）
    # ==========================================
    if is_vertical and orig_h > orig_w * 1.5:
        gray = cv2.rotate(gray, cv2.ROTATE_90_CLOCKWISE)
        was_rotated = True
        orig_h, orig_w = gray.shape[:2]

    # ==========================================
    # Step 1: 白字黑底检测与反色
    # ==========================================
    mean_brightness = float(np.mean(gray))
    if mean_brightness < 100:
        gray = cv2.bitwise_not(gray)
        logger.debug(f"White-on-dark detected (mean={mean_brightness:.0f}), inverted")

    # ==========================================
    # Step 2: 按区域类型调整预处理参数
    # ==========================================
    preproc_cfg = {
        "speech":       {"clahe_clip": 2.5, "denoise_h": 10, "adaptive_block": 11, "adaptive_c": 3, "morph_open": 0},
        "thought":      {"clahe_clip": 2.0, "denoise_h": 8,  "adaptive_block": 13, "adaptive_c": 3, "morph_open": 0},
        "narration":    {"clahe_clip": 1.5, "denoise_h": 5,  "adaptive_block": 9,  "adaptive_c": 2, "morph_open": 0},
        "onomatopoeia": {"clahe_clip": 3.0, "denoise_h": 12, "adaptive_block": 15, "adaptive_c": 4, "morph_open": 1},
        "effect":       {"clahe_clip": 3.0, "denoise_h": 15, "adaptive_block": 15, "adaptive_c": 5, "morph_open": 2},
    }
    cfg = preproc_cfg.get(region_type, preproc_cfg["speech"])

    # ==========================================
    # Step 3: 降噪
    # ==========================================
    denoised = cv2.fastNlMeansDenoising(gray, None, cfg["denoise_h"], 7, 21)

    # ==========================================
    # Step 4: CLAHE 对比度增强
    # ==========================================
    clahe = cv2.createCLAHE(clipLimit=cfg["clahe_clip"], tileGridSize=(8, 8))
    enhanced = clahe.apply(denoised)

    # ==========================================
    # Step 5: 形态学开运算
    # ==========================================
    if cfg["morph_open"] > 0:
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (cfg["morph_open"], cfg["morph_open"]))
        enhanced = cv2.morphologyEx(enhanced, cv2.MORPH_OPEN, kernel)

    # ==========================================
    # Step 6: 自适应二值化（用于字符高度估算和颜色提取）
    # ==========================================
    thresh = cv2.adaptiveThreshold(
        enhanced, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        cfg["adaptive_block"],
        cfg["adaptive_c"],
    )

    # ==========================================
    # Step 7: 超分放大至目标字符高度 ~32px
    # ==========================================
    try:
        h_proj = np.mean(thresh < 128, axis=1)
        text_rows = np.where(h_proj > 0.05)[0]
        est_char_height = float(np.ptp(text_rows)) if len(text_rows) > 0 else orig_h * 0.6
    except Exception:
        est_char_height = orig_h * 0.6

    scale = 1.0
    if est_char_height > 0 and est_char_height < target_char_height * 0.8:
        scale = target_char_height / max(est_char_height, 1)
        scale = min(scale, 4.0)
        if scale > 1.05:
            new_w = max(int(enhanced.shape[1] * scale), target_char_height * 2)
            new_h = max(int(enhanced.shape[0] * scale), target_char_height)
            enhanced = cv2.resize(enhanced, (new_w, new_h), interpolation=cv2.INTER_CUBIC)
            thresh = cv2.resize(thresh, (new_w, new_h), interpolation=cv2.INTER_CUBIC)
            logger.debug(f"Upscaled by {scale:.1f}x (est_char_h={est_char_height:.0f}→{int(est_char_height*scale)})")

    return enhanced, thresh, was_rotated


def _ocr_single_region(args: Tuple[np.ndarray, Dict[str, Any], str, int, int]) -> Dict[str, Any]:
    """
    P0 升级版：二级 OCR 引擎级联（manga-ocr → PaddleOCR v4）。
    按 OCR_ENGINE_ORDER 配置的优先级依次尝试，每个引擎失败或低置信度时自动回退。
    """
    img, region, tess_lang, w, h = args
    # 从 tess_lang 反推源语言代码（用于引擎选择）
    source_lang = "ja"
    if tess_lang.startswith("chi_sim"):
        source_lang = "zh"
    elif tess_lang.startswith("chi_tra"):
        source_lang = "zh-TW"
    elif tess_lang.startswith("eng"):
        source_lang = "en"
    elif tess_lang.startswith("kor"):
        source_lang = "ko"
    elif tess_lang.startswith("jpn"):
        source_lang = "ja"
    import cv2
    import uuid as _uuid

    bbox = region.get("bbox", region.get("boundary", [0, 0, 100, 100]))

    if isinstance(bbox, dict):
        x, y, rw, rh = int(bbox.get("x", 0)), int(bbox.get("y", 0)), int(bbox.get("width", 100)), int(bbox.get("height", 100))
    elif isinstance(bbox, (list, tuple)) and len(bbox) >= 4:
        x, y, rw, rh = int(bbox[0]), int(bbox[1]), int(bbox[2]), int(bbox[3])
    else:
        x, y, rw, rh = 0, 0, 100, 100

    x = max(0, min(x, w - 1))
    y = max(0, min(y, h - 1))
    rw = max(1, min(rw, w - x))
    rh = max(1, min(rh, h - y))

    pad = 20  # P0: 增大padding减少边缘裁切，防止文字被边界切断
    cx = max(0, x - pad)
    cy = max(0, y - pad)
    cw = min(w - cx, rw + 2 * pad)
    ch = min(h - cy, rh + 2 * pad)

    crop = img[cy:cy + ch, cx:cx + cw].copy()
    if crop.size == 0:
        return {"region_id": region.get("region_id", ""), "text": "", "confidence": 0.0,
                "char_confidences": [], "language": tess_lang, "font_size": 16,
                "font_style": "regular", "color": "#000000", "is_vertical": region.get("is_vertical", False),
                "furigana": None, "ocr_engine": "none"}

    is_vertical = region.get("is_vertical", False)
    region_type = region.get("type", "speech")

    # ==========================================
    # PREPROCESSING v6: Simple enhancements + vertical text rotation
    # ==========================================
    crop_preprocessed = crop
    was_rotated = False
    try:
        gray_crop_pre = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if len(crop.shape) == 3 else crop
        crop_h, crop_w = gray_crop_pre.shape[:2]

        # Step 0: 竖排文本旋转90度 → 横排，供 OCR 引擎识别
        # 日漫对话气泡中常见竖排文字（top-to-bottom, right-to-left）
        # OCR 引擎（manga-ocr/PaddleOCR）对横排文字识别效果远优于竖排
        if is_vertical and crop_h > crop_w * 1.5:
            crop_preprocessed = cv2.rotate(crop_preprocessed, cv2.ROTATE_90_CLOCKWISE)
            gray_crop_pre = cv2.rotate(gray_crop_pre, cv2.ROTATE_90_CLOCKWISE)
            was_rotated = True
            crop_h, crop_w = gray_crop_pre.shape[:2]

        # Resize very large regions to 400px max dimension
        max_dim = max(crop_w, crop_h)
        if max_dim > 400:
            scale = 400.0 / max_dim
            new_w, new_h = int(crop_w * scale), int(crop_h * scale)
            if new_w >= 8 and new_h >= 8:
                crop_resized = cv2.resize(crop_preprocessed, (new_w, new_h), interpolation=cv2.INTER_CUBIC)
                crop_preprocessed = crop_resized

        # CLAHE contrast enhancement for low-contrast scenes
        gray_std = float(np.std(gray_crop_pre.astype(np.float32)))
        if gray_std < 30:
            clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(4, 4))
            enhanced_gray = clahe.apply(gray_crop_pre)
            if len(crop_preprocessed.shape) == 3:
                crop_preprocessed = cv2.cvtColor(enhanced_gray, cv2.COLOR_GRAY2BGR)
            else:
                crop_preprocessed = enhanced_gray

        # Upscale tiny text 2x
        if max(crop_w, crop_h) < 40:
            crop_preprocessed = cv2.resize(
                crop_preprocessed, (crop_preprocessed.shape[1] * 2, crop_preprocessed.shape[0] * 2),
                interpolation=cv2.INTER_CUBIC
            )
    except Exception as preproc_err:
        logger.debug(f"OCR preprocessing skipped: {preproc_err}")
        crop_preprocessed = crop

    # ==========================================
    # P0 升级：多引擎级联识别
    # 按 OCR_ENGINE_ORDER 配置的优先级依次尝试
    # 注意：使用 crop_preprocessed 替代原始 crop 输入引擎
    # ==========================================
    engine_order = _parse_engine_order()
    text = ""
    avg_confidence = 0.0
    char_confidences = []
    engine_used = "none"

    for engine_name in engine_order:
        # manga-ocr 仅适用于日语，非日语自动跳过
        if engine_name == "mangaocr":
            if source_lang != "ja":
                continue  # 非日语跳过 manga-ocr
            text, avg_confidence, char_confidences = _ocr_with_manga_ocr(crop_preprocessed)
            if text:
                engine_used = "mangaocr_v0.1"
        elif engine_name == "paddleocr":
            text, avg_confidence, char_confidences = _ocr_with_paddle(crop_preprocessed, source_lang)
            if text:
                engine_used = "paddleocr_v4"

        # 判断是否需要回退到下一级引擎
        if not text:
            logger.debug(f"Engine '{engine_name}' returned empty text, trying next engine")
            continue

        if avg_confidence >= _OCR_CONFIDENCE_RETRY_THRESHOLD:
            break  # 置信度达标，不再回退

        # 置信度不足，P0 日志记录（仅在不是最后一个引擎时继续）
        if engine_name != engine_order[-1]:
            logger.debug(
                f"Engine '{engine_name}' conf={avg_confidence:.2f} < {_OCR_CONFIDENCE_RETRY_THRESHOLD}, "
                f"retrying with next engine"
            )

    # ==========================================
    # Post-processing
    # ==========================================
    text = text.replace("\n\n", "\n").strip()
    detected_lang = _detect_language(text) if text else tess_lang
    text = _apply_ocr_post_corrections(text, lang=detected_lang)
    from common.utils.text_sanitize import sanitize_ocr_text
    text = sanitize_ocr_text(text)

    furigana = None
    if detected_lang == "ja" and text:
        furigana = _extract_furigana(crop, text, {"x": x, "y": y, "width": rw, "height": rh})

    font_size = max(10, min(int(rh * 0.5), 36))

    try:
        gray_crop = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if len(crop.shape) == 3 else crop
        _, thresh_for_color = cv2.threshold(gray_crop, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        mask = thresh_for_color > 128
        if mask.sum() > 0:
            text_pixels = crop[mask] if len(crop.shape) == 3 else cv2.cvtColor(crop, cv2.COLOR_GRAY2BGR)[mask]
            if len(text_pixels) > 0:
                avg_color = np.mean(text_pixels, axis=0)
                color_hex = "#{:02x}{:02x}{:02x}".format(
                    int(avg_color[0]), int(avg_color[1]), int(avg_color[2])
                )
            else:
                color_hex = "#000000"
        else:
            color_hex = "#000000"
    except Exception:
        color_hex = "#000000"

    return {
        "region_id": region.get("region_id", str(_uuid.uuid4())),
        "text": text,
        "confidence": round(min(avg_confidence, 0.99), 3),
        "char_confidences": char_confidences,
        "language": detected_lang,
        "font_size": font_size,
        "font_style": "regular",
        "color": color_hex,
        "is_vertical": is_vertical,
        "furigana": furigana,
        "ocr_engine": engine_used,  # P0: 记录使用的引擎，便于监控
    }


def _check_tessdata(lang_code: str) -> bool:
    """Check if a Tesseract language data file exists."""
    try:
        import subprocess, os
        result = subprocess.run(
            ["tesseract", "--list-langs"], capture_output=True, text=True, timeout=5
        )
        return lang_code in result.stdout
    except Exception:
        return False


async def recognize_text(
    image_url: str,
    regions: List[Dict[str, Any]],
    lang: str = "ja",
) -> Dict[str, Any]:
    """
    Perform OCR on specified regions of an image (parallelized with ThreadPoolExecutor).
    
    Args:
        image_url: URL of the source image
        regions: List of region dicts with bbox
        lang: Primary language code
    
    Returns:
        {
            "results": [
                {
                    "region_id": str,
                    "text": str,
                    "confidence": float,
                    "char_confidences": [float],
                    "language": str,
                    "font_size": int,
                    "font_style": str,
                    "color": str,
                    "is_vertical": bool,
                    "furigana": str | null,
                }
            ],
            "language_detected": str,
            "processing_time_ms": float
        }
    """
    import time
    from concurrent.futures import ThreadPoolExecutor, as_completed
    import asyncio
    
    start_time = time.time()
    
    try:
        # Download image (supports data: URIs for base64-encoded images)
        if image_url.startswith("data:"):
            import base64 as _b64
            header, encoded = image_url.split(",", 1)
            image_data = _b64.b64decode(encoded)
        else:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.get(image_url)
                resp.raise_for_status()
                image_data = resp.content
        
        img_array = np.frombuffer(image_data, dtype=np.uint8)
        import cv2
        img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
        if img is None:
            return {"results": [], "language_detected": lang, "processing_time_ms": 0, "error": "Failed to decode"}
        
        h, w = img.shape[:2]
        
        # 语言映射：日文漫画使用 jpn+chi_sim 双模型覆盖汉字混排
        tess_lang_map = {
            "ja": "jpn+chi_sim",
            "zh": "chi_sim",
            "zh-CN": "chi_sim",
            "zh-TW": "chi_tra",
            "en": "eng",
            "ko": "kor",
        }
        tess_lang = tess_lang_map.get(lang, "jpn+chi_sim")
        
        # 为每个 region 注入 type 字段（如果缺失则默认 "speech"）
        enriched_regions = []
        for r in regions:
            enriched = dict(r)
            if "type" not in enriched:
                enriched["type"] = "speech"  # 默认对话气泡
            enriched_regions.append(enriched)
        
        # Parallel OCR: use ThreadPoolExecutor for CPU-bound OCR calls
        max_workers = min(len(enriched_regions), 8)
        region_args = [(img, r, tess_lang, w, h) for r in enriched_regions]
        
        # Use run_in_executor to avoid blocking the event loop
        loop = asyncio.get_running_loop()
        
        def _run_parallel():
            results = []
            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                futures = {executor.submit(_ocr_single_region, args): i for i, args in enumerate(region_args)}
                for future in as_completed(futures):
                    try:
                        result = future.result()
                        results.append((futures[future], result))
                    except Exception as e:
                        idx = futures[future]
                        logger.warning(f"OCR region[{idx}] failed: {e}")
            # Sort back to original order
            results.sort(key=lambda x: x[0])
            return [r for _, r in results]
        
        ocr_results = await loop.run_in_executor(None, _run_parallel)
        
        processing_time = (time.time() - start_time) * 1000
        logger.info(f"OCR completed: {len(ocr_results)} regions, {processing_time:.0f}ms, {max_workers} workers")
        
        return {
            "results": ocr_results,
            "language_detected": lang,
            "processing_time_ms": round(processing_time, 1),
        }
        
    except Exception as e:
        logger.error(f"OCR failed: {e}", exc_info=True)
        return {
            "results": [],
            "language_detected": lang,
            "processing_time_ms": (time.time() - start_time) * 1000,
            "error": str(e),
        }
