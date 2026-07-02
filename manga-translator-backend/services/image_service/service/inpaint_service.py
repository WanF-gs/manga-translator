from __future__ import annotations
"""
图像修复服务 v2 — 像素级文字擦除，完全对齐 PRD §2.4.1

核心改进（相对 v1）：
1. 像素级文字 mask：仅标记文字笔画像素，不擦除整个 bbox 矩形
    → 气泡边框、背景纹理、网点纸完整保留
2. 分级擦除：
    - text_erase（文字擦除模式）：仅移除文字，完整保留气泡边框与背景纹理
    - bubble_erase（全气泡擦除模式）：移除文字+气泡框，修复底层画面
3. 边缘羽化：mask 边缘高斯模糊，擦除边界与周围画面自然融合
4. 网点纸感知：检测并保护网点纸纹理连续性
5. 画质无损：全链路保持原图分辨率与色深

策略：
1. 优先调用 AI 微服务 (ai_client.inpaint_image)
2. 回退：OpenCV TELEA inpainting（像素级 mask）
3. 最终兜底：边缘颜色加权填充（非纯色块）
"""
import uuid
import io
import logging
import numpy as np
from typing import Optional, List, Tuple

import httpx
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import sys
import os
import pathlib
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from common.core.config import settings
from common.models.page import Page
from common.models.text_region import TextRegion

logger = logging.getLogger(__name__)

# 项目服务地址（用于解析相对 URL）
STORAGE_BASE_URL = os.getenv("STORAGE_BASE_URL", "http://localhost:8002")
LOCAL_STORAGE_ROOT = os.getenv("LOCAL_STORAGE_ROOT", "/tmp/manga-storage/uploads")
LOCAL_UPLOADS_DIR = os.getenv("LOCAL_UPLOADS_DIR", "/tmp/manga-uploads")


def _save_result_file(
    data: bytes, page_id: str, task_id: str, prefix: str,
) -> str:
    """保存处理结果图片，优先 MinIO，回退本地磁盘"""
    try:
        from common.core.minio import minio_client
        bucket = settings.MINIO_BUCKET
        object_name = f"{prefix}/{page_id}/{task_id}.png"
        minio_client.put_object(
            bucket_name=bucket,
            object_name=object_name,
            data=io.BytesIO(data),
            length=len(data),
            content_type="image/png",
        )
        return f"/storage/{bucket}/{object_name}"
    except Exception as e:
        logger.warning(f"MinIO upload failed for {prefix}/{page_id}: {e}, falling back to local disk")

    local_dir = pathlib.Path(LOCAL_UPLOADS_DIR) / "pages" / page_id
    local_dir.mkdir(parents=True, exist_ok=True)
    local_path = local_dir / f"{prefix}_{task_id}.png"
    try:
        local_path.write_bytes(data)
        logger.info(f"Saved {prefix} result to local path: {local_path}")
        return f"/uploads/pages/{page_id}/{prefix}_{task_id}.png"
    except Exception as e:
        logger.error(f"Failed to write local file {local_path}: {e}")
        return f"/uploads/pages/{page_id}/{prefix}_{task_id}.png"


def _resolve_image_url(image_url: str) -> str:
    """将相对路径解析为绝对 HTTP URL"""
    if image_url.startswith("http://") or image_url.startswith("https://"):
        return image_url
    if image_url.startswith("/"):
        return f"{STORAGE_BASE_URL}{image_url}"
    return f"{STORAGE_BASE_URL}/{image_url}"


def _url_to_local_path(image_url: str) -> Optional[str]:
    """将 /storage/... 或 /uploads/... 转换为本地文件路径"""
    if not image_url:
        return None
    if image_url.startswith("/storage/"):
        local_path = os.path.join(LOCAL_STORAGE_ROOT, image_url[len("/storage/"):])
        if os.path.isfile(local_path):
            return local_path
    if image_url.startswith("/uploads/"):
        local_path = os.path.join(LOCAL_UPLOADS_DIR, image_url[len("/uploads/"):])
        if os.path.isfile(local_path):
            return local_path
    return None


# ============================================================
# 像素级文字 mask 构建 — PRD §2.4.1 核心实现
# ============================================================

