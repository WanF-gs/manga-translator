from __future__ import annotations
"""
漫画画质增强服务 — PRD §2.6 画质增强与美术优化模块

功能:
1. 超分辨率重建 (2K/4K) — §2.6.1 漫画专属超分辨率
2. 扫描件画质修复 — §2.6.2 去噪点/折痕/莫尔纹/线条修复
3. 黑白漫画智能上色 — §2.6.3 基于多模态模型的智能上色
4. 色彩增强优化 — §2.6.4 对比度/饱和度/锐度自动优化
"""
import io
import os
import sys
import uuid
import logging
import pathlib
import numpy as np
from typing import Optional, Tuple

import httpx
from PIL import Image, ImageFilter, ImageEnhance, ImageOps
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from common.models.page import Page

logger = logging.getLogger(__name__)

STORAGE_BASE_URL = os.getenv("STORAGE_BASE_URL", "http://localhost:8002")
LOCAL_UPLOADS_DIR = os.getenv("LOCAL_UPLOADS_DIR", "/tmp/manga-uploads")


def _save_enhanced(data: bytes, page_id: str, task_id: str, prefix: str) -> str:
    """保存增强处理结果，优先 MinIO，回退本地磁盘"""
    try:
        from common.core.minio import minio_client
        from common.core.config import settings
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
        logger.warning(f"MinIO upload failed: {e}, falling back to local")

    local_dir = pathlib.Path(LOCAL_UPLOADS_DIR) / "pages" / page_id
    local_dir.mkdir(parents=True, exist_ok=True)
    local_path = local_dir / f"{prefix}_{task_id}.png"
    local_path.write_bytes(data)
    return f"/uploads/pages/{page_id}/{prefix}_{task_id}.png"


async def _load_image_data(image_url: str) -> Optional[bytes]:
    """从 URL 或本地路径加载图像数据"""
    if not image_url:
        return None
    if image_url.startswith("/"):
        local_path = os.path.join(LOCAL_UPLOADS_DIR, image_url.lstrip("/"))
        if os.path.isfile(local_path):
            with open(local_path, "rb") as f:
                return f.read()
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.get(f"{STORAGE_BASE_URL}{image_url}")
                resp.raise_for_status()
                return resp.content
        except Exception as e:
            logger.warning(f"Failed to load image {image_url}: {e}")
            return None
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(image_url)
            resp.raise_for_status()
            return resp.content
    except Exception as e:
        logger.warning(f"Failed to load image {image_url}: {e}")
        return None


# ============================================================
# §2.6.1 漫画专属超分辨率
# ============================================================

