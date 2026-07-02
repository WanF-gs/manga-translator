from __future__ import annotations
"""
条漫长图拼接服务 — 多页拼接为一张竖版长图
支持无间隔直接拼接 / 带间隔线拼接
"""
import io
import logging
from typing import List, Tuple, Optional

import httpx
from PIL import Image, ImageDraw

logger = logging.getLogger(__name__)


async def _download_image(url: str) -> Optional[Image.Image]:
    """下载图片为 PIL Image — P0 FIX: 自动补全相对路径"""
    if url and url.startswith("/"):
        base = os.getenv("STORAGE_BASE_URL", "http://localhost:8080")
        url = base.rstrip("/") + url
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            return Image.open(io.BytesIO(resp.content)).convert("RGBA")
    except Exception as e:
        logger.warning(f"Failed to download {url}: {e}")
        return None


def stitch_vertical(
    images: List[Image.Image],
    gap: int = 0,
    gap_color: Tuple[int, int, int, int] = (0, 0, 0, 255),
    align: str = "center",
    background_color: Tuple[int, int, int, int] = (255, 255, 255, 255),
) -> Image.Image:
    """
    将多张图片纵向拼接为一张长图。

    Args:
        images: PIL Image 列表
        gap: 图片之间的间隔（像素）
        gap_color: 间隔线颜色 (RGBA)
        align: 对齐方式 ("center", "left", "right")
        background_color: 背景颜色 (RGBA)

    Returns:
        拼接后的长图
    """
    if not images:
        return Image.new("RGBA", (1, 1), background_color)

    # 计算最大宽度和总高度
    max_width = max(img.width for img in images)
    total_height = sum(img.height for img in images) + gap * (len(images) - 1)

    # 创建画布
    canvas = Image.new("RGBA", (max_width, total_height), background_color)
    draw = ImageDraw.Draw(canvas)

    y_offset = 0
    for i, img in enumerate(images):
        # 水平对齐
        if align == "center":
            x_offset = (max_width - img.width) // 2
        elif align == "right":
            x_offset = max_width - img.width
        else:
            x_offset = 0

        # 粘贴图片
        canvas.paste(img, (x_offset, y_offset), img if img.mode == "RGBA" else None)

        y_offset += img.height

        # 绘制间隔线
        if gap > 0 and i < len(images) - 1:
            draw.rectangle([0, y_offset, max_width, y_offset + gap], fill=gap_color)
            y_offset += gap

    return canvas


async def stitch_pages_to_long_image(
    image_urls: List[str],
    gap: int = 2,
    gap_color: str = "#333333",
    align: str = "center",
) -> Optional[bytes]:
    """
    下载多张图片并拼接为长图。

    Args:
        image_urls: 图片URL列表
        gap: 间隔像素
        gap_color: 间隔线颜色 (hex)
        align: 对齐方式

    Returns:
        PNG字节数据，失败返回None
    """
    images = []
    for url in image_urls:
        img = await _download_image(url)
        if img:
            images.append(img)
        else:
            logger.warning(f"Skip missing image: {url}")

    if not images:
        return None

    # 解析颜色
    gc = gap_color.lstrip("#")
    if len(gc) == 6:
        r, g, b = int(gc[0:2], 16), int(gc[2:4], 16), int(gc[4:6], 16)
        gap_rgba = (r, g, b, 255)
    elif len(gc) == 3:
        r, g, b = int(gc[0] * 2, 16), int(gc[1] * 2, 16), int(gc[2] * 2, 16)
        gap_rgba = (r, g, b, 255)
    else:
        gap_rgba = (51, 51, 51, 255)

    stitched = stitch_vertical(images, gap=gap, gap_color=gap_rgba, align=align)

    buf = io.BytesIO()
    stitched.convert("RGB").save(buf, format="PNG")
    return buf.getvalue()