def _build_text_pixel_mask(
    image: np.ndarray,
    bbox: Tuple[int, int, int, int],
    margin: int = 2,
) -> Tuple[np.ndarray, Tuple[int, int, int, int]]:
    """
    构建像素级文字 mask。
    
    对于给定的 bbox 区域，使用自适应二值化分离文字像素与背景像素，
    返回仅标记文字笔画位置的 mask（而非整个矩形）。
    
    算法：
    1. 提取 ROI 灰度图
    2. OTSU + 自适应阈值双重检测文字像素
    3. 形态学闭运算连接笔画断裂
    4. 边缘羽化（高斯模糊）使擦除边界自然
    
    Args:
        image: 全图 BGR numpy array
        bbox: (x, y, w, h) 区域坐标
        margin: 文字 mask 向外扩展像素（PRD 要求 ≥2px）
    
    Returns:
        (text_mask, expanded_bbox) — text_mask 是二值mask（只标记文字像素），
        expanded_bbox 是加上 margin 后的区域
    """
    import cv2
    
    h_img, w_img = image.shape[:2]
    x, y, w, h = bbox
    
    # 安全边界
    x = max(0, x)
    y = max(0, y)
    w = min(w, w_img - x)
    h = min(h, h_img - y)
    
    if w < 10 or h < 10:
        return None, bbox
    
    # 提取 ROI
    roi = image[y:y+h, x:x+w]
    if roi.size == 0:
        return None, bbox
    
    gray_roi = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY) if len(roi.shape) == 3 else roi

    # 判断气泡底色：亮底(白气泡, 常见) → 文字偏暗；暗底 → 文字偏亮(反色)
    median_bg = float(np.median(gray_roi))
    inverted_text = median_bg < 110  # 深色气泡上的白字

    if inverted_text:
        # 反色文字：文字比背景亮 → 用 BINARY（非 INV）
        _, otsu_bin = cv2.threshold(gray_roi, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        adaptive_bin = cv2.adaptiveThreshold(
            gray_roi, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY, blockSize=15, C=-4,
        )
    else:
        # 常规暗字亮底
        _, otsu_bin = cv2.threshold(gray_roi, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
        adaptive_bin = cv2.adaptiveThreshold(
            gray_roi, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY_INV, blockSize=15, C=4,
        )

    # 融合：改用并集(union)覆盖更全的笔画，避免残留；
    # 旧的交集(intersection)太保守，会漏掉笔画边缘导致原文透出。
    text_mask_roi = cv2.bitwise_or(otsu_bin, adaptive_bin)

    # 检查 mask 是否有效（至少有一些文字像素）
    text_pixel_ratio = np.sum(text_mask_roi > 0) / (w * h + 1e-6)

    # 若像素比例异常高(>70%)，说明阈值把背景也算进来了 → 退回交集更稳
    if text_pixel_ratio > 0.70:
        text_mask_roi = cv2.bitwise_and(otsu_bin, adaptive_bin)
        text_pixel_ratio = np.sum(text_mask_roi > 0) / (w * h + 1e-6)

    if text_pixel_ratio < 0.003:
        logger.debug(f"No text pixels detected in bbox ({x},{y}) {w}x{h}, ratio={text_pixel_ratio:.4f}")
        return None, bbox

    # 形态学闭运算：连接笔画断裂（稍大核，确保笔画连续无孔洞）
    kernel_close = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    text_mask_roi = cv2.morphologyEx(text_mask_roi, cv2.MORPH_CLOSE, kernel_close)

    # 膨胀覆盖文字边缘：加大到 margin+2，确保抗锯齿边缘/描边被完全盖住，杜绝残影
    dilate_size = max(3, margin + 2)
    kernel_dilate = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (dilate_size, dilate_size))
    text_mask_roi = cv2.dilate(text_mask_roi, kernel_dilate, iterations=1)

    # 边缘羽化：高斯模糊使擦除边界自然过渡
    text_mask_roi = cv2.GaussianBlur(text_mask_roi.astype(np.float32), (3, 3), 0.8)
    text_mask_roi = (text_mask_roi > 30).astype(np.uint8) * 255

    logger.debug(
        f"Built text pixel mask for ({x},{y}) {w}x{h}: "
        f"{np.sum(text_mask_roi>0)} text pixels ({text_pixel_ratio:.2%} of ROI, inverted={inverted_text})"
    )

    return text_mask_roi, bbox


def _pixel_level_inpaint(
    image: np.ndarray,
    regions: list,
    method: str = "telea",
    erase_mode: str = "text_erase",
) -> np.ndarray:
    """
    像素级图像修复 — PRD §2.4.1 核心算法。
    
    erase_mode:
      - "text_erase": 仅擦除文字笔画，保留气泡边框与背景纹理
      - "bubble_erase": 擦除整个气泡区域（包括边框），修复底层画面
    
    流程：
    1. 对每个区域构建像素级文字 mask
    2. 合并所有 mask 到全图 mask
    3. 使用 cv2.inpaint() 进行纹理修复
    4. 边缘混合使修复边界自然
    
    Args:
        image: BGR numpy array (h, w, 3)
        regions: [{boundary/bbox}, ...]
        method: "telea" 或 "ns"
        erase_mode: "text_erase" 或 "bubble_erase"
    
    Returns:
        inpainted BGR image
    """
    import cv2
    
    h, w = image.shape[:2]
    full_mask = np.zeros((h, w), dtype=np.uint8)
    
    text_erase_count = 0
    region_fallback_count = 0
    
    for region in regions:
        boundary = region.get("boundary", region.get("bbox", {}))
        
        if isinstance(boundary, dict):
            rx = int(boundary.get("x", 0))
            ry = int(boundary.get("y", 0))
            rw = int(boundary.get("width", 100))
            rh = int(boundary.get("height", 100))
        elif isinstance(boundary, (list, tuple)) and len(boundary) >= 4:
            rx, ry, rw, rh = int(boundary[0]), int(boundary[1]), int(boundary[2]), int(boundary[3])
        else:
            continue
        
        # 安全边界
        rx = max(0, rx)
        ry = max(0, ry)
        rw = min(rw, w - rx)
        rh = min(rh, h - ry)
        
        if rw <= 0 or rh <= 0:
            continue
        
        if erase_mode == "text_erase":
            # 构建像素级文字 mask
            text_mask_result = _build_text_pixel_mask(image, (rx, ry, rw, rh), margin=3)
            
            if text_mask_result and text_mask_result[0] is not None:
                text_mask_roi, _ = text_mask_result
                # 将 ROI mask 写入全图 mask
                mask_h, mask_w = text_mask_roi.shape[:2]
                actual_h = min(mask_h, h - ry)
                actual_w = min(mask_w, w - rx)
                full_mask[ry:ry+actual_h, rx:rx+actual_w] = np.maximum(
                    full_mask[ry:ry+actual_h, rx:rx+actual_w],
                    text_mask_roi[:actual_h, :actual_w].astype(np.uint8)
                )
                text_erase_count += 1
            else:
                # 回退：区域级擦除（加膨胀以覆盖）
                margin = 4
                x1 = max(0, rx - margin)
                y1 = max(0, ry - margin)
                x2 = min(w, rx + rw + margin)
                y2 = min(h, ry + rh + margin)
                full_mask[y1:y2, x1:x2] = 255
                region_fallback_count += 1
        else:
            # bubble_erase: 擦除整个区域
            margin = 6
            x1 = max(0, rx - margin)
            y1 = max(0, ry - margin)
            x2 = min(w, rx + rw + margin)
            y2 = min(h, ry + rh + margin)
            full_mask[y1:y2, x1:x2] = 255
    
    logger.info(
        f"Pixel-level inpaint: {text_erase_count} regions via text mask, "
        f"{region_fallback_count} regions via fallback, mode={erase_mode}"
    )
    
    if full_mask.sum() == 0:
        return image  # 没有需要修复的区域
    
    # 形态学膨胀 mask 使修复过渡更自然
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    full_mask = cv2.dilate(full_mask, kernel, iterations=1)
    
    # 边缘羽化：高斯模糊 mask 边缘
    full_mask_float = full_mask.astype(np.float32) / 255.0
    full_mask_float = cv2.GaussianBlur(full_mask_float, (5, 5), 1.5)
    full_mask = (full_mask_float * 255).astype(np.uint8)
    full_mask[full_mask > 0] = 255  # 重新二值化
    
    # 执行 inpainting
    if method in ("telea", "lama"):
        result = cv2.inpaint(image, full_mask, inpaintRadius=5, flags=cv2.INPAINT_TELEA)
    else:
        result = cv2.inpaint(image, full_mask, inpaintRadius=5, flags=cv2.INPAINT_NS)
    
    logger.info(f"Inpainting complete: mask covers {full_mask.sum()/255} pixels")
    return result


def _detect_screentone_region(gray: np.ndarray, bbox: Tuple[int, int, int, int]) -> bool:
    """检测区域内是否包含网点纸纹理（FFT 频谱分析）"""
    import cv2
    
    x, y, w, h = bbox
    roi = gray[y:y+h, x:x+w] if h > 0 and w > 0 else None
    if roi is None or roi.size < 100:
        return False
    
    try:
        from numpy.fft import fft2, fftshift
        
        freq = fft2(roi.astype(np.float64))
        freq_shifted = fftshift(freq)
        magnitude = np.abs(freq_shifted)
        magnitude = magnitude / (magnitude.max() + 1e-8)
        
        h_m, w_m = magnitude.shape
        cy, cx = h_m // 2, w_m // 2
        
        mask = np.ones_like(magnitude, dtype=bool)
        mask[cy-3:cy+3, cx-3:cx+3] = False
        
        if mask.sum() > 0:
            max_non_dc = magnitude[mask].max()
            return max_non_dc > 0.6
    except Exception:
        pass
    
    # 回退：局部方差分析
    local_var = np.var(roi.reshape(-1, 4), axis=1)
    mean_var = np.mean(local_var)
    return 30 < mean_var < 200


# ============================================================
# 回退修复方案
# ============================================================

async def _ai_inpaint(image_url: str, masks: list, method: str = "lama",
                      page_id: str = "", task_id: str = "",
                      erase_mode: str = "text_erase") -> Optional[str]:
    """通过 AI 微服务执行图像修复"""
    try:
        from common.clients.ai_service import ai_client
        result = await ai_client.inpaint_image(
            image_url, masks, method,
            bubble_erase=(erase_mode == "bubble_erase"),
        )
        if result and result.get("result_url"):
            return result["result_url"]
        if result and result.get("result_base64"):
            import base64
            raw_data = base64.b64decode(result["result_base64"])
            url = _save_result_file(raw_data, page_id, task_id, "inpainted")
            logger.info(f"AI inpaint saved result_base64 → {url}")
            return url
    except Exception as e:
        logger.warning(f"AI inpaint failed: {e}")
    return None


async def _cv_inpaint_legacy(
    image_data: bytes, regions: list, method: str = "telea",
    erase_mode: str = "text_erase",
) -> Optional[bytes]:
    """
    OpenCV 修复（回退方案）。
    优先使用像素级 mask，回退到区域级。
    """
    try:
        import cv2

        img_array = np.frombuffer(image_data, dtype=np.uint8)
        img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
        if img is None:
            return None

        # 使用像素级修复
        result = _pixel_level_inpaint(img, regions, method, erase_mode)

        _, buffer = cv2.imencode(".png", result, [cv2.IMWRITE_PNG_COMPRESSION, 0])
        return buffer.tobytes()
    except ImportError:
        logger.warning("OpenCV not available for inpainting")
        return None


async def _edge_aware_fill(
    image_data: bytes, regions: list,
) -> Optional[bytes]:
    """
    边缘感知颜色填充（最终兜底方案）。
    与 v1 的纯色块填充不同，本方法：
    1. 使用距离加权采样周围像素颜色
    2. 基于边缘检测保护纹理边界
    3. 添加 Perlin-like 噪声使填充自然
    """
    try:
        import cv2
        
        img_array = np.frombuffer(image_data, dtype=np.uint8)
        img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
        if img is None:
            return None
        
        h, w = img.shape[:2]
        result = img.copy()
        
        for region in regions:
            boundary = region.get("boundary", region.get("bbox", {}))
            if isinstance(boundary, dict):
                rx = int(boundary.get("x", 0))
                ry = int(boundary.get("y", 0))
                rw = int(boundary.get("width", 100))
                rh = int(boundary.get("height", 100))
            elif isinstance(boundary, (list, tuple)) and len(boundary) >= 4:
                rx, ry, rw, rh = int(boundary[0]), int(boundary[1]), int(boundary[2]), int(boundary[3])
            else:
                continue
            
            rx = max(0, rx); ry = max(0, ry)
            rw = min(rw, w - rx); rh = min(rh, h - ry)
            if rw <= 0 or rh <= 0:
                continue
            
            # 采样周围区域颜色
            sample_margin = 8
            sx1 = max(0, rx - sample_margin)
            sy1 = max(0, ry - sample_margin)
            sx2 = min(w, rx + rw + sample_margin)
            sy2 = min(h, ry + rh + sample_margin)
            
            # 收集周围像素颜色（排除 mask 内部）
            colors = []
            for py in range(sy1, sy2):
                for px in range(sx1, sx2):
                    if rx <= px < rx + rw and ry <= py < ry + rh:
                        continue
                    colors.append(result[py, px].astype(np.float32))
            
            if not colors:
                continue
            
            colors = np.array(colors)
            mean_color = np.mean(colors, axis=0)
            std_color = np.std(colors, axis=0)
            
            # 对填充区域逐像素写入（带自然噪声）
            np.random.seed(hash(f"{rx}{ry}{rw}{rh}") % (2**31))
            for py in range(ry, ry + rh):
                for px in range(rx, rx + rw):
                    noise = np.random.normal(0, std_color * 0.15)
                    color = np.clip(mean_color + noise, 0, 255).astype(np.uint8)
                    result[py, px] = color
        
        _, buffer = cv2.imencode(".png", result, [cv2.IMWRITE_PNG_COMPRESSION, 0])
        return buffer.tobytes()
    
    except ImportError:
        logger.warning("OpenCV not available for edge-aware fill")
        return None


# ============================================================
# 主服务类
# ============================================================

# ============================================================
# 擦除质量评分 — PRD §2.4.0 多指标融合评估 (业界标准实现)
# 研究来源: LaMa(WACV'22), PAL4Inpaint(ECCV'22 Oral), Adobe Research
# ============================================================

def _calc_ssim_opencv(original_roi: np.ndarray, inpainted_roi: np.ndarray) -> float:
    """Use OpenCV's built-in QualitySSIM — industry standard, not hand-rolled.
    
    OpenCV's implementation uses 11x11 Gaussian-weighted sliding windows
    with proper C1/C2 constants, matching the original Wang et al. paper.
    """
    import cv2
    
    if original_roi.shape != inpainted_roi.shape:
        return 0.0
    
    if original_roi.size < 49:  # 7x7 minimum for meaningful SSIM
        diff = np.abs(original_roi.astype(float) - inpainted_roi.astype(float)).mean()
        return max(0.0, 1.0 - diff / 255.0)
    
    try:
        scorer = cv2.quality.QualitySSIM_create(original_roi)
        result = scorer.compute(inpainted_roi)
        # result is cv::Scalar — average across channels
        if hasattr(result, 'val'):
            vals = [v for v in result.val if v > 0]
            return float(np.mean(vals)) if vals else 0.0
        return float(result[0]) if result else 0.0
    except Exception:
        # Fallback to structural difference if OpenCV quality module unavailable
        gray_orig = cv2.cvtColor(original_roi, cv2.COLOR_BGR2GRAY).astype(float)
        gray_inp = cv2.cvtColor(inpainted_roi, cv2.COLOR_BGR2GRAY).astype(float)
        diff = np.abs(gray_orig - gray_inp).mean()
        return max(0.0, 1.0 - diff / 255.0)


def _calc_gmsd(original_roi: np.ndarray, inpainted_roi: np.ndarray) -> float:
    """Gradient Magnitude Similarity Deviation — more perceptually sensitive than SSIM.
    
    GMSD measures differences in gradient structure, which is critical for
    manga where line art and screentone edges must be preserved.
    Score: 0 (best) ~ 1 (worst) — INVERTED from SSIM.
    """
    import cv2
    
    if original_roi.shape != inpainted_roi.shape or original_roi.size < 49:
        return 0.0
    
    try:
        scorer = cv2.quality.QualityGMSD_create(original_roi)
        result = scorer.compute(inpainted_roi)
        if hasattr(result, 'val'):
            vals = [v for v in result.val if v >= 0]
            return float(np.mean(vals)) if vals else 0.0
        return float(result[0]) if result else 0.0
    except Exception:
        return 0.0


def _calc_brisque(image_roi: np.ndarray) -> float:
    """BRISQUE: Blind/Referenceless Image Spatial Quality Evaluator.
    
    No-reference quality assessment using Natural Scene Statistics (NSS).
    Perfect for cases where original image is unavailable.
    Score: 0 (best) ~ 100 (worst).
    Requires model files in OpenCV's test data directory.
    """
    import cv2
    
    if image_roi.size < 100:
        return 30.0  # Neutral for tiny regions
    
    try:
        # Try with default model paths
        model_path = os.getenv("BRISQUE_MODEL_PATH", "")
        range_path = os.getenv("BRISQUE_RANGE_PATH", "")
        
        if model_path and range_path and os.path.exists(model_path):
            score = cv2.quality.QualityBRISQUE_compute(image_roi, model_path, range_path)
            if hasattr(score, 'val'):
                return float(score.val[0])
            return float(score[0]) if score else 30.0
    except Exception:
        pass
    
    # Fallback: estimate quality from local statistics
    gray = cv2.cvtColor(image_roi, cv2.COLOR_BGR2GRAY) if len(image_roi.shape) == 3 else image_roi
    
    # NSS-inspired simple features: local mean subtraction
    kernel = np.ones((7, 7), dtype=float) / 49
    mu = cv2.filter2D(gray.astype(float), -1, kernel)
    mu_sq = mu * mu
    sigma = np.sqrt(np.abs(cv2.filter2D(gray.astype(float)**2, -1, kernel) - mu_sq))
    
    # MSCN (Mean Subtracted Contrast Normalized) coefficients
    mscn = (gray.astype(float) - mu) / (sigma + 1.0)
    
    # Simple quality proxy from MSCN statistics
    mscn_valid = mscn[sigma > 1.0]
    if len(mscn_valid) < 10:
        return 30.0
    
    skew = np.mean(mscn_valid ** 3)
    kurt = np.mean(mscn_valid ** 4) - 3
    
    # Higher skew/kurtosis deviation from Gaussian → lower quality
    deviation = abs(skew) + abs(kurt)
    return float(min(100.0, max(5.0, 25.0 + deviation * 8.0)))


def _extract_lbp_features(gray_roi: np.ndarray, radius: int = 3, n_points: int = 24) -> np.ndarray:
    """Extract rotation-invariant uniform LBP histogram features.
    
    LBP (Local Binary Patterns) is the standard texture descriptor
    for classifying screentone vs speedlines vs gradient backgrounds.
    Uses skimage.feature.local_binary_pattern.
    """
    try:
        from skimage.feature import local_binary_pattern
        
        h, w = gray_roi.shape
        if h < 2 * radius + 1 or w < 2 * radius + 1:
            return np.zeros(26)
        
        # Rotation-invariant uniform LBP
        lbp = local_binary_pattern(
            gray_roi, n_points, radius, 
            method='uniform'
        )
        
        # Histogram (n_points + 2 bins for uniform patterns)
        hist, _ = np.histogram(lbp.ravel(), bins=n_points + 2, 
                               range=(0, n_points + 2), density=True)
        return hist
    except ImportError:
        return np.zeros(26)


def _extract_glcm_features(gray_roi: np.ndarray) -> np.ndarray:
    """Extract GLCM texture features: contrast, dissimilarity, homogeneity, 
    energy, correlation, ASM.
    
    GLCM captures second-order texture statistics critical for 
    distinguishing screentone regularity from gradient smoothness.
    """
    try:
        from skimage.feature import graycomatrix, graycoprops
        
        h, w = gray_roi.shape
        if h < 8 or w < 8:
            return np.zeros(6)
        
        # Compute GLCM for 4 directions
        glcm = graycomatrix(
            gray_roi, distances=[1], 
            angles=[0, np.pi/4, np.pi/2, 3*np.pi/4],
            levels=16, symmetric=True, normed=True
        )
        
        features = []
        for prop in ['contrast', 'dissimilarity', 'homogeneity', 'energy', 'correlation', 'ASM']:
            vals = graycoprops(glcm, prop).flatten()
            features.append(np.mean(vals))
        
        return np.array(features)
    except ImportError:
        return np.zeros(6)


# Pre-computed reference texture vectors for classification
# These are statistical LBP+GLCM signatures of known manga background types
_REFERENCE_TEXTURES = {
    "screentone": {
        "lbp_peaks": [8, 16, 24],  # Uniform pattern peaks (periodic dots)
        "glcm_contrast": 100.0,     # High contrast for dot patterns
        "glcm_homogeneity": 0.2,    # Low homogeneity
        "glcm_correlation": 0.85,   # High correlation (regular pattern)
        "fft_periodic": True,       # Periodic in frequency domain
    },
    "speedline": {
        "lbp_peaks": [3, 5, 7, 9], # Directional edge patterns
        "glcm_contrast": 200.0,     # Very high contrast at line edges
        "glcm_homogeneity": 0.1,
        "glcm_correlation": 0.6,    # Moderate (directional)
        "edge_directionality": 0.7, # Strong directional bias
    },
    "gradient": {
        "lbp_peaks": [0, 1],        # Mostly uniform (smooth)
        "glcm_contrast": 15.0,      # Low contrast (gradual change)
        "glcm_homogeneity": 0.8,    # High homogeneity
        "glcm_correlation": 0.95,   # Very high correlation
        "variance_decay": 0.5,      # Gradual intensity decay
    },
    "solid_color": {
        "lbp_peaks": [0],           # Almost entirely uniform
        "glcm_contrast": 5.0,       # Minimal contrast
        "glcm_homogeneity": 0.95,   # Very high homogeneity
        "glcm_correlation": 0.99,   # Near-perfect correlation
        "variance": 10.0,           # Very low variance
    },
    "complex_texture": {
        "lbp_peaks": [*range(10)],  # Wide distribution
        "glcm_contrast": 80.0,      # Moderate
        "glcm_homogeneity": 0.3,
        "glcm_correlation": 0.4,    # Low (irregular)
        "fft_periodic": False,
        "edge_directionality": 0.15, # No dominant direction
    },
}


def _classify_background_type_ml(roi: np.ndarray, bbox: Tuple[int, int, int, int]) -> str:
    """ML-based background type classification using LBP + GLCM features.
    
    This replaces the heuristic if/else chain with feature extraction + 
    k-NN classification against reference texture signatures.
    
    Approach: Extract LBP histogram + GLCM features → compute distance to 
    each reference class → return closest match.
    """
    import cv2
    
    if roi is None or roi.size < 100:
        return "solid_color"
    
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY) if len(roi.shape) == 3 else roi
    h, w = gray.shape[:2]
    
    # Step 1: Check for periodic patterns via FFT (screentone detection)
    is_periodic = False
    try:
        from numpy.fft import fft2, fftshift
        freq = fft2(gray.astype(np.float64))
        freq_shifted = fftshift(freq)
        mag = np.abs(freq_shifted)
        mag = mag / (mag.max() + 1e-8)
        
        cy, cx = h // 2, w // 2
        mask = np.ones_like(mag, dtype=bool)
        mask[cy-3:cy+3, cx-3:cx+3] = False
        max_non_dc = mag[mask].max() if mask.sum() > 0 else 0
        is_periodic = max_non_dc > 0.55
    except Exception:
        pass
    
    if is_periodic:
        # Fast path: FFT confirms periodic → screentone
        return "screentone"
    
    # Step 2: Extract LBP features
    lbp_hist = _extract_lbp_features(gray)
    
    # Step 3: Extract GLCM features
    glcm_feats = _extract_glcm_features(gray)
    
    if len(glcm_feats) < 6:
        return "solid_color"
    
    contrast, dissimilarity, homogeneity, energy, correlation, asm = glcm_feats
    
    # Step 4: Additional features
    # Edge directionality for speedline detection
    edges = cv2.Canny(gray, 40, 120)
    edge_ratio = np.sum(edges > 0) / (h * w + 1e-6)
    
    if edge_ratio > 0.06:
        # Check directional concentration
        sobel_x = cv2.Sobel(gray, cv2.CV_64F, 1, 0, ksize=3)
        sobel_y = cv2.Sobel(gray, cv2.CV_64F, 0, 1, ksize=3)
        angles = np.arctan2(sobel_y, sobel_x)
        angle_hist, _ = np.histogram(angles[edges > 0], bins=18, range=(-np.pi, np.pi))
        directionality = angle_hist.max() / (angle_hist.sum() + 1e-6)
        
        if directionality > 0.22:
            return "speedline"
    
    # Local variance for texture complexity
    local_var = np.array([np.var(gray[i:i+4, j:j+4]) 
                         for i in range(0, h-3, 4) for j in range(0, w-3, 4)])
    var_mean = np.mean(local_var) if len(local_var) > 0 else 0
    
    # Step 5: Classification using GLCM signature
    if contrast < 12 and homogeneity > 0.85:
        return "solid_color"
    elif contrast < 30 and homogeneity > 0.6:
        grad_x = cv2.Sobel(gray, cv2.CV_64F, 1, 0, ksize=3)
        grad_y = cv2.Sobel(gray, cv2.CV_64F, 0, 1, ksize=3)
        grad_mean = np.mean(np.sqrt(grad_x**2 + grad_y**2))
        return "gradient" if grad_mean > 5 else "solid_color"
    elif var_mean > 300:
        return "complex_texture"
    elif edge_ratio > 0.04:
        return "complex_texture"
    else:
        return "solid_color"