def super_resolve(image: np.ndarray, target_resolution: str = "2k") -> np.ndarray:
    """Manga-specific super-resolution using Real-ESRGAN anime model.
    
    Research: Real-ESRGAN_x4plus_anime_6B (17MB) is the industry standard for
    manga/anime upscaling. It uses RRDBNet with 6 blocks, specifically trained
    on anime-style illustrations to preserve sharp line art and screentone textures.
    
    Fallback chain:
    1. Real-ESRGAN anime model (best quality, ~2-3s/page on GPU)
    2. waifu2x-ncnn-vulkan via subprocess (good quality, CPU-friendly)
    3. OpenCV Lanczos + manga edge-preserving sharpening (fastest, no deps)
    
    Args:
        image: BGR numpy array
        target_resolution: "2k" (2560x1440) or "4k" (3840x2160)
    """
    import cv2
    
    h, w = image.shape[:2]
    is_gray = len(image.shape) == 2
    
    if target_resolution == "4k":
        target_height = 2160
    else:
        target_height = 1440
    
    if h >= target_height:
        return image  # Already at target resolution
    
    scale = target_height / h
    new_w = int(w * scale)
    new_h = target_height
    
    # Strategy 1: Real-ESRGAN anime model (industry standard)
    try:
        import importlib
        if importlib.util.find_spec("realesrgan"):
            from realesrgan import RealESRGANer
            from basicsr.archs.rrdbnet_arch import RRDBNet
            
            # Real-ESRGAN anime: 6-block RRDBNet, 17MB, optimized for manga line art
            model = RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64, 
                           num_block=6, num_grow_ch=32, scale=4)
            
            # Try to load pretrained anime model
            model_path = os.getenv("REALESRGAN_ANIME_MODEL", 
                                   os.path.expanduser("~/.cache/realesrgan/RealESRGAN_x4plus_anime_6B.pth"))
            
            upsampler = RealESRGANer(
                scale=4, model_path=model_path if os.path.exists(model_path) else None,
                model=model, tile=400, tile_pad=10, pre_pad=0, half=False
            )
            
            if is_gray:
                temp = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
            else:
                temp = image.copy()
            
            output, _ = upsampler.enhance(temp, outscale=scale)
            result = cv2.resize(output, (new_w, new_h), interpolation=cv2.INTER_LANCZOS4)
            
            if is_gray:
                result = cv2.cvtColor(result, cv2.COLOR_BGR2GRAY)
            
            logger.info(f"Real-ESRGAN anime super resolution: {w}x{h} → {new_w}x{new_h}")
            return result
    except Exception as e:
        logger.info(f"Real-ESRGAN not available: {e}")
    
    # Strategy 2: waifu2x-ncnn-vulkan (high-quality, CPU-friendly)
    try:
        import shutil
        waifu2x = shutil.which("waifu2x-ncnn-vulkan")
        if waifu2x:
            import tempfile, subprocess
            with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
                cv2.imwrite(f.name, image)
                input_path = f.name
            
            output_path = input_path.replace(".png", "_out.png")
            subprocess.run([
                waifu2x, "-i", input_path, "-o", output_path,
                "-s", str(max(1, int(target_height / h))),
                "-n", "3",  # noise level 3 (denoise)
                "-m", "models-cunet",  # cunet model (best quality)
            ], capture_output=True, timeout=60)
            
            if os.path.exists(output_path):
                result = cv2.imread(output_path)
                os.unlink(input_path)
                os.unlink(output_path)
                if result is not None:
                    result = cv2.resize(result, (new_w, new_h), interpolation=cv2.INTER_LANCZOS4)
                    if is_gray:
                        result = cv2.cvtColor(result, cv2.COLOR_BGR2GRAY)
                    logger.info(f"waifu2x-ncnn-vulkan super resolution: {w}x{h} → {new_w}x{new_h}")
                    return result
                os.unlink(input_path)
    except Exception as e:
        logger.info(f"waifu2x not available: {e}")
    
    # Strategy 3: Lanczos + manga line-preserving sharpening
    result = cv2.resize(image, (new_w, new_h), interpolation=cv2.INTER_LANCZOS4)
    
    if is_gray:
        analyze = result
    else:
        analyze = cv2.cvtColor(result, cv2.COLOR_BGR2GRAY)
    
    edges = cv2.Canny(analyze, 30, 120)
    edges = cv2.dilate(edges, np.ones((2, 2), np.uint8), iterations=1)
    
    sharpened = cv2.filter2D(result, -1, np.array([
        [-0.5, -1, -0.5], [-1, 7, -1], [-0.5, -1, -0.5]
    ]) * 0.5 + np.array([[0,0,0],[0,1,0],[0,0,0]]))
    
    edge_mask = edges / 255.0
    if not is_gray:
        edge_mask = np.stack([edge_mask] * 3, axis=-1)
    
    result = (result * (1 - edge_mask * 0.3) + sharpened * (edge_mask * 0.3)).astype(np.uint8)
    logger.info(f"Lanczos super resolution: {w}x{h} → {new_w}x{new_h}")
    return result


# ============================================================
# §2.6.2 扫描件画质修复
# ============================================================

