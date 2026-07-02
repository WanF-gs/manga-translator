from __future__ import annotations
"""
Erase Quality Evaluation API — SSIM / PSNR / Edge Preservation scoring.
Evaluates erase quality by comparing pre-erase and post-erase images.
Part of PRD v3.0 Smart Erase Engine enhancement.
"""
import io
import logging
import numpy as np
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, Body
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from PIL import Image

import sys, os, pathlib
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from common.core.database import get_db
from common.core.response import success_response
from common.models.page import Page

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/erase-quality", tags=["Erase Quality"])


class EraseQualityRequest(BaseModel):
    """擦除质量评估请求 — P1 FIX: 兼容多种调用格式。
    
    支持两种方式传图：
    A) 前后对比: original_image_url + erased_image_url（两图对比评分）
    B) 单图模式: image_url 或 image_base64（仅评估擦除后图片的伪影/边缘质量）
    
    PRD §2.4.0: 擦除质量评分 ≥ 75 分。支持分背景类型质量标准。
    """
    page_id: Optional[str] = None
    image_url: Optional[str] = None           # 擦除后图片 URL（兼容旧调用方）
    image_base64: Optional[str] = None        # 擦除后图片 base64（兼容 ai-gateway 格式）
    original_image_url: Optional[str] = None  # 原始图片 URL（前后对比模式）
    erased_image_url: Optional[str] = None    # 擦除后图片 URL（前后对比模式）
    method: str = "telea"
    original_regions: List[Dict[str, Any]] = []
    background_type: Optional[str] = None     # P0: 背景类型 — screentone/gradient/solid/complex


def _load_image(data: bytes) -> np.ndarray:
    """Load image bytes as grayscale numpy array."""
    img = Image.open(io.BytesIO(data)).convert("L")
    return np.array(img, dtype=np.float64)


def ssim_score(img1: np.ndarray, img2: np.ndarray, L: float = 255.0,
               k1: float = 0.01, k2: float = 0.03) -> float:
    """
    Structural Similarity Index (SSIM) calculator.
    Uses 8x8 sliding window with Gaussian kernel.
    """
    from scipy.ndimage import uniform_filter, gaussian_filter
    import warnings
    warnings.filterwarnings("ignore", category=RuntimeWarning)

    c1 = (k1 * L) ** 2
    c2 = (k2 * L) ** 2

    mu1 = gaussian_filter(img1, sigma=1.5)
    mu2 = gaussian_filter(img2, sigma=1.5)
    mu1_sq = mu1 * mu1
    mu2_sq = mu2 * mu2
    mu1_mu2 = mu1 * mu2
    sigma1_sq = gaussian_filter(img1 * img1, sigma=1.5) - mu1_sq
    sigma2_sq = gaussian_filter(img2 * img2, sigma=1.5) - mu2_sq
    sigma12 = gaussian_filter(img1 * img2, sigma=1.5) - mu1_mu2

    ssim_map = ((2 * mu1_mu2 + c1) * (2 * sigma12 + c2)) / \
               ((mu1_sq + mu2_sq + c1) * (sigma1_sq + sigma2_sq + c2))
    return float(np.mean(ssim_map))


def psnr_score(img1: np.ndarray, img2: np.ndarray, max_val: float = 255.0) -> float:
    """Peak Signal-to-Noise Ratio."""
    mse = np.mean((img1 - img2) ** 2)
    if mse == 0:
        return 100.0
    return float(20 * np.log10(max_val / np.sqrt(mse)))


def edge_preservation(img1: np.ndarray, img2: np.ndarray) -> float:
    """
    Edge preservation index.
    Measures how well erase preserves original structural edges.
    """
    from scipy.ndimage import sobel
    edges1 = sobel(img1)
    edges2 = sobel(img2)
    numerator = np.sum(edges1 * edges2)
    denominator = np.sqrt(np.sum(edges1 ** 2) * np.sum(edges2 ** 2))
    if denominator == 0:
        return 1.0
    return float(numerator / denominator)


def texture_continuity(original: np.ndarray, inpainted: np.ndarray,
                       mask: np.ndarray) -> float:
    """
    Evaluate texture continuity around erased regions.
    Measure how similar surrounding texture is between original and result.
    """
    # Dilate mask to get boundary zone
    from scipy.ndimage import binary_dilation
    inner = mask > 0
    boundary = binary_dilation(inner, iterations=5) & ~binary_dilation(inner, iterations=10)
    if not np.any(boundary):
        return 1.0
    orig_tex = np.std(original[boundary])
    inp_tex = np.std(inpainted[boundary])
    if orig_tex == 0:
        return 1.0
    return float(1.0 - min(abs(orig_tex - inp_tex) / orig_tex, 1.0))