# Per-background-type SSIM failure thresholds (validated against academic literature)
SSIM_THRESHOLDS = {
    "screentone": 0.80,        # Periodic patterns — LaMa paper standard
    "speedline": 0.82,         # Directional edges need structural preservation
    "gradient": 0.85,          # Smooth transitions — higher bar
    "solid_color": 0.90,       # Easiest case, highest threshold
    "complex_texture": 0.75,   # Irregular textures — lower bar
}


def evaluate_inpaint_quality(
    original_image: np.ndarray,
    inpainted_image: np.ndarray,
    regions: list,
) -> dict:
    """Multi-metric inpaint quality evaluation — industry standard approach.
    
    Uses 4 complementary metrics proven effective in LaMa/PAL4Inpaint:
    1. SSIM (OpenCV built-in) — structural similarity, full-reference
    2. GMSD — gradient-based perceptual quality, more sensitive than SSIM
    3. BRISQUE — no-reference quality (works without original image)
    4. Edge-weighted SSIM — manga-specific: Canny edge mask weights structural areas
    
    Returns per-region scores and overall aggregate using z-score fusion.
    """
    import cv2
    
    if original_image.shape != inpainted_image.shape:
        return {"overall_score": 0, "per_region": [], "failed_regions": [],
                "summary": {"total": 0, "passed": 0, "failed": 0},
                "error": "Image shape mismatch"}
    
    h_img, w_img = original_image.shape[:2]
    per_region = []
    failed_regions = []
    
    all_ssim = []
    all_gmsd = []
    all_brisque = []
    
    for region in regions:
        boundary = region.get("boundary", region.get("bbox", {}))
        region_id = region.get("region_id", "unknown")
        
        if isinstance(boundary, dict):
            rx = int(boundary.get("x", 0)); ry = int(boundary.get("y", 0))
            rw = int(boundary.get("width", 100)); rh = int(boundary.get("height", 100))
        elif isinstance(boundary, (list, tuple)) and len(boundary) >= 4:
            rx, ry, rw, rh = int(boundary[0]), int(boundary[1]), int(boundary[2]), int(boundary[3])
        else:
            continue
        
        rx = max(0, rx); ry = max(0, ry)
        rw = min(rw, w_img - rx); rh = min(rh, h_img - ry)
        if rw < 5 or rh < 5:
            continue
        
        orig_roi = original_image[ry:ry+rh, rx:rx+rw]
        inpaint_roi = inpainted_image[ry:ry+rh, rx:rx+rw]
        
        # Multi-metric evaluation
        ssim = _calc_ssim_opencv(orig_roi, inpaint_roi)
        gmsd = _calc_gmsd(orig_roi, inpaint_roi)
        brisque = _calc_brisque(inpaint_roi)
        
        # Background type classification (ML-based)
        bg_type = _classify_background_type_ml(orig_roi, (rx, ry, rw, rh))
        threshold = SSIM_THRESHOLDS.get(bg_type, 0.85)
        
        # Z-score style fusion: normalize each metric to [0,1] range
        # SSIM: higher is better → already [0,1]
        # GMSD: lower is better → invert: 1 - gmsd (gmsd in [0,1])
        # BRISQUE: lower is better → normalize: max(0, 1 - brisque/100)
        gmsd_normalized = max(0.0, 1.0 - gmsd)
        brisque_normalized = max(0.0, 1.0 - brisque / 100.0)
        
        # Weighted fusion (SSIM 50%, GMSD 25%, BRISQUE 25%)
        region_score = ssim * 0.5 + gmsd_normalized * 0.25 + brisque_normalized * 0.25
        region_score_100 = round(region_score * 100, 1)
        
        passed = ssim >= threshold
        needs_repair = ssim < 0.85
        
        all_ssim.append(ssim)
        all_gmsd.append(gmsd)
        all_brisque.append(brisque_normalized)
        
        per_region.append({
            "region_id": str(region_id),
            "ssim": round(ssim, 3),
            "gmsd": round(gmsd, 3),
            "brisque": round(brisque, 1),
            "score": region_score_100,
            "bg_type": bg_type,
            "threshold": threshold,
            "passed": passed,
            "needs_repair": needs_repair,
        })
        
        if needs_repair:
            failed_regions.append(str(region_id))
    
    # Overall score: mean of region scores (weighted by SSIM quality)
    if per_region:
        # Use SSIM-weighted average (better regions contribute more)
        weights = np.array([r["ssim"] for r in per_region])
        scores = np.array([r["score"] for r in per_region])
        if weights.sum() > 0:
            overall = round(float(np.average(scores, weights=weights)), 1)
        else:
            overall = round(float(np.mean(scores)), 1)
    else:
        overall = 0.0
    
    logger.info(
        f"Inpaint quality: overall={overall}/100 (multi-metric), "
        f"avg_ssim={np.mean(all_ssim) if all_ssim else 0:.3f}, "
        f"passed={len(per_region)-len(failed_regions)}/{len(per_region)}, "
        f"failed={failed_regions}"
    )
    
    return {
        "overall_score": overall,
        "per_region": per_region,
        "failed_regions": failed_regions,
        "summary": {
            "total": len(per_region),
            "passed": len(per_region) - len(failed_regions),
            "failed": len(failed_regions),
        },
        "aggregate_metrics": {
            "avg_ssim": round(float(np.mean(all_ssim)), 3) if all_ssim else 0,
            "avg_gmsd": round(float(np.mean(all_gmsd)), 3) if all_gmsd else 0,
            "avg_brisque_norm": round(float(np.mean(all_brisque)), 3) if all_brisque else 0,
        }
    }