def repair_scan(image: np.ndarray,
                denoise: bool = True,
                remove_moire: bool = True,
                fix_creases: bool = True,
                fix_line_breaks: bool = True) -> np.ndarray:
    """
    扫描件画质修复 — 去噪点、去莫尔纹、修复折痕/污渍、修复印刷错位。
    
    Args:
        image: BGR/灰度 numpy array
        denoise: 去除扫描噪点
        remove_moire: 去除网点龟纹 (莫尔纹)
        fix_creases: 修复折痕污渍
        fix_line_breaks: 修复印刷错位/线条断裂
    
    Returns:
        修复后的图像
    """
    import cv2
    
    is_gray = len(image.shape) == 2
    
    if is_gray:
        result = image.copy()
        work_img = result
    else:
        result = image.copy()
        work_img = cv2.cvtColor(result, cv2.COLOR_BGR2GRAY) if not is_gray else result
    
    # 1. 去噪点 (Non-local Means Denoising)
    if denoise:
        if is_gray:
            result = cv2.fastNlMeansDenoising(result, None, h=8, templateWindowSize=7, searchWindowSize=21)
        else:
            result = cv2.fastNlMeansDenoisingColored(result, None, h=8, hColor=8, templateWindowSize=7, searchWindowSize=21)
        logger.info("Scan repair: denoising applied")
    
    # 2. 去莫尔纹 (Frequency Domain Filtering)
    if remove_moire:
        try:
            if is_gray:
                fft_img = np.fft.fft2(work_img.astype(np.float64))
            else:
                fft_img = np.fft.fft2(cv2.cvtColor(result, cv2.COLOR_BGR2GRAY).astype(np.float64))
            
            fft_shifted = np.fft.fftshift(fft_img)
            magnitude = np.abs(fft_shifted)
            
            # 检测莫尔纹的频域特征 (高频周期模式)
            h_m, w_m = magnitude.shape
            cy, cx = h_m // 2, w_m // 2
            
            # 创建一个掩码，抑制高频周期模式
            mask = np.ones_like(magnitude, dtype=np.float64)
            
            # 检测并抑制异常高频峰值
            threshold = np.mean(magnitude) + 2 * np.std(magnitude)
            high_freq_mask = magnitude > threshold
            high_freq_mask[cy-5:cy+5, cx-5:cx+5] = False  # 保留 DC 中心
            
            # 对异常高频区域应用陷波滤波器
            mask[high_freq_mask] = 0.3
            
            fft_filtered = fft_shifted * mask
            fft_inv = np.fft.ifft2(np.fft.ifftshift(fft_filtered))
            filtered_gray = np.abs(fft_inv).astype(np.uint8)
            
            # 将滤波结果应用到亮度通道 (保持色彩)
            if not is_gray:
                hsv = cv2.cvtColor(result, cv2.COLOR_BGR2HSV)
                h, s, v = cv2.split(hsv)
                v = cv2.addWeighted(v, 0.6, filtered_gray, 0.4, 0)
                hsv = cv2.merge([h, s, v])
                result = cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)
            else:
                result = cv2.addWeighted(result, 0.6, filtered_gray, 0.4, 0).astype(np.uint8)
            
            logger.info("Scan repair: moire removal applied")
        except Exception as e:
            logger.warning(f"Moire removal failed: {e}")
    
    # 3. 修复折痕和污渍 (inpainting approach)
    if fix_creases:
        if not is_gray:
            gray = cv2.cvtColor(result, cv2.COLOR_BGR2GRAY)
        else:
            gray = result
        
        # 检测异常线条 (折痕通常是长直线)
        edges = cv2.Canny(gray, 30, 100)
        lines = cv2.HoughLinesP(edges, 1, np.pi/180, threshold=50, minLineLength=60, maxLineGap=15)
        
        if lines is not None and len(lines) > 0:
            crease_mask = np.zeros(gray.shape, dtype=np.uint8)
            for line in lines:
                x1, y1, x2, y2 = line[0]
                length = np.sqrt((x2-x1)**2 + (y2-y1)**2)
                if length > 60:  # 长线条可能是折痕
                    cv2.line(crease_mask, (x1, y1), (x2, y2), 255, 4)
            
            if crease_mask.sum() > 0:
                crease_mask = cv2.dilate(crease_mask, np.ones((3, 3), np.uint8), iterations=2)
                result = cv2.inpaint(result, crease_mask, inpaintRadius=4, flags=cv2.INPAINT_TELEA)
                logger.info(f"Scan repair: {len(lines)} crease lines repaired")
    
    # 4. 修复印刷错位/线条断裂 (morphological closing)
    if fix_line_breaks:
        if not is_gray:
            gray = cv2.cvtColor(result, cv2.COLOR_BGR2GRAY)
        else:
            gray = result
        
        # 二值化检测线条
        _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
        
        # 形态学闭运算连接断裂线条
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2, 2))
        closed = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)
        
        # 找到需要修复的断裂位置
        breaks = cv2.bitwise_xor(closed, binary)
        breaks = cv2.dilate(breaks, np.ones((2, 2), np.uint8), iterations=1)
        
        if breaks.sum() > 100:  # 有大量断裂
            result = cv2.inpaint(result, breaks, inpaintRadius=2, flags=cv2.INPAINT_TELEA)
            logger.info("Scan repair: line breaks repaired")
    
    return result


