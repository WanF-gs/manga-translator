from __future__ import annotations
"""
Enhanced image inpainting v2 for AI Gateway.
PRD §2.4.1 aligned: Pixel-level text erasure with screentone preservation.

Supports two erase modes:
- text_erase: Only remove text strokes, preserve bubble borders & background textures
- bubble_erase: Remove text + bubble frame, reconstruct underlying artwork

Improvements over v1:
1. Pixel-level text mask building — OTSU + adaptive threshold for precise text stroke isolation
2. Screentone-aware texture synthesis — FFT-based pattern detection + intelligent sampling
3. Gradient-aware feather blending — smooth edge transitions, no visible boundaries
4. Lossless quality — full resolution output, no quality degradation
"""
import io
import logging
import uuid
import time
from typing import Optional, List, Dict, Any, Tuple

import httpx
import numpy as np
from PIL import Image, ImageFilter, ImageDraw

logger = logging.getLogger(__name__)

SCREENTONE_PATTERN_SIZE = 4
SCREENTONE_PERIODICITY_THRESHOLD = 0.6


# ============================================================
# Pixel-level text mask — PRD §2.4.1 core
# ============================================================

def _build_pixel_text_mask(
    roi: np.ndarray,
    margin: int = 2,
) -> Optional[np.ndarray]:
    """
    Build pixel-level text mask from a region ROI.
    
    Uses OTSU + adaptive threshold dual detection to isolate text stroke pixels
    from background. Only dark text pixels become mask=255, background stays 0.
    
    Args:
        roi: BGR image region (numpy array)
        margin: expansion margin in pixels
    
    Returns:
        Binary mask (uint8) of same size as roi, or None if no text detected
    """
    import cv2
    
    h, w = roi.shape[:2]
    if h < 10 or w < 10:
        return None
    
    gray_roi = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY) if len(roi.shape) == 3 else roi

    # 判断气泡底色：亮底(白气泡)→暗字；暗底→亮字(反色白字)
    median_bg = float(np.median(gray_roi))
    inverted_text = median_bg < 110

    if inverted_text:
        _, otsu_bin = cv2.threshold(gray_roi, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        adaptive_bin = cv2.adaptiveThreshold(
            gray_roi, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY, blockSize=15, C=-4,
        )
    else:
        _, otsu_bin = cv2.threshold(gray_roi, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
        adaptive_bin = cv2.adaptiveThreshold(
            gray_roi, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY_INV, blockSize=15, C=4,
        )

    # 并集(union)覆盖更全的笔画，避免残留（旧交集太保守漏掉笔画边缘）
    text_mask = cv2.bitwise_or(otsu_bin, adaptive_bin)

    # Validate: at least some text pixels
    text_ratio = np.sum(text_mask > 0) / (w * h + 1e-6)
    # 比例异常高(>70%)说明阈值把背景也算进来 → 退回交集
    if text_ratio > 0.70:
        text_mask = cv2.bitwise_and(otsu_bin, adaptive_bin)
        text_ratio = np.sum(text_mask > 0) / (w * h + 1e-6)

    if text_ratio < 0.003:
        return None

    # Morphological close to connect broken strokes（稍大核确保笔画连续）
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    text_mask = cv2.morphologyEx(text_mask, cv2.MORPH_CLOSE, kernel)

    # 膨胀覆盖文字边缘/描边：加大到 margin+2，杜绝残影
    dilate_size = max(3, margin + 2)
    kernel_d = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (dilate_size, dilate_size))
    text_mask = cv2.dilate(text_mask, kernel_d, iterations=1)

    # Gaussian blur for soft edge feathering
    text_mask_f = text_mask.astype(np.float32)
    text_mask_f = cv2.GaussianBlur(text_mask_f, (3, 3), 0.8)
    text_mask = (text_mask_f > 30).astype(np.uint8) * 255

    return text_mask


# ============================================================
# Screentone detection and preservation — PRD §2.4.1
# ============================================================

def _detect_screentone_region(image: Image.Image, bbox: Dict[str, int]) -> bool:
    """
    Detect if a region contains manga screentone (网点纸) patterns.
    Uses FFT for periodic pattern detection.
    """
    try:
        x, y, w, h = bbox["x"], bbox["y"], bbox["width"], bbox["height"]
        
        margin = 5
        sample_x = max(0, x - margin)
        sample_y = max(0, y - margin)
        sample_w = min(image.width - sample_x, w + 2 * margin)
        sample_h = min(image.height - sample_y, h + 2 * margin)
        
        if sample_w < 10 or sample_h < 10:
            return False
        
        sample = image.crop((sample_x, sample_y, sample_x + sample_w, sample_y + sample_h))
        sample_array = np.array(sample.convert("L"))
        
        if sample_array.size < 100:
            return False
        
        from numpy.fft import fft2, fftshift
        freq = fft2(sample_array.astype(np.float64))
        freq_shifted = fftshift(freq)
        magnitude = np.abs(freq_shifted)
        magnitude = magnitude / (magnitude.max() + 1e-8)
        
        h_m, w_m = magnitude.shape
        cy, cx = h_m // 2, w_m // 2
        mask = np.ones_like(magnitude, dtype=bool)
        mask[cy - 3:cy + 3, cx - 3:cx + 3] = False
        
        if mask.sum() > 0:
            max_non_dc = magnitude[mask].max()
            return max_non_dc > SCREENTONE_PERIODICITY_THRESHOLD
    except Exception:
        pass
    
    # Fallback: local variance
    try:
        sample_arr = np.array(sample.convert("L")) if 'sample' in dir() else None
        if sample_arr is not None and sample_arr.size >= SCREENTONE_PATTERN_SIZE:
            local_var = np.var(sample_arr.reshape(-1, SCREENTONE_PATTERN_SIZE), axis=1)
            mean_var = np.mean(local_var)
            return 30 < mean_var < 200
    except Exception:
        pass
    
    return False


def _screentone_aware_blend(
    img_bgr: np.ndarray,
    inpainted: np.ndarray,
    mask_bin: np.ndarray,
    bbox: Dict[str, int],
) -> np.ndarray:
    """
    Blend inpainted region with sampled screentone pattern for texture continuity.
    Only applied to regions detected as having screentone.
    """
    import cv2
    
    x, y, w, h = bbox["x"], bbox["y"], bbox["width"], bbox["height"]
    x = max(0, x); y = max(0, y)
    w = min(w, img_bgr.shape[1] - x); h = min(h, img_bgr.shape[0] - y)
    
    if w <= 0 or h <= 0:
        return inpainted
    
    # Sample surrounding screentone pattern
    margin = 8
    patterns = []
    
    # Top border
    if y > 0:
        top_crop = img_bgr[max(0, y - margin):y, x:x + w]
        if top_crop.size > 0:
            patterns.append(top_crop.reshape(-1, 3))
    # Bottom border
    if y + h < img_bgr.shape[0]:
        bot_crop = img_bgr[y + h:min(img_bgr.shape[0], y + h + margin), x:x + w]
        if bot_crop.size > 0:
            patterns.append(bot_crop.reshape(-1, 3))
    # Left border
    if x > 0:
        left_crop = img_bgr[y:y + h, max(0, x - margin):x]
        if left_crop.size > 0:
            patterns.append(left_crop.reshape(-1, 3))
    # Right border
    if x + w < img_bgr.shape[1]:
        right_crop = img_bgr[y:y + h, x + w:min(img_bgr.shape[1], x + w + margin)]
        if right_crop.size > 0:
            patterns.append(right_crop.reshape(-1, 3))
    
    if not patterns:
        return inpainted
    
    all_colors = np.concatenate(patterns, axis=0)
    mean_color = np.mean(all_colors, axis=0).astype(np.uint8)
    
    # Apply blend: 30% pattern color, 70% inpainted texture
    roi = inpainted[y:y + h, x:x + w]
    mask_roi = mask_bin[y:y + h, x:x + w] > 128
    
    pattern_overlay = np.full_like(roi, mean_color)
    alpha = 0.3
    blended = (roi * (1 - alpha) + pattern_overlay * alpha).astype(np.uint8)
    roi[mask_roi] = blended[mask_roi]
    inpainted[y:y + h, x:x + w] = roi
    
    return inpainted


# ============================================================
# Main inpainting function
# ============================================================

async def inpaint_image(
    image_url: str,
    masks: List[Dict[str, Any]],
    method: str = "lama",
    bubble_erase: bool = False,
) -> Dict[str, Any]:
    """
    Perform image inpainting / text removal.
    
    PRD §2.4.1 aligned: Two erase modes.
    
    Args:
        image_url: URL of the source image
        masks: List of mask regions [{region_id, bbox: [x,y,w,h], boundary}]
        method: "lama" (telea), "ns", "pil"
        bubble_erase: 
            False = text_erase mode: pixel-level text stroke removal
            True = bubble_erase mode: full bubble region removal
    
    Returns:
        {result_data, result_format, method, regions_processed,
         screentone_regions, erase_mode, processing_time_ms}
    """
    import cv2
    
    start_time = time.time()
    erase_mode = "bubble_erase" if bubble_erase else "text_erase"
    
    try:
        # Download image (supports data: URIs for base64-encoded images)
        if image_url.startswith("data:"):
            import base64 as _b64
            header, encoded = image_url.split(",", 1)
            image_data = _b64.b64decode(encoded)
        else:
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.get(image_url)
                resp.raise_for_status()
                image_data = resp.content
        
        pil_img = Image.open(io.BytesIO(image_data)).convert("RGBA")
        img_array = np.frombuffer(image_data, dtype=np.uint8)
        img_cv = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
        
        if img_cv is None:
            return {
                "result_data": None, "method": method,
                "regions_processed": 0, "screentone_regions": 0,
                "processing_time_ms": 0, "error": "Failed to decode image",
                "erase_mode": erase_mode,
            }
        
        h, w = img_cv.shape[:2]
        
        # Build mask based on erase mode
        full_mask = np.zeros((h, w), dtype=np.uint8)
        screentone_count = 0
        text_erase_count = 0
        region_erase_count = 0
        # 记录干净气泡区域 + 其背景填充色，LaMa 后做纯色填充兜底，保证 0 残留
        clean_fill_regions = []  # [(x1,y1,x2,y2,(b,g,r))]
        
        for mask_info in masks:
            bbox = mask_info.get("bbox", mask_info.get("boundary", {}))
            
            if isinstance(bbox, dict):
                rx = int(bbox.get("x", 0))
                ry = int(bbox.get("y", 0))
                rw = int(bbox.get("width", 100))
                rh = int(bbox.get("height", 100))
            elif isinstance(bbox, (list, tuple)) and len(bbox) >= 4:
                rx, ry, rw, rh = int(bbox[0]), int(bbox[1]), int(bbox[2]), int(bbox[3])
            else:
                continue
            
            rx = max(0, rx); ry = max(0, ry)
            rw = min(rw, w - rx); rh = min(rh, h - ry)
            if rw <= 0 or rh <= 0:
                continue
            
            if erase_mode == "text_erase":
                # Build pixel-level text mask
                roi = img_cv[ry:ry + rh, rx:rx + rw] if rh > 0 and rw > 0 else None

                if roi is not None and roi.size > 0:
                    # 判断该区域是否为"干净气泡"（背景亮且以背景色为主）——若是，整块 mask，
                    # 让 LaMa 彻底重绘杜绝残留；否则用精密像素 mask 保护背景纹理。
                    import cv2 as _cv2
                    _gray = _cv2.cvtColor(roi, _cv2.COLOR_BGR2GRAY) if len(roi.shape) == 3 else roi
                    _median = float(np.median(_gray))
                    _bright_ratio = float(np.sum(_gray > 180) / (_gray.size + 1e-6))
                    _dark_ratio = float(np.sum(_gray < 90) / (_gray.size + 1e-6))
                    # 干净白气泡：底色亮(中位>175) + 大部分是背景(亮像素>50%) + 文字占比不高(<40%)
                    _is_clean_bubble = (_median > 175 and _bright_ratio > 0.50 and _dark_ratio < 0.40)
                    # 干净深色气泡：底色暗(中位<80) + 反色白字占比不高
                    _is_clean_dark = (_median < 80 and _bright_ratio < 0.40)

                    text_mask_roi = _build_pixel_text_mask(roi, margin=3)

                    if _is_clean_bubble or _is_clean_dark:
                        # 干净气泡：整块 bbox 置为 mask（内缩 1px 防碰气泡边框）
                        pad = 1
                        y1 = min(h, ry + pad); y2 = min(h, ry + rh - pad)
                        x1 = min(w, rx + pad); x2 = min(w, rx + rw - pad)
                        if y2 > y1 and x2 > x1:
                            full_mask[y1:y2, x1:x2] = 255
                            text_erase_count += 1
                            # 记录纯色填充兜底：用背景主色(排除文字像素后的中位色)
                            try:
                                if _is_clean_bubble:
                                    bg_pixels = roi[_gray > 180]
                                else:
                                    bg_pixels = roi[_gray < 80]
                                if bg_pixels.size >= 3:
                                    fill_bgr = tuple(int(np.median(bg_pixels[:, c])) for c in range(3))
                                else:
                                    fill_bgr = (255, 255, 255) if _is_clean_bubble else (0, 0, 0)
                            except Exception:
                                fill_bgr = (255, 255, 255) if _is_clean_bubble else (0, 0, 0)
                            clean_fill_regions.append((x1, y1, x2, y2, fill_bgr))
                        elif text_mask_roi is not None:
                            ah = min(text_mask_roi.shape[0], h - ry)
                            aw = min(text_mask_roi.shape[1], w - rx)
                            full_mask[ry:ry + ah, rx:rx + aw] = np.maximum(
                                full_mask[ry:ry + ah, rx:rx + aw],
                                text_mask_roi[:ah, :aw].astype(np.uint8))
                            text_erase_count += 1
                    elif text_mask_roi is not None:
                        # 复杂背景(网点/画面)：用精密像素 mask 保护纹理
                        actual_h = min(text_mask_roi.shape[0], h - ry)
                        actual_w = min(text_mask_roi.shape[1], w - rx)
                        full_mask[ry:ry + actual_h, rx:rx + actual_w] = np.maximum(
                            full_mask[ry:ry + actual_h, rx:rx + actual_w],
                            text_mask_roi[:actual_h, :actual_w].astype(np.uint8),
                        )
                        text_erase_count += 1
                    else:
                        # Fallback: small expansion rectangle
                        exp = 2
                        x1 = max(0, rx - exp)
                        y1 = max(0, ry - exp)
                        x2 = min(w, rx + rw + exp)
                        y2 = min(h, ry + rh + exp)
                        full_mask[y1:y2, x1:x2] = 255
                        region_erase_count += 1
                else:
                    region_erase_count += 1
            else:
                # bubble_erase: full region removal
                expansion = 5
                x1 = max(0, rx - expansion)
                y1 = max(0, ry - expansion)
                x2 = min(w, rx + rw + expansion)
                y2 = min(h, ry + rh + expansion)
                full_mask[y1:y2, x1:x2] = 255
            
            # Check for screentone
            if _detect_screentone_region(pil_img, {"x": rx, "y": ry, "width": rw, "height": rh}):
                screentone_count += 1
        
        logger.info(
            f"Inpaint: {erase_mode}, {text_erase_count} text-level regions, "
            f"{region_erase_count} region-level fallback, {screentone_count} screentone regions"
        )
        
        if full_mask.sum() == 0:
            return {
                "result_data": image_data,
                "result_format": "png",
                "method": method,
                "regions_processed": 0,
                "screentone_regions": 0,
                "erase_mode": erase_mode,
                "processing_time_ms": (time.time() - start_time) * 1000,
            }
        
        # Morphological operations for smooth mask
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        full_mask = cv2.dilate(full_mask, kernel, iterations=1)
        
        # Edge feathering
        mask_float = full_mask.astype(np.float32) / 255.0
        mask_float = cv2.GaussianBlur(mask_float, (5, 5), 1.5)
        full_mask = (mask_float * 255).astype(np.uint8)
        full_mask[full_mask > 0] = 255
        
        # ==========================================
        # Inpaint — LaMa ONNX (AI FFC model). NO downgrade to cv2.inpaint.
        # ==========================================
        from .lama_inpainter import inpaint_with_lama, lama_is_available

        if not lama_is_available():
            return {
                "result_data": None, "method": method,
                "regions_processed": 0, "screentone_regions": 0,
                "processing_time_ms": 0,
                "error": "LaMa model not found at models/lama_fp32.onnx",
                "erase_mode": erase_mode,
            }

        result = inpaint_with_lama(img_cv, full_mask)
        if result is None:
            return {
                "result_data": None, "method": "lama_onnx",
                "regions_processed": 0, "screentone_regions": 0,
                "processing_time_ms": (time.time() - start_time) * 1000,
                "error": "LaMa inference failed",
                "erase_mode": erase_mode,
            }

        used_method = "lama_onnx"
        logger.info("Inpaint: LaMa ONNX completed successfully")

        # 干净气泡纯色填充兜底：LaMa 对密集文字仍可能留下淡淡残影，
        # 对判定为干净气泡的区域，直接用背景主色覆盖，保证 0 残留（对标 BalloonsTranslator 的 solid-fill）。
        if clean_fill_regions:
            for (x1, y1, x2, y2, fill_bgr) in clean_fill_regions:
                if y2 > y1 and x2 > x1:
                    result[y1:y2, x1:x2] = fill_bgr
            logger.info(f"Inpaint: solid-filled {len(clean_fill_regions)} clean-bubble regions (zero residue)")
        
        # Screentone-aware post-processing
        if screentone_count > 0:
            for mask_info in masks:
                bbox = mask_info.get("bbox", mask_info.get("boundary", {}))
                if isinstance(bbox, dict):
                    bbox_dict = {
                        "x": int(bbox.get("x", 0)), "y": int(bbox.get("y", 0)),
                        "width": int(bbox.get("width", 100)), "height": int(bbox.get("height", 100)),
                    }
                elif isinstance(bbox, (list, tuple)) and len(bbox) >= 4:
                    bbox_dict = {"x": int(bbox[0]), "y": int(bbox[1]), "width": int(bbox[2]), "height": int(bbox[3])}
                else:
                    continue
                
                if _detect_screentone_region(pil_img, bbox_dict):
                    result = _screentone_aware_blend(img_cv, result, full_mask, bbox_dict)
        
        # Encode result (lossless PNG)
        _, buffer = cv2.imencode(".png", result, [cv2.IMWRITE_PNG_COMPRESSION, 0])
        result_data = buffer.tobytes()
        
        processing_time = (time.time() - start_time) * 1000
        
        return {
            "result_data": result_data,
            "result_format": "png",
            "method": used_method,
            "regions_processed": len(masks),
            "screentone_regions": screentone_count,
            "erase_mode": erase_mode,
            "text_erase_regions": text_erase_count,
            "processing_time_ms": round(processing_time, 1),
        }
    
    except Exception as e:
        logger.error(f"Inpainting failed: {e}", exc_info=True)
        return {
            "result_data": None,
            "method": method,
            "regions_processed": 0,
            "screentones_regions": 0,
            "erase_mode": erase_mode,
            "processing_time_ms": (time.time() - start_time) * 1000,
            "error": str(e),
        }