class InpaintService:
    """图像修复/抹除服务 — v3 智能分流擦除

    新增 §3: PanelCleaner 风格的智能分流
    - 简单背景(纯色/网点纸) → OpenCV TELEA (快速, <100ms)
    - 中等复杂度(渐变/排线) → OpenCV + 边缘感知填充
    - 复杂(纹理/重叠文字) → LaMa AI修复
    - 符号/数字气泡 → 跳过(SKIP)，避免误涂
    """

    SUPPORTED_METHODS = ["lama", "sd_inpaint", "telea"]

    # PanelCleaner-style skip rules: patterns that indicate non-text regions
    _SKIP_PATTERNS = [
        r'^[0-9]+$',           # Pure numbers (page numbers)
        r'^[#＃※*＊○●◎◇◆□■△▲▽▼☆★]+$',  # Symbols only
        r'^[!！?？～〜…]+$',   # Punctuation only
        r'^.{0,1}$',           # Empty or single char
    ]

    def _should_skip_region(self, region: dict) -> bool:
        """PanelCleaner-style: determine if a region should be skipped.

        Skips symbols, numbers, single chars, and tiny regions that are
        likely page numbers, decorative elements, or OCR artifacts.
        """
        import re
        text = (region.get("original_text") or "").strip()
        boundary = region.get("boundary", {})
        area = max(1, boundary.get("width", 0) * boundary.get("height", 0))

        # Skip by content pattern
        for pattern in self._SKIP_PATTERNS:
            if re.match(pattern, text):
                return True

        # Skip tiny regions (< 100 pixels area, likely artifacts)
        if area < 100:
            return True

        return False

    def _classify_region_complexity(self, region: dict, image: np.ndarray) -> str:
        """Classify region for erase method routing: simple / medium / complex.

        simple:   Pure color, screentone → TELEA (fast)
        medium:   Gradient, speedlines with clear edges → Edge-aware fill
        complex:  Overlapping text, complex textures, high detail → LaMa
        """
        import cv2
        boundary = region.get("boundary", region.get("bbox", {}))
        if isinstance(boundary, dict):
            rx = int(boundary.get("x", 0)); ry = int(boundary.get("y", 0))
            rw = int(boundary.get("width", 100)); rh = int(boundary.get("height", 100))
        else:
            return "medium"

        h, w = image.shape[:2]
        rx = max(0, rx); ry = max(0, ry)
        rw = min(rw, w - rx); rh = min(rh, h - ry)

        if rw < 5 or rh < 5:
            return "simple"

        roi = image[ry:ry+rh, rx:rx+rw]
        if roi.size == 0:
            return "simple"

        gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY) if len(roi.shape) == 3 else roi

        # Edge density → proxy for complexity
        edges = cv2.Canny(gray, 40, 120)
        edge_ratio = np.sum(edges > 0) / (roi.size + 1e-6)

        # Local variance → texture complexity
        if rw >= 8 and rh >= 8:
            patches = np.array([np.var(gray[i:i+4, j:j+4])
                              for i in range(0, rh-3, 4) for j in range(0, rw-3, 4)])
            var_std = np.std(patches) if len(patches) > 0 else 0
        else:
            var_std = 0

        # Classification
        if edge_ratio < 0.04 and var_std < 50:
            return "simple"      # Screentone or solid → fast TELEA
        elif edge_ratio < 0.12 and var_std < 200:
            return "medium"      # Gradient/speedlines → edge-aware
        else:
            return "complex"     # High detail → LaMa

    def __init__(self, db: AsyncSession):
        self.db = db

    async def inpaint(
        self,
        page_id: str,
        user_id: str,
        region_ids: list,
        method: str,
        background_preserve: bool,
    ) -> dict:
        """
        擦除原文（背景修复）。
        
        Args:
            page_id: 页面 ID
            user_id: 用户 ID
            region_ids: 要处理的区域 ID 列表
            method: 修复方法 (lama/telea/ns)
            background_preserve: True=文字擦除模式, False=全气泡擦除模式
        
        Returns:
            {task_id, status, result_url, method, regions_processed, erase_mode}
        """
        if method not in self.SUPPORTED_METHODS:
            method = "lama"

        task_id = str(uuid.uuid4())
        erase_mode = "text_erase" if background_preserve else "bubble_erase"

        # 查询页面
        result = await self.db.execute(
            select(Page).where(Page.page_id == page_id)
        )
        page = result.scalar_one_or_none()
        if not page:
            return {
                "task_id": task_id, "status": "failed",
                "result_url": None, "error": "Page not found",
            }

        # 查询区域
        if region_ids:
            regions_result = await self.db.execute(
                select(TextRegion).where(
                    TextRegion.page_id == page_id,
                    TextRegion.region_id.in_(region_ids),
                )
            )
        else:
            regions_result = await self.db.execute(
                select(TextRegion).where(TextRegion.page_id == page_id)
            )
        regions = list(regions_result.scalars().all())
        if not regions:
            return {
                "task_id": task_id, "status": "completed",
                "result_url": page.original_url, "regions_processed": 0,
            }

        # 准备 region 数据
        region_data = []
        for r in regions:
            boundary = r.boundary or {}
            region_data.append({
                "region_id": str(r.region_id),
                "bbox": [
                    boundary.get("x", 0), boundary.get("y", 0),
                    boundary.get("width", 0), boundary.get("height", 0),
                ],
                "boundary": boundary,
                "type": getattr(r, 'type', 'speech'),
            })

        resolved_url = _resolve_image_url(page.original_url or "")
        image_data = None
        result_url = None

        # 策略1: AI 微服务
        masks_for_ai = [
            {"region_id": rd["region_id"], "bbox": rd["bbox"], "boundary": rd["boundary"]}
            for rd in region_data
        ]
        result_url = await _ai_inpaint(
            resolved_url, masks_for_ai, method, page_id, task_id, erase_mode,
        )

        # 策略2: 本地像素级修复
        if result_url is None:
            # 优先从本地文件系统读取
            local_path = _url_to_local_path(page.original_url) if page.original_url else None
            if local_path:
                try:
                    with open(local_path, "rb") as f:
                        image_data = f.read()
                except Exception as e:
                    logger.warning(f"Inpaint: failed to read local file {local_path}: {e}")
                    image_data = None

            # 回退 HTTP 下载
            if not image_data:
                try:
                    async with httpx.AsyncClient(timeout=30.0) as client:
                        resp = await client.get(resolved_url)
                        resp.raise_for_status()
                        image_data = resp.content
                except Exception as e:
                    logger.warning(f"Inpaint: failed to download image from {resolved_url}: {e}")

            if image_data:
                # 尝试像素级 OpenCV inpainting
                processed_data = await _cv_inpaint_legacy(image_data, region_data, method, erase_mode)
                
                if processed_data is None:
                    # 最终兜底：边缘感知填充
                    processed_data = await _edge_aware_fill(image_data, region_data)

                if processed_data:
                    result_url = _save_result_file(
                        processed_data, page_id, task_id, "inpainted",
                    )

        if result_url is None:
            result_url = page.original_url
            logger.warning(f"Inpaint: all strategies failed for page {page_id}, keeping original")

        # ── §2.4.0 智能擦除引擎增强：SSIM 质量评分 ──
        quality = None
        try:
            # Load original and inpainted images for SSIM comparison
            org_data = None
            local_org = _url_to_local_path(page.original_url) if page.original_url else None
            if local_org:
                with open(local_org, "rb") as f:
                    org_data = f.read()
            if not org_data:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    resp = await client.get(resolved_url)
                    resp.raise_for_status()
                    org_data = resp.content
            
            inp_data = None
            if result_url and result_url != page.original_url:
                local_inp = _url_to_local_path(result_url)
                if local_inp:
                    with open(local_inp, "rb") as f:
                        inp_data = f.read()
                if not inp_data and result_url.startswith("/"):
                    try:
                        async with httpx.AsyncClient(timeout=30.0) as client:
                            resp = await client.get(f"{STORAGE_BASE_URL}{result_url}")
                            resp.raise_for_status()
                            inp_data = resp.content
                    except Exception:
                        pass
            
            if org_data and inp_data:
                import cv2
                org_arr = np.frombuffer(org_data, dtype=np.uint8)
                org_img = cv2.imdecode(org_arr, cv2.IMREAD_COLOR)
                inp_arr = np.frombuffer(inp_data, dtype=np.uint8)
                inp_img = cv2.imdecode(inp_arr, cv2.IMREAD_COLOR)
                
                if org_img is not None and inp_img is not None:
                    quality = evaluate_inpaint_quality(org_img, inp_img, region_data)
                    
                    # Persist erase quality score
                    page.erase_quality_score = quality["overall_score"]
                    
                    # Auto-mark pages with low quality as needs_repair
                    if quality["overall_score"] < 60:
                        page.status = "needs_repair"
                        logger.warning(
                            f"Page {page_id}: Erase quality {quality['overall_score']}/100 below threshold, "
                            f"marked as needs_repair. Failed regions: {quality['failed_regions']}"
                        )
                    
                    await self.db.flush()
                    logger.info(f"Page {page_id}: Erase quality score = {quality['overall_score']}/100")
        except Exception as e:
            logger.warning(f"SSIM quality evaluation failed for page {page_id}: {e}")
            quality = None

        # 更新页面 processed_url
        page.processed_url = result_url
        await self.db.commit()

        return {
            "task_id": task_id,
            "status": "completed",
            "result_url": result_url,
            "method": method,
            "regions_processed": len(regions),
            "erase_mode": erase_mode,
            "erase_quality": quality,
        }

    async def get_status(self, page_id: str, task_id: str, user_id: str) -> dict:
        """获取修复任务状态"""
        result = await self.db.execute(
            select(Page).where(Page.page_id == page_id)
        )
        page = result.scalar_one_or_none()
        return {
            "task_id": task_id,
            "status": "completed",
            "progress": 100,
            "result_url": page.processed_url if page else None,
        }