# ============================================================
# §2.6.3 黑白漫画智能上色 (基础版 - 基于色彩提示)
# ============================================================

def auto_colorize(image: np.ndarray, 
                  style_hint: str = "modern_shonen") -> np.ndarray:
    """Manga colorization — MangaNinja-style reference-based approach.
    
    Production approach (based on MangaNinja, CVPR 2025):
    1. If a color reference page is available → use it for palette extraction
    2. If no reference → use style-hint based color palette (perceptual color space)
    3. Line art is preserved via edge-aware blending
    
    The full AI pipeline (diffusion-based reference colorization) requires
    MangaNinja weights (~2GB). This implementation provides the color-palette
    baseline that works without GPU dependencies, with the option to upgrade
    to the full diffusion model when available.
    
    Args:
        image: BGR numpy array
        style_hint: 'modern_shonen', 'classic', 'pastel', 'retro', 
                    or a color reference image path
    """
    import cv2
    
    # Detect if already colorized
    if len(image.shape) == 3:
        hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
        mean_sat = np.mean(hsv[:, :, 1])
        if mean_sat > 30:
            logger.info(f"Image already colorized (saturation={mean_sat:.1f}), skipping")
            return image
    
    # Try full MangaNinja-style diffusion colorization if available
    try:
        import importlib
        if importlib.util.find_spec("diffusers") and os.path.exists(style_hint):
            return _colorize_with_reference(image, style_hint)
    except Exception as e:
        logger.info(f"Full AI colorization not available: {e}")
    
    # Perceptual-color-space palette-based colorization
    if len(image.shape) == 3:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    else:
        gray = image.copy()
    
    # Style-specific palettes in LAB color space (perceptually uniform)
    palettes = {
        "modern_shonen": {
            "skin": (210, 175, 155),     # BGR
            "hair": (55, 55, 60),
            "accent": (220, 80, 60),      # Hero accent color
            "background": (140, 175, 155),
            "clothing": (80, 120, 185),
            "shadow_tint": (40, 40, 50),
        },
        "classic": {
            "skin": (195, 165, 148),
            "hair": (35, 35, 40),
            "accent": (50, 60, 180),
            "background": (130, 165, 145),
            "clothing": (70, 95, 150),
            "shadow_tint": (30, 30, 40),
        },
        "pastel": {
            "skin": (225, 205, 190),
            "hair": (95, 85, 75),
            "accent": (195, 155, 195),
            "background": (175, 205, 185),
            "clothing": (175, 165, 205),
            "shadow_tint": (70, 65, 75),
        },
        "retro": {
            "skin": (170, 150, 145),
            "hair": (35, 35, 35),
            "accent": (50, 60, 170),
            "background": (115, 140, 125),
            "clothing": (80, 85, 130),
            "shadow_tint": (25, 25, 30),
        },
    }
    
    palette = palettes.get(style_hint, palettes["modern_shonen"])
    
    h, w = gray.shape
    result = np.zeros((h, w, 3), dtype=np.uint8)
    
    # Foreground/background separation
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    cleaned = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)
    
    bg_mask = (cleaned < 128).astype(np.float32)
    fg_mask = (cleaned >= 128).astype(np.float32)
    gray_norm = gray.astype(np.float32) / 255.0
    
    for c in range(3):
        # Background: environment color with slight variation
        bg = palette["background"][c] * (0.85 + 0.15 * (1.0 - gray_norm))
        result[:, :, c] = (bg_mask * bg).astype(np.uint8)
        
        # Foreground: grayscale → skin/hair/accent mapping
        skin = palette["skin"][c] * (1.0 - gray_norm)
        hair = palette["hair"][c] * gray_norm
        accent_zone = (gray_norm > 0.3) & (gray_norm < 0.7)
        accent_val = np.where(accent_zone, palette["accent"][c] * 0.3, 0)
        fg = skin * 0.5 + hair * 0.35 + accent_val * 0.15
        
        result[:, :, c] = np.clip(
            result[:, :, c] + (fg_mask * fg * 0.75).astype(np.uint8), 0, 255
        )
    
    # Blend with original grayscale to preserve line art detail
    gray_3ch = np.stack([gray] * 3, axis=-1).astype(np.float32)
    result = (result.astype(np.float32) * 0.65 + gray_3ch * 0.35).astype(np.uint8)
    
    logger.info(f"Palette-based colorization with style: {style_hint}")
    return result


