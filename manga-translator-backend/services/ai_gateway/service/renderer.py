from __future__ import annotations
"""
AI Gateway 文字渲染服务 - Pillow 实现
将翻译文本渲染到图像上指定位置。
支持：字体加载、自适应排版、竖排/横排切换、描边、自动缩字号。
"""
import io
import os
import base64
import logging
import time
from typing import List, Optional, Dict, Any, Tuple

import httpx
from PIL import Image, ImageDraw, ImageFont

logger = logging.getLogger(__name__)

# ===================== 字体管理 =====================

FONT_SEARCH_PATHS = [
    os.getenv("FONT_DIR", ""),
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "fonts"),
    os.path.join(os.path.dirname(__file__), "..", "..", "fonts"),
    "/usr/share/fonts",
    "/usr/local/share/fonts",
    "C:/Windows/Fonts",
]

CJK_FONT_CANDIDATES = [
    # Noto/Source Han 字体（免费可商用）
    "NotoSansSC-Regular.otf", "NotoSansSC-VF.ttf", "NotoSansSC-Bold.otf",
    "SourceHanSansSC-Regular.otf", "SourceHanSansSC-Regular.ttf",
    "NotoSansCJK-Regular.ttc",
    "NotoSansJP-Regular.otf", "NotoSansJP-Bold.otf", "NotoSansKR-Regular.otf",
    # 霞鹜文楷（少女漫/旁白/手写风格）
    "LXGWWenKai-Regular.ttf", "LXGWWenKai-Bold.ttf",
    # 漫画专用字体（对标 manga-translator-ui）
    "anime_ace.ttf", "anime_ace_3.ttf", "comic shanns 2.ttf",
    # 系统字体
    "simsun.ttc", "simsun.ttf", "msyh.ttc", "msyh.ttf",
    "msgothic.ttc", "AppleGothic.ttf",
    # 通用回退
    "Arial.ttf", "DejaVuSans.ttf",
]

_font_cache: dict = {}


def _find_font(size: int = 16) -> Optional[ImageFont.FreeTypeFont]:
    """查找可用的中文字体"""
    cache_key = f"default_{size}"
    if cache_key in _font_cache:
        return _font_cache[cache_key]

    for search_path in FONT_SEARCH_PATHS:
        if not search_path or not os.path.isdir(search_path):
            continue
        for candidate in CJK_FONT_CANDIDATES:
            font_path = os.path.join(search_path, candidate)
            if os.path.isfile(font_path):
                try:
                    font = ImageFont.truetype(font_path, size)
                    _font_cache[cache_key] = font
                    return font
                except Exception:
                    continue

    # 回退：尝试默认字体
    try:
        font = ImageFont.load_default()
        _font_cache[cache_key] = font
        return font
    except Exception:
        return None


def _get_font(family: Optional[str] = None, size: int = 16) -> Optional[ImageFont.FreeTypeFont]:
    """获取指定字体，带缓存"""
    cache_key = f"{family}_{size}"
    if cache_key in _font_cache:
        return _font_cache[cache_key]

    if family:
        for search_path in FONT_SEARCH_PATHS:
            if not search_path or not os.path.isdir(search_path):
                continue
            font_path = os.path.join(search_path, family)
            if not os.path.isfile(font_path):
                for ext in [".ttf", ".otf", ".ttc"]:
                    fp = os.path.join(search_path, family + ext)
                    if os.path.isfile(fp):
                        font_path = fp
                        break
            if os.path.isfile(font_path):
                try:
                    font = ImageFont.truetype(font_path, size)
                    _font_cache[cache_key] = font
                    return font
                except Exception:
                    continue

    return _find_font(size)


# ===================== 文本排版 =====================

def _wrap_text_cjk(
    text: str, font: ImageFont.FreeTypeFont, max_width: int, draw: ImageDraw.Draw
) -> List[str]:
    """CJK文本逐字换行"""
    lines = []
    current_line = ""
    for char in text:
        test_line = current_line + char
        bbox = draw.textbbox((0, 0), test_line, font=font)
        if bbox[2] - bbox[0] <= max_width:
            current_line = test_line
        else:
            if current_line:
                lines.append(current_line)
            current_line = char
    if current_line:
        lines.append(current_line)
    return lines if lines else [""]


def _wrap_text_word(
    text: str, font: ImageFont.FreeTypeFont, max_width: int, draw: ImageDraw.Draw
) -> List[str]:
    """英文/非CJK按单词换行"""
    words = text.split()
    lines = []
    current_line = ""
    for word in words:
        test_line = (current_line + " " + word).strip()
        bbox = draw.textbbox((0, 0), test_line, font=font)
        if bbox[2] - bbox[0] <= max_width:
            current_line = test_line
        else:
            if current_line:
                lines.append(current_line)
            word_bbox = draw.textbbox((0, 0), word, font=font)
            if word_bbox[2] - word_bbox[0] > max_width:
                # 单词过长，逐字符拆分
                current_line = ""
                for char in word:
                    test = current_line + char
                    if draw.textbbox((0, 0), test, font=font)[2] <= max_width:
                        current_line = test
                    else:
                        if current_line:
                            lines.append(current_line)
                        current_line = char
            else:
                current_line = word
    if current_line:
        lines.append(current_line)
    return lines if lines else [""]


