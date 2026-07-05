from __future__ import annotations
"""OCR 文字识别服务 - 真实实现

策略：
1. 优先调用 AI 微服务 (ai_client.ocr_recognize)
2. 回退方案：pytesseract 本地OCR
3. 最终兜底：返回空结果
4. P0 FIX: 后处理修正常见日文漫画OCR错误（形近字、符号混淆）
"""
import uuid
import io
import re
import logging
from typing import Optional, List, Dict

import httpx
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from common.core.config import settings
from common.models.page import Page
from common.models.text_region import TextRegion

logger = logging.getLogger(__name__)

# OCR 裁剪与重试参数
CROP_PAD = 20              # 逐区域裁剪边距（像素），防止文字被边界切断
CONF_RETRY_THRESHOLD = 0.65  # 全图识别后低于此置信度的区域触发逐区域重试

# ============================================================
# 二级优化：日文漫画 OCR 后处理 — 修正 18 对常见形近字与符号混淆
# 基于 PRD §7.4 风险应对 + 漫画日语高频语料统计
# ============================================================

# 形近字修正表（扩展至 15 对，仅修正 OCR 笔画混淆的字形）
_JP_MANGA_LOOKALIKE_FIXES: Dict[str, str] = {
    # --- 核心高频形近字 ---
    "\u5df3": "\u5df2",    # 巳(snake)→已(already) — 巳在漫画中极罕见
    "\u66f0": "\u65e5",    # 曰(say)→日(day/sun) — 漫画对话中几乎不用曰
    "\u592d": "\u5929",    # 夭(die)→天(sky)
    # --- 二级扩展：笔画长短/方向混淆 ---
    "\u672b": "\u672a",    # 末(end)→未(not yet) — 漫画字号下竖画长短难辨
    "\u58eb": "\u571f",    # 士(warrior)→土(soil) — 横画长短混淆
    "\u5343": "\u5e72",    # 千(thousand)→干(dry) — 撇与横混淆
    "\u4e19": "\u5185",    # 丙→内 — 外框形状混淆
    "\u5186": "\u5185",    # 円(yen)→内(inside) — 漫画小字号形近
    # --- 字形含混 ---
    "\u5199": "\u5197",    # 写(write)→冗(redundant) — 冠部混淆
    "\u8fb0": "\u5c3e",    # 辰(dragon)→尾(tail) — 漫画中辰罕见
    # --- 日文符号混淆 ---
    "\uff0d": "\u30fc",    # －(fullwidth hyphen)→ー(katakana long vowel)
    "\u2015": "\u30fc",    # ―(horizontal bar)→ー
    "\u2212": "\u30fc",    # −(minus sign)→ー
    # --- 符号字符混淆 ---
    "\u25cb": "\u3007",    # ○(white circle)→〇(ideographic zero)
    "\uff5e": "\u301c",    # ～(fullwidth tilde)→〜(wave dash)
}

# 符号规范化修正
def _normalize_jp_symbols(text: str) -> str:
    """规范化日文符号混淆"""
    # 半角波浪线 → 日文正式波浪线
    text = text.replace("~", "\u301c")
    # 三个英文句号 → 日文三点省略号
    text = text.replace("...", "\u2026")
    # 半角逗号在中文/日文上下文中 → 全角
    # (保守处理：仅当 text 不含英文单词时替换)
    if not re.search(r'[a-zA-Z]{3,}', text):
        text = text.replace(",", "\u3001")
    return text


def _apply_ocr_post_corrections(text: str) -> str:
    """对 OCR 识别结果应用后处理修正（形近字 + 符号规范化）"""
    if not text:
        return text
    # Step 1: 形近字修正
    for wrong, correct in _JP_MANGA_LOOKALIKE_FIXES.items():
        text = text.replace(wrong, correct)
    # Step 2: 符号规范化
    text = _normalize_jp_symbols(text)
    # Step 3: 清理明显错误的断句空格
    # 日文中不应有空格的词间空格（但保留换行/段落标记）
    text = re.sub(r'(?<=[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff])\s+(?=[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff])', '', text)
    return text.strip()