# ── P0: Background-type-specific quality thresholds (§2.4.0) ──
# Different background types have different expectations:
#  - Solid color: near-perfect (SSIM ≥ 0.95)
#  - Gradient: smooth transition (SSIM ≥ 0.90)
#  - Screentone/dot: texture preservation (SSIM ≥ 0.85, texture ≥ 0.75)
#  - Complex scene: structural integrity (SSIM ≥ 0.80, edge ≥ 0.70)

BACKGROUND_THRESHOLDS = {
    "solid": {
        "label": "纯色背景",
        "pass_score": 80,
        "ssim_min": 0.95,
        "edge_min": 0.90,
        "texture_min": 0.80,
        "description": "纯色区域擦除应近乎完美，残留痕迹不可接受",
    },
    "gradient": {
        "label": "渐变背景",
        "pass_score": 75,
        "ssim_min": 0.90,
        "edge_min": 0.85,
        "texture_min": 0.80,
        "description": "渐变过渡需平滑，允许轻微边缘差异",
    },
    "screentone": {
        "label": "网点纸背景",
        "pass_score": 70,
        "ssim_min": 0.85,
        "edge_min": 0.75,
        "texture_min": 0.75,
        "description": "网点纹理修复需保持视觉一致性",
    },
    "complex": {
        "label": "复杂场景背景",
        "pass_score": 65,
        "ssim_min": 0.80,
        "edge_min": 0.70,
        "texture_min": 0.65,
        "description": "复杂场景允许更多容差，关注结构完整性",
    },
}

DEFAULT_THRESHOLD = BACKGROUND_THRESHOLDS["complex"]


def get_background_threshold(bg_type: Optional[str]) -> dict:
    """Get quality thresholds for a background type, with fallback."""
    if bg_type and bg_type in BACKGROUND_THRESHOLDS:
        return BACKGROUND_THRESHOLDS[bg_type]
    return DEFAULT_THRESHOLD