def _wrap_text(
    text: str, font: ImageFont.FreeTypeFont, max_width: int, draw: ImageDraw.Draw
) -> List[str]:
    """智能换行：自动检测CJK/非CJK"""
    is_cjk = any(
        "\u4e00" <= c <= "\u9fff" or "\u3040" <= c <= "\u30ff"
        or "\uac00" <= c <= "\ud7af"
        for c in text
    )
    if is_cjk:
        return _wrap_text_cjk(text, font, max_width, draw)
    return _wrap_text_word(text, font, max_width, draw)


def _auto_fit_font(
    text: str,
    max_width: int,
    max_height: int,
    draw: ImageDraw.Draw,
    initial_size: int = 24,
    min_size: int = 8,
) -> Tuple[Optional[ImageFont.FreeTypeFont], List[str]]:
    """自动缩小字号以适配区域"""
    for size in range(initial_size, min_size - 1, -1):
        font = _get_font(size=size)
        if font is None:
            continue
        lines = _wrap_text(text, font, max_width, draw)
        line_height = draw.textbbox((0, 0), "Ag", font=font)[3]
        total_height = line_height * len(lines)
        if total_height <= max_height:
            return font, lines
    font = _get_font(size=min_size)
    if font is None:
        return None, [text]
    return font, _wrap_text(text, font, max_width, draw)


def _parse_color(color_str: str) -> Tuple[int, int, int]:
    """解析颜色字符串为 RGB"""
    if not color_str:
        return (0, 0, 0)
    color_str = color_str.strip().lstrip("#")
    if len(color_str) == 3:
        color_str = "".join(c * 2 for c in color_str)
    if len(color_str) == 6:
        return (
            int(color_str[0:2], 16),
            int(color_str[2:4], 16),
            int(color_str[4:6], 16),
        )
    return (0, 0, 0)


def _draw_text_with_outline(
    draw: ImageDraw.Draw,
    xy: Tuple[float, float],
    text: str,
    font: ImageFont.FreeTypeFont,
    fill: Tuple[int, int, int],
    outline_width: int = 2,
    outline_color: Tuple[int, int, int, int] = (255, 255, 255, 255),
):
    """绘制带描边/阴影的文字（增强可读性）"""
    x, y = xy
    if outline_width > 0:
        for dx in range(-outline_width, outline_width + 1):
            for dy in range(-outline_width, outline_width + 1):
                if dx == 0 and dy == 0:
                    continue
                draw.text((x + dx, y + dy), text, font=font, fill=outline_color)
    draw.text((x, y), text, font=font, fill=fill)


# ===================== 主渲染函数 =====================