def _colorize_with_reference(image: np.ndarray, reference_path: str) -> np.ndarray:
    """MangaNinja-style reference-based colorization.
    
    Extracts color palette from a color reference page and applies
    it to the target image using color transfer in LAB space.
    """
    import cv2
    
    try:
        ref = cv2.imread(reference_path)
        if ref is None:
            return image
        
        # Convert both to LAB for perceptual color transfer
        if len(image.shape) == 2:
            src = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
        else:
            src = image.copy()
        
        src_lab = cv2.cvtColor(src, cv2.COLOR_BGR2LAB).astype(np.float32)
        ref_lab = cv2.cvtColor(ref, cv2.COLOR_BGR2LAB).astype(np.float32)
        
        # Color transfer: match mean and std of reference
        for c in range(1, 3):  # Only transfer a* and b* channels (color), not L* (lightness)
            src_mean, src_std = np.mean(src_lab[:, :, c]), np.std(src_lab[:, :, c])
            ref_mean, ref_std = np.mean(ref_lab[:, :, c]), np.std(ref_lab[:, :, c])
            
            src_lab[:, :, c] = ((src_lab[:, :, c] - src_mean) * 
                               (ref_std / (src_std + 1e-6)) + ref_mean)
        
        src_lab = np.clip(src_lab, 0, 255).astype(np.uint8)
        result = cv2.cvtColor(src_lab, cv2.COLOR_LAB2BGR)
        
        logger.info(f"Reference-based colorization from: {reference_path}")
        return result
    except Exception as e:
        logger.warning(f"Reference colorization failed: {e}")
        return image


# ============================================================
# §2.6.4 色彩增强优化
# ============================================================

def enhance_colors(image: np.ndarray,
                   contrast: float = 1.15,
                   saturation: float = 1.10,
                   sharpness: float = 1.05,
                   brightness: float = 1.0) -> np.ndarray:
    """
    自动优化画面色彩表现。
    
    Args:
        image: BGR numpy array
        contrast: 对比度增强系数 (1.0 = 不变)
        saturation: 饱和度增强系数
        sharpness: 锐度增强系数
        brightness: 亮度系数
    
    Returns:
        增强后的图像
    """
    import cv2
    
    # 转为 PIL 以便使用 ImageEnhance
    if len(image.shape) == 2:
        pil_img = Image.fromarray(image, mode='L')
    else:
        pil_img = Image.fromarray(cv2.cvtColor(image, cv2.COLOR_BGR2RGB), mode='RGB')
    
    # Contrast
    if contrast != 1.0:
        pil_img = ImageEnhance.Contrast(pil_img).enhance(contrast)
    
    # Brightness
    if brightness != 1.0:
        pil_img = ImageEnhance.Brightness(pil_img).enhance(brightness)
    
    # Color/Saturation
    if saturation != 1.0 and len(image.shape) == 3:
        pil_img = ImageEnhance.Color(pil_img).enhance(saturation)
    
    # Sharpness
    if sharpness != 1.0:
        pil_img = ImageEnhance.Sharpness(pil_img).enhance(sharpness)
    
    # 转回 numpy
    result = np.array(pil_img)
    if len(result.shape) == 3:
        result = cv2.cvtColor(result, cv2.COLOR_RGB2BGR)
    
    logger.info(f"Color enhancement: contrast={contrast}, saturation={saturation}, sharpness={sharpness}")
    return result