# 项目服务地址（用于解析相对 URL）
STORAGE_BASE_URL = os.getenv("STORAGE_BASE_URL", "http://localhost:8002")
LOCAL_STORAGE_ROOT = os.getenv("LOCAL_STORAGE_ROOT", os.path.join(settings.UPLOAD_DIR, "uploads"))


def _resolve_image_url(image_url: str) -> str:
    """将相对路径（如 /storage/xxx）解析为绝对 HTTP URL"""
    if image_url.startswith("http://") or image_url.startswith("https://"):
        return image_url
    if image_url.startswith("/"):
        return f"{STORAGE_BASE_URL}{image_url}"
    return f"{STORAGE_BASE_URL}/{image_url}"


def _url_to_local_path(image_url: str) -> Optional[str]:
    """将 /storage/user_id/originals/xxx 转换为本地文件路径"""
    if image_url.startswith("/storage/"):
        local_path = os.path.join(LOCAL_STORAGE_ROOT, image_url[len("/storage/"):])
        if os.path.isfile(local_path):
            return local_path
    return None


async def _ai_ocr(image_url: str, regions: list, lang: str) -> Optional[List[dict]]:
    """通过 AI 微服务执行 OCR"""
    try:
        from common.clients.ai_service import ai_client
        result = await ai_client.ocr_recognize(image_url, regions, lang)
        if not result:
            return None
        if result.get("status") == "error" or result.get("error"):
            logger.warning(f"AI OCR returned error: {result.get('error', result)}")
            return None
        if "results" not in result:
            return None
        results = result["results"]
        # AI Gateway 已遍历 manga-ocr → PaddleOCR → RapidOCR 三级联级
        # 若全部返回空文本，说明区域内确实无可见文字（非引擎故障）
        # 不再回退本地 tesseract（已移除）
        if not results:
            return []
        return results
    except Exception as e:
        logger.warning(f"AI OCR failed: {e}, falling back to local OCR")
    return None


async def _load_page_image_bytes(page: Page, resolved_url: str) -> Optional[bytes]:
    """从本地存储或 HTTP 加载页面原图字节"""
    # P0 FIX: 如果 original_url 是自引用URL，尝试 processed_url
    image_url = page.original_url
    if image_url and image_url.startswith("/api/v1/pages/") and page.processed_url:
        logger.info(f"OCR: original_url is self-referencing, trying processed_url")
        image_url = page.processed_url
        resolved_url = _resolve_image_url(image_url)

    local_path = _url_to_local_path(image_url) if image_url else None
    if local_path:
        try:
            with open(local_path, "rb") as f:
                return f.read()
        except Exception as e:
            logger.warning(f"OCR: failed to read local file {local_path}: {e}")

    download_url = resolved_url
    if page.original_url and page.original_url.startswith("/api/v1/pages/"):
        gateway_base = os.getenv("GATEWAY_BASE_URL", "http://api-gateway:8080")
        download_url = f"{gateway_base}{page.original_url}"

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(download_url)
            resp.raise_for_status()
            return resp.content
    except Exception as e:
        logger.warning(f"OCR: failed to download image from {download_url}: {e}")
        return None


_paddle_ocr_instance = None
_paddle_ocr_available = None


def _check_paddleocr_available() -> bool:
    global _paddle_ocr_available
    if _paddle_ocr_available is not None:
        return _paddle_ocr_available
    try:
        import paddle
        import paddleocr
        _paddle_ocr_available = True
        logger.info("PaddleOCR detected in image_service")
    except ImportError:
        _paddle_ocr_available = False
    return _paddle_ocr_available


# source_lang → PaddleOCR lang 参数映射
_PADDLEOCR_LANG_MAP_LOCAL = {
    "ja": "japan", "jpn": "japan",
    "zh": "ch", "zh-CN": "ch", "zh-TW": "chinese_tra",
    "chi_sim": "ch", "chi_tra": "chinese_tra",
    "en": "en", "eng": "en",
    "ko": "korean", "kor": "korean",
}

# PaddleOCR 实例缓存（按语言缓存）
_paddle_ocr_instances_local = {}