async def render_text_to_image(
    image_base64: str,
    text_regions: List[Dict[str, Any]],
    auto_resize: bool = True,
    output_format: str = "png",
) -> Dict[str, Any]:
    """
    将翻译文本渲染到图像上。

    Args:
        image_base64: 原始图像的 base64 编码
        text_regions: 文字区域列表，每项包含:
            {
                "region_id": str,
                "translated_text": str,
                "boundary": {"x": int, "y": int, "width": int, "height": int},
                "is_vertical": bool (optional, 竖排文字),
                "font_size": int (optional),
                "font_family": str (optional),
                "font_color": str (optional, "#RRGGBB"),
                "alignment": str (optional, "left"/"center"/"right"),
                "line_spacing": float (optional),
                "outline_width": int (optional),
            }
        auto_resize: 是否自动缩小字号适配区域
        output_format: 输出格式 ("png"/"jpeg"/"webp")

    Returns:
        {
            "result_base64": str,
            "regions_rendered": int,
            "warnings": List[str],
            "processing_time_ms": float,
        }
    """
    start_time = time.time()
    warnings: List[str] = []
    rendered_count = 0

    # 解码输入图像
    try:
        # 去除可能的 data:image 前缀
        if "," in image_base64:
            image_base64 = image_base64.split(",", 1)[1]
        image_data = base64.b64decode(image_base64)
        img = Image.open(io.BytesIO(image_data)).convert("RGBA")
    except Exception as e:
        logger.error(f"Failed to decode image: {e}")
        return {
            "result_base64": None,
            "regions_rendered": 0,
            "warnings": [f"Image decode failed: {str(e)}"],
            "processing_time_ms": (time.time() - start_time) * 1000,
            "error": str(e),
        }

    # 创建文字覆盖层
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    for region in text_regions:
        region_id = region.get("region_id", "unknown")
        translated_text = region.get("translated_text", "").strip()
        if not translated_text:
            continue

        # 获取边界框
        boundary = region.get("boundary", {})
        try:
            x = float(boundary.get("x", 0))
            y = float(boundary.get("y", 0))
            w = float(boundary.get("width", 100))
            h = float(boundary.get("height", 100))
        except (TypeError, ValueError) as e:
            warnings.append(f"区域 {region_id[:8]} 边界值非法，跳过")
            continue

        # P0 FIX: 过滤默认/非法边界，避免多个区域重叠在左上角
        if x == 0 and y == 0 and w == 100 and h == 100:
            warnings.append(f"区域 {region_id[:8]} 为默认边界，跳过")
            continue
        if w <= 0 or h <= 0:
            warnings.append(f"区域 {region_id[:8]} 宽高非正，跳过")
            continue


        # 样式参数
        is_vertical = region.get("is_vertical", False)
        font_size = region.get("font_size", 16)
        font_family = region.get("font_family")
        font_color = region.get("font_color", "#000000")
        alignment = region.get("alignment", "left")
        line_spacing = region.get("line_spacing", 1.2)
        outline_width = region.get("outline_width", 2)

        # 获取字体
        font = _get_font(family=font_family, size=font_size)
        if font is None:
            warnings.append(f"区域 {region_id[:8]} 无可用字体，跳过")
            continue

        padding = 4
        max_text_width = max(w - padding * 2, 10)
        max_text_height = max(h - padding * 2, 10)

        # 竖排文字处理
        if is_vertical and len(translated_text) > 1:
            # 竖排：将文字旋转处理
            # 竖排时交换宽高概念
            lines = [c for c in translated_text]  # 每行一个字符
            char_width = draw.textbbox((0, 0), "测", font=font)[2]
            total_width = char_width * len(lines)
            if total_width > max_text_width and auto_resize:
                scale = max_text_width / total_width
                new_size = max(int(font_size * scale), 8)
                font = _get_font(family=font_family, size=new_size)
                if font:
                    char_width = draw.textbbox((0, 0), "测", font=font)[2]
        else:
            # 横排文字换行
            lines = _wrap_text(translated_text, font, max_text_width, draw)

            # 自动缩字号
            line_height = draw.textbbox((0, 0), "Ag", font=font)[3]
            total_height = line_height * len(lines) * line_spacing
            if total_height > max_text_height and auto_resize:
                font, lines = _auto_fit_font(
                    translated_text, max_text_width, max_text_height,
                    draw, initial_size=font_size, min_size=8,
                )
                if font is None:
                    warnings.append(f"区域 {region_id[:8]} 文字无法适配")
                    continue
                line_height = draw.textbbox((0, 0), "Ag", font=font)[3]

        # 颜色
        fill_color = _parse_color(font_color)
        outline_color = (255, 255, 255, 220)

        if is_vertical and len(translated_text) > 1:
            # 竖排渲染
            char_height = draw.textbbox((0, 0), "测", font=font)[3]
            total_char_height = char_height * len(translated_text) * line_spacing
            start_y = y + (h - total_char_height) / 2

            for i, char in enumerate(translated_text):
                char_x = x + padding + i * char_width * 1.05
                char_y = start_y + i * char_height * line_spacing
                char_x = max(x + 1, min(char_x, x + w - char_width - 1))
                char_y = max(y + 1, min(char_y, y + h - char_height - 1))
                _draw_text_with_outline(
                    draw, (char_x, char_y), char, font,
                    fill=fill_color, outline_width=outline_width,
                    outline_color=outline_color,
                )
        else:
            # 横排渲染
            line_height = draw.textbbox((0, 0), "Ag", font=font)[3]
            total_line_height = line_height * len(lines) * line_spacing
            start_y = y + (h - total_line_height) / 2
            if start_y < y:
                start_y = y + padding

            for i, line in enumerate(lines):
                line_width = draw.textbbox((0, 0), line, font=font)[2]
                if alignment == "center":
                    text_x = x + (w - line_width) / 2
                elif alignment == "right":
                    text_x = x + w - line_width - padding
                else:
                    text_x = x + padding
                text_y = start_y + i * line_height * line_spacing
                text_x = max(x + 1, text_x)
                text_y = max(y + 1, text_y)
                _draw_text_with_outline(
                    draw, (text_x, text_y), line, font,
                    fill=fill_color, outline_width=outline_width,
                    outline_color=outline_color,
                )

        rendered_count += 1

    # 合成最终图像
    composite = Image.alpha_composite(img, overlay)

    # 编码输出
    output_buffer = io.BytesIO()
    fmt = output_format.upper()
    save_format = "JPEG" if fmt == "JPEG" else fmt if fmt in ("PNG", "WEBP") else "PNG"
    save_kwargs = {}
    if save_format == "JPEG":
        composite = composite.convert("RGB")
        save_kwargs["quality"] = 95
    elif save_format == "WEBP":
        save_kwargs["quality"] = 95
    composite.save(output_buffer, format=save_format, **save_kwargs)

    result_base64 = base64.b64encode(output_buffer.getvalue()).decode("utf-8")

    processing_time_ms = (time.time() - start_time) * 1000

    return {
        "result_base64": result_base64,
        "regions_rendered": rendered_count,
        "warnings": warnings,
        "processing_time_ms": round(processing_time_ms, 2),
    }