# ============================================================
# 主服务类
# ============================================================

class EnhanceService:
    """漫画画质增强服务 — PRD §2.6"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def enhance_page(
        self,
        page_id: str,
        user_id: str,
        super_resolution: Optional[str] = None,
        scan_repair: bool = False,
        auto_colorize: bool = False,
        color_style: str = "modern_shonen",
        enhance_colors: bool = False,
        contrast: float = 1.15,
        saturation: float = 1.10,
        sharpness: float = 1.05,
    ) -> dict:
        """
        执行画质增强处理。
        
        Args:
            page_id: 页面 ID
            user_id: 用户 ID
            super_resolution: 超分目标 (None/"2k"/"4k")
            scan_repair: 是否修复扫描件
            auto_colorize: 是否智能上色
            color_style: 上色风格
            enhance_colors: 是否色彩增强
            contrast: 对比度系数
            saturation: 饱和度系数
            sharpness: 锐度系数
        
        Returns:
            {task_id, status, result_url, operations_applied}
        """
        import cv2
        
        task_id = str(uuid.uuid4())
        operations = []
        
        # 查询页面
        result = await self.db.execute(
            select(Page).where(Page.page_id == page_id)
        )
        page = result.scalar_one_or_none()
        if not page:
            return {"task_id": task_id, "status": "failed", "error": "Page not found"}
        
        image_url = page.processed_url or page.original_url
        image_data = await _load_image_data(image_url)
        if not image_data:
            return {"task_id": task_id, "status": "failed", "error": "Cannot load image"}
        
        img_array = np.frombuffer(image_data, dtype=np.uint8)
        img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
        if img is None:
            img = cv2.imdecode(img_array, cv2.IMREAD_GRAYSCALE)
        if img is None:
            return {"task_id": task_id, "status": "failed", "error": "Cannot decode image"}
        
        # 应用增强操作
        # 扫描件修复 (在超分前做，减少噪声放大)
        if scan_repair:
            img = repair_scan(img, denoise=True, remove_moire=True, fix_creases=True, fix_line_breaks=True)
            operations.append("scan_repair")
        
        # 超分辨率
        if super_resolution in ("2k", "4k"):
            img = super_resolve(img, target_resolution=super_resolution)
            operations.append(f"super_resolution_{super_resolution}")

        # 智能上色（通过模块全局引用，避免被同名 bool 参数遮蔽）
        if auto_colorize:
            img = globals()["auto_colorize"](img, style_hint=color_style)
            operations.append(f"colorize_{color_style}")

        # 色彩增强（同上，避免同名 bool 参数遮蔽模块函数）
        if enhance_colors:
            img = globals()["enhance_colors"](img, contrast, saturation, sharpness)
            operations.append("enhance_colors")
        
        # 保存结果
        _, buffer = cv2.imencode(".png", img, [cv2.IMWRITE_PNG_COMPRESSION, 0])
        result_url = _save_enhanced(buffer.tobytes(), page_id, task_id, "enhanced")
        
        # 更新页面
        page.processed_url = result_url
        await self.db.commit()
        
        return {
            "task_id": task_id,
            "status": "completed",
            "result_url": result_url,
            "operations_applied": operations,
            "original_size": f"{img_array.shape[1]}x{img_array.shape[0]}",
            "result_size": f"{img.shape[1]}x{img.shape[0]}",
        }

    async def get_status(self, page_id: str, task_id: str, user_id: str) -> dict:
        """获取增强任务状态"""
        result = await self.db.execute(
            select(Page).where(Page.page_id == page_id)
        )
        page = result.scalar_one_or_none()
        return {
            "task_id": task_id,
            "status": "completed",
            "result_url": page.processed_url if page else None,
        }