def _get_paddle_ocr(lang: str = None):
    """获取 PaddleOCR 实例（按语言缓存）。lang 为空时默认 japan。"""
    global _paddle_ocr_instances_local
    paddle_lang = _PADDLEOCR_LANG_MAP_LOCAL.get(lang, "japan") if lang else "japan"
    if paddle_lang not in _paddle_ocr_instances_local:
        enabled = os.getenv("PADDLEOCR_ENABLED", "true").lower() in ("true", "1", "yes")
        if enabled and _check_paddleocr_available():
            try:
                from paddleocr import PaddleOCR
                _paddle_ocr_instances_local[paddle_lang] = PaddleOCR(
                    lang=paddle_lang,
                    use_angle_cls=True,
                    det_db_thresh=0.2,
                    det_db_box_thresh=0.1,
                    rec_batch_num=6,
                    show_log=False,
                )
                logger.info(f"PaddleOCR PP-OCRv4 engine ({paddle_lang}) initialized in image_service")
            except Exception as e:
                logger.warning(f"PaddleOCR init failed in image_service ({paddle_lang}): {e}")
                _paddle_ocr_instances_local[paddle_lang] = False
    inst = _paddle_ocr_instances_local.get(paddle_lang)
    return inst if inst is not False else None


_manga_ocr_instance = None
_manga_ocr_available = None


def _check_mangaocr_available() -> bool:
    global _manga_ocr_available
    if _manga_ocr_available is not None:
        return _manga_ocr_available
    try:
        from manga_ocr import MangaOcr
        _manga_ocr_available = True
    except ImportError:
        _manga_ocr_available = False
    return _manga_ocr_available


def _get_manga_ocr():
    global _manga_ocr_instance
    if _manga_ocr_instance is None and _check_mangaocr_available():
        try:
            from manga_ocr import MangaOcr
            _manga_ocr_instance = MangaOcr()
            logger.info("manga-ocr engine initialized in image_service")
        except Exception as e:
            logger.warning(f"manga-ocr init failed in image_service: {e}")
            _manga_ocr_instance = False
    return _manga_ocr_instance if _manga_ocr_instance is not False else None


def _box_overlap_ratio(box_a, box_b):
    """Calculate how much box_a overlaps with box_b (0.0-1.0)."""
    ax, ay, aw, ah = box_a
    bx, by, bw, bh = box_b
    x1 = max(ax, bx)
    y1 = max(ay, by)
    x2 = min(ax + aw, bx + bw)
    y2 = min(ay + ah, by + bh)
    if x2 <= x1 or y2 <= y1:
        return 0.0
    intersection = (x2 - x1) * (y2 - y1)
    area_a = aw * ah
    area_b = bw * bh
    min_area = min(area_a, area_b) if min(area_a, area_b) > 0 else 1
    return intersection / min_area


def _match_ocr_to_regions(full_results, regions, img_shape):
    """Match full-image RapidOCR results to detected regions by spatial overlap.
    
    RapidOCR on the full image produces much higher quality results than cropping
    individual regions. This function maps full-image results back to detector regions.
    """
    if not full_results or not regions:
        return []

    h, w = img_shape[:2]
    matched = []

    for region in regions:
        bbox = region.get("bbox", region.get("boundary", [0, 0, 100, 100]))
        if isinstance(bbox, dict):
            rx, ry, rw, rh = bbox.get("x", 0), bbox.get("y", 0), bbox.get("width", 100), bbox.get("height", 100)
        elif isinstance(bbox, (list, tuple)) and len(bbox) >= 4:
            rx, ry, rw, rh = bbox[0], bbox[1], bbox[2], bbox[3]
        else:
            rx, ry, rw, rh = 0, 0, 100, 100

        best_text = ""
        best_conf = 0.0
        best_chars = []

        for ocr_box, ocr_text, ocr_conf in full_results:
            # RapidOCR returns polygon points, convert to bounding rect
            if isinstance(ocr_box, (list, tuple)) and len(ocr_box) >= 4:
                pts = ocr_box
                xs = [p[0] for p in pts]
                ys = [p[1] for p in pts]
                ox, oy = min(xs), min(ys)
                ow, oh = max(xs) - min(xs), max(ys) - min(ys)
            else:
                continue

            overlap = _box_overlap_ratio((rx, ry, rw, rh), (ox, oy, ow, oh))
            if overlap > 0.1 and ocr_conf > best_conf:
                best_text = ocr_text
                best_conf = ocr_conf
                best_chars = [round(ocr_conf, 3)] * len(ocr_text)

        matched.append({
            "text": best_text,
            "confidence": round(min(best_conf, 0.99), 3),
            "char_confidences": best_chars,
        })

    return matched