@router.post("/evaluate")
async def evaluate_erase_quality(
    body: EraseQualityRequest = Body(...),
    db: AsyncSession = Depends(get_db)
) -> dict:
    """
    P1 FIX: 擦除质量评分（SSIM/PSNR/边缘保持/纹理连续性）。
    
    接受 JSON Body 格式（兼容 test_prd_quality.py 调用方）：
    ```json
    {
        "image_url": "http://...",           // 擦除后图片（必填，至少一个）
        "image_base64": "...",               // 或 base64
        "original_image_url": "http://...",  // 原始图片（可选，用于前后对比）
        "original_regions": [{"bbox": [...]}],
        "method": "telea"
    }
    ```
    
    返回：erase_quality_score (0-100)，ssim, psnr, edge_preservation, texture_continuity
    """
    import httpx
    import base64
    from common.core.config import settings

    try:
        # ---- 解析图片：支持 image_url / image_base64 / erased_image_url ----
        erased_data = None
        if body.image_base64:
            erased_data = base64.b64decode(body.image_base64)
        elif body.image_url:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(body.image_url)
                resp.raise_for_status()
                erased_data = resp.content
        elif body.erased_image_url:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(body.erased_image_url)
                resp.raise_for_status()
                erased_data = resp.content

        if not erased_data:
            raise HTTPException(status_code=422, detail="No image provided. Send image_url, image_base64, or erased_image_url")

        # ---- 解析原始图片（前后对比模式） ----
        original_data = None
        if body.original_image_url:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(body.original_image_url)
                resp.raise_for_status()
                original_data = resp.content

        # ---- 加载图片 ----
        erased = _load_image(erased_data)

        if original_data:
            original = _load_image(original_data)
        else:
            # 单图模式：用擦除后图片自身作为参考（评估绝对质量）
            original = erased.copy()
            logger.info("Single-image mode: evaluating absolute erase quality (artifacts/edges)")

        # 确保尺寸一致
        if original.shape != erased.shape:
            from PIL import Image as PILImg
            erased_pil = PILImg.open(io.BytesIO(erased_data)).convert("L")
            erased_pil = erased_pil.resize(
                (original.shape[1], original.shape[0]), PILImg.LANCZOS
            )
            erased = np.array(erased_pil, dtype=np.float64)

        # ---- 计算指标 ----
        ssim = ssim_score(original, erased)
        psnr = psnr_score(original, erased)
        edge_pres = edge_preservation(original, erased)

        # 纹理连续性：需要 mask，从 regions 推断
        mask_arr = None
        if body.original_regions and original_data:
            try:
                from scipy.ndimage import binary_dilation
                orig_img = Image.open(io.BytesIO(original_data)).convert("L")
                mask_arr = np.zeros((orig_img.height, orig_img.width), dtype=np.uint8)
                for region in body.original_regions:
                    bbox = region.get("bbox", [0, 0, 100, 100])
                    if isinstance(bbox, dict):
                        x, y, w, h = bbox.get("x", 0), bbox.get("y", 0), bbox.get("width", 100), bbox.get("height", 100)
                    elif isinstance(bbox, (list, tuple)) and len(bbox) >= 4:
                        x, y, w, h = int(bbox[0]), int(bbox[1]), int(bbox[2]), int(bbox[3])
                    else:
                        continue
                    x, y = max(0, x), max(0, y)
                    w = min(w, mask_arr.shape[1] - x)
                    h = min(h, mask_arr.shape[0] - y)
                    if w > 0 and h > 0:
                        mask_arr[y:y+h, x:x+w] = 255
                if mask_arr.any():
                    mask_arr = mask_arr.astype(np.float64)
            except Exception as e:
                logger.debug(f"Mask generation skipped: {e}")

        tex_cont = texture_continuity(original, erased, mask_arr) if mask_arr is not None else 1.0

        # 像素差异
        diff = np.abs(original - erased) / 255.0
        pixel_diff_pct = float(np.mean(diff))

        # ---- 综合评分 ----
        composite = (
            ssim * 0.35 +
            (min(psnr / 40.0, 1.0)) * 0.25 +
            edge_pres * 0.25 +
            tex_cont * 0.15
        ) * 100.0
        composite = min(100.0, max(0.0, composite))

        # P0: Background-type-specific quality assessment
        bg_threshold = get_background_threshold(body.background_type)
        bg_label = bg_threshold["label"]
        pass_score = bg_threshold["pass_score"]

        # Per-metric pass/fail checks
        metrics_pass = {
            "ssim": ssim >= bg_threshold["ssim_min"],
            "edge_preservation": edge_pres >= bg_threshold["edge_min"],
            "texture_continuity": tex_cont >= bg_threshold["texture_min"],
        }
        overall_pass = composite >= pass_score and all(metrics_pass.values())

        # 推荐等级 + 失败原因
        if composite >= 85 and overall_pass:
            recommendation = "excellent"
        elif composite >= pass_score and overall_pass:
            recommendation = "good"
        elif composite >= pass_score - 10:
            recommendation = "acceptable"
        else:
            recommendation = "poor"

        # 失败维度说明
        failed_metrics = [k for k, v in metrics_pass.items() if not v]
        failure_reason = None
        if not overall_pass:
            reason_parts = []
            if composite < pass_score:
                reason_parts.append(f"综合评分 {composite:.1f} < {pass_score}")
            if failed_metrics:
                reason_parts.append(f"指标不达标: {', '.join(failed_metrics)}")
            failure_reason = "; ".join(reason_parts)

        # ---- 持久化评分到 DB ----
        if body.page_id:
            try:
                from common.models.page import Page
                page = await db.get(Page, body.page_id)
                if page:
                    page.erase_quality_score = composite
                    await db.commit()
            except Exception as e:
                logger.debug(f"Failed to persist erase score: {e}")

        return {
            "code": 0,
            "message": "success",
            "data": {
                "erase_quality_score": round(composite, 2),
                "ssim": round(ssim, 4),
                "psnr": round(psnr, 2),
                "edge_preservation": round(edge_pres, 4),
                "texture_continuity": round(tex_cont, 4),
                "pixel_diff_percent": round(pixel_diff_pct * 100, 2),
                "recommendation": recommendation,
                "mode": "comparison" if original_data else "single_image",
                # P0: Background-type-specific fields
                "background_type": body.background_type or "unknown",
                "background_label": bg_label,
                "pass_score": pass_score,
                "overall_pass": overall_pass,
                "metrics_pass": metrics_pass,
                "failure_reason": failure_reason,
            }
        }

    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="Failed to download images")
    except Exception as e:
        logger.exception("Erase quality evaluation failed")
        raise HTTPException(status_code=500, detail=str(e))