async def _tesseract_ocr(image_data: bytes, regions: list, lang: str) -> List[dict]:
    """Local OCR: manga-ocr → PaddleOCR v4 (仅这两个引擎，无回退)。

    P0 FIX: padding 8→20px 防止裁剪切断文字。
    """
    try:
        import cv2
        import numpy as np

        img_array = np.frombuffer(image_data, dtype=np.uint8)
        img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
        if img is None:
            return []

        def _build_results(matched_list):
            results = []
            for i, region in enumerate(regions):
                m = matched_list[i] if i < len(matched_list) else {"text": "", "confidence": 0.0, "char_confidences": []}
                text = m["text"].strip()
                text = _apply_ocr_post_corrections(text) if text else text
                from common.utils.text_sanitize import sanitize_ocr_text
                text = sanitize_ocr_text(text)
                results.append({
                    "region_id": region.get("region_id", str(uuid.uuid4())),
                    "text": text,
                    "confidence": m["confidence"],
                    "char_confidences": m["char_confidences"],
                    "font_size": 16, "font_style": "regular", "color": "#000000",
                })
            return results

        def _crop_region(region):
            bbox = region.get("bbox", region.get("boundary", [0, 0, 100, 100]))
            if isinstance(bbox, dict):
                x, y, w_box, h_box = int(bbox.get("x", 0)), int(bbox.get("y", 0)), int(bbox.get("width", 100)), int(bbox.get("height", 100))
            else:
                x, y, w_box, h_box = int(bbox[0]), int(bbox[1]), int(bbox[2]), int(bbox[3])
            x_c, y_c = max(0, x - CROP_PAD), max(0, y - CROP_PAD)
            w_c = min(w_box + 2 * CROP_PAD, img.shape[1] - x_c)
            h_c = min(h_box + 2 * CROP_PAD, img.shape[0] - y_c)
            if w_c <= 0 or h_c <= 0:
                return None
            crop = img[y_c:y_c+h_c, x_c:x_c+w_c]
            return crop if crop.size > 0 else None

        # ── Strategy -1: manga-ocr 逐区域（日语专用）──
        is_jp = lang.startswith("jpn") or lang == "ja"
        mocr = _get_manga_ocr()
        if mocr is not None and is_jp:
            try:
                from concurrent.futures import ThreadPoolExecutor, as_completed

                def _mocr_region(region, idx):
                    crop = _crop_region(region)
                    if crop is None:
                        return idx, "", 0.0
                    pil_crop = Image.fromarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))
                    text = mocr(pil_crop).strip()
                    jp_chars = sum(1 for c in text if 0x3040 <= ord(c) <= 0x30FF or 0x4E00 <= ord(c) <= 0x9FFF)
                    total = len(text) if text else 1
                    conf = 0.75 + 0.2 * (jp_chars / total) - (0.1 if total > 50 else 0)
                    conf = max(0.55, min(0.95, conf))
                    return idx, text, conf

                mocr_results = {}
                max_w = min(len(regions), 4)
                with ThreadPoolExecutor(max_workers=max_w) as executor:
                    futures = {executor.submit(_mocr_region, r, i): i for i, r in enumerate(regions)}
                    for future in as_completed(futures):
                        try:
                            idx, text, conf = future.result()
                            text = _apply_ocr_post_corrections(text) if text else text
                            from common.utils.text_sanitize import sanitize_ocr_text
                            text = sanitize_ocr_text(text) if text else text
                            mocr_results[idx] = {
                                "region_id": regions[idx].get("region_id", str(uuid.uuid4())),
                                "text": text, "confidence": conf,
                                "char_confidences": [round(conf, 3)] * len(text) if text else [],
                                "font_size": 16, "font_style": "regular", "color": "#000000",
                            }
                        except Exception:
                            pass

                if mocr_results:
                    results = [mocr_results[i] for i in sorted(mocr_results.keys())]
                    has_text = sum(1 for r in results if (r.get("text") or "").strip())
                    if has_text > 0:
                        logger.info(f"Local OCR (manga-ocr): {has_text}/{len(regions)} regions with text")
                        return results
            except Exception as e:
                logger.warning(f"manga-ocr per-region failed: {e}")

        # ── Strategy 0: PaddleOCR v4 全图 ──
        paddle = _get_paddle_ocr(lang)
        if paddle is not None:
            try:
                pil_img = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
                paddle_result = paddle.ocr(np.array(pil_img))
                if paddle_result and paddle_result[0]:
                    full_ocr = []
                    for line in paddle_result[0]:
                        bbox = line[0]
                        text = line[1][0]
                        conf = line[1][1]
                        full_ocr.append((bbox, text, conf))
                    if full_ocr:
                        logger.info(f"Full-image PaddleOCR v4: {len(full_ocr)} text regions found")
                        matched = _match_ocr_to_regions(full_ocr, regions, img.shape)
                        has_text = sum(1 for m in matched if m["text"].strip())
                        if has_text > 0:
                            results = _build_results(matched)
                            logger.info(f"Local OCR (PaddleOCR v4): {sum(1 for r in results if r.get('text','').strip())}/{len(regions)} regions with text")
                            return results
            except Exception as e:
                logger.warning(f"Full-image PaddleOCR failed: {e}")

        # ── 无可用引擎，返回空结果 ──
        logger.warning("No OCR engine available (manga-ocr and PaddleOCR both failed)")
        return []

    except Exception as e:
        logger.error(f"Local OCR failed: {e}", exc_info=True)
        return []


class OcrService:
    """OCR 识别服务"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def recognize(
        self, page_id: str, user_id: str, region_ids: list, language: str
    ) -> dict:
        """对指定区域的文字执行OCR识别，结果存入DB"""
        task_id = str(uuid.uuid4())

        # 查询页面
        result = await self.db.execute(
            select(Page).where(Page.page_id == page_id)
        )
        page = result.scalar_one_or_none()
        if not page:
            return {"task_id": task_id, "status": "failed", "results": []}

        # 查询需要识别的区域
        if region_ids:
            regions_result = await self.db.execute(
                select(TextRegion).where(
                    TextRegion.page_id == page_id,
                    TextRegion.region_id.in_(region_ids)
                ).order_by(TextRegion.sort_order.asc())
            )
        else:
            regions_result = await self.db.execute(
                select(TextRegion)
                .where(TextRegion.page_id == page_id)
                .order_by(TextRegion.sort_order.asc())
            )
        regions = list(regions_result.scalars().all())

        if not regions:
            return {"task_id": task_id, "status": "completed", "results": []}

        # 准备传递给OCR的区域数据（含类型，支持按类型适配预处理）
        region_data = []
        for r in regions:
            boundary = r.boundary or {}
            region_data.append({
                "region_id": str(r.region_id),
                "bbox": [
                    boundary.get("x", 0),
                    boundary.get("y", 0),
                    boundary.get("width", 0),
                    boundary.get("height", 0),
                ],
                "type": r.type if r.type else "speech",  # 传递区域类型
            })

        # P0 FIX: 如果 original_url 是自引用URL，使用 processed_url
        effective_url = page.original_url or ""
        if effective_url.startswith("/api/v1/pages/") and page.processed_url:
            effective_url = page.processed_url
        resolved_url = _resolve_image_url(effective_url)
        image_data = None

        # 策略1: AI 微服务 OCR（使用解析后的绝对 URL）
        results = await _ai_ocr(resolved_url, region_data, language)

        # 策略2: 本地 tesseract OCR
        if results is None:
            image_data = await _load_page_image_bytes(page, resolved_url)

            if image_data:
                results = await _tesseract_ocr(image_data, region_data, language)
            else:
                results = []

        if results is None:
            results = []

        # P0 FIX: 对 AI Gateway 返回的结果也应用后处理修正
        for ocr_result in results:
            raw_text = ocr_result.get("text", "")
            if raw_text:
                from common.utils.text_sanitize import sanitize_ocr_text
                ocr_result["text"] = sanitize_ocr_text(_apply_ocr_post_corrections(raw_text))
            else:
                ocr_result["text"] = ""

        # P0 FIX: 检查 OCR 是否实际识别出有效文本
        text_count = sum(1 for r in results if (r.get("text") or "").strip())
        if not text_count and results:
            logger.warning(
                f"OCR completed but all {len(results)} regions returned empty text. "
                f"Possible causes: Tesseract language data missing, preprocessing too aggressive, "
                f"or image quality insufficient."
            )

        # 收集字符级置信度映射 (region_id → char_confidences)
        char_confidence_map: Dict[str, List[float]] = {}
        for ocr_result in results:
            cc = ocr_result.get("char_confidences")
            if cc and isinstance(cc, list) and len(cc) > 0:
                char_confidence_map[ocr_result.get("region_id", "")] = [float(c) for c in cc]

        # 更新DB中的文字区域
        for r in regions:
            matched = None
            for ocr_result in results:
                if ocr_result.get("region_id") == str(r.region_id):
                    matched = ocr_result
                    break

            if matched:
                r.original_text = matched.get("text", "")
                # P0 FIX: DB 回退不再使用 0.8 虚假值
                r.confidence = matched.get("confidence", 0.0)
                style = r.style_config or {}
                style["font_size"] = matched.get("font_size", 16)
                style["font_style"] = matched.get("font_style", "regular")
                style["color"] = matched.get("color", "#000000")
                # P0 FIX: 将 char_confidences 存入 style_config 以便后续取用
                r_cc = matched.get("char_confidences")
                if r_cc and isinstance(r_cc, list) and len(r_cc) > 0:
                    style["_char_confidences"] = [float(c) for c in r_cc]
                r.style_config = style
                flag_modified(r, "style_config")  # 强制 SQLAlchemy 检测 JSONB 列变更

        # 清理 OCR 未识别到有效文字的空区域（消除画面上的幽灵检测框）。
        # 安全前提：整页 OCR 引擎确实工作正常(text_count>0)时才删空框，
        # 避免引擎整体故障时误删全部区域。
        pruned = 0
        if text_count > 0:
            for r in regions:
                if not (r.original_text or "").strip():
                    await self.db.delete(r)
                    pruned += 1
            if pruned:
                logger.info(f"OCR: pruned {pruned} empty (no-text) regions from page {page_id}")

        await self.db.commit()

        # 重新拉取存活区域用于响应
        if pruned:
            regions = [r for r in regions if (r.original_text or "").strip()]

        # 构建响应（包含字符级置信度）
        response_results = []
        for r in regions:
            rid = str(r.region_id)
            # 优先使用 OCR 结果中的 char_confidences，其次使用 DB 中的
            char_cc = char_confidence_map.get(rid)
            if not char_cc:
                char_cc = (r.style_config or {}).get("_char_confidences", [])
            response_results.append({
                "region_id": rid,
                "text": r.original_text or "",
                "confidence": r.confidence or 0.0,
                "char_confidences": char_cc if char_cc else [],
                "font_size": (r.style_config or {}).get("font_size", 16),
                "font_style": (r.style_config or {}).get("font_style", "regular"),
                "color": (r.style_config or {}).get("color", "#000000"),
            })

        return {
            "task_id": task_id,
            "status": "completed" if text_count > 0 else "completed_with_warning",
            "results": response_results,
            "warning": f"全部{len(results)}个区域识别为空" if not text_count and results else None,
        }

    async def get_status(self, page_id: str, task_id: str, user_id: str) -> dict:
        """获取OCR任务状态"""
        regions_result = await self.db.execute(
            select(TextRegion)
            .where(TextRegion.page_id == page_id)
            .order_by(TextRegion.sort_order.asc())
        )
        regions = list(regions_result.scalars().all())
        has_ocr = any(r.original_text for r in regions)

        return {
            "task_id": task_id,
            "status": "completed" if has_ocr else "pending",
            "progress": 100 if has_ocr else 0,
        }
