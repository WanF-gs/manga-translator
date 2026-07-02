from __future__ import annotations
"""双语合成服务 - 真实 Pillow 实现

支持三种双语对照模式：
1. side_by_side — 左右分屏
2. top_bottom  — 上下对照
3. overlay     — 气泡内叠加
"""
import io
import os
import logging
from typing import List

from PIL import Image, ImageDraw, ImageFont

logger = logging.getLogger(__name__)

# 查找字体函数（复用 render_service 逻辑）
FONT_SEARCH_PATHS = [
    "/app/fonts", "/usr/share/fonts", "/usr/local/share/fonts",
    "C:/Windows/Fonts",
]
CJK_FONT_CANDIDATES = [
    "SourceHanSansSC-Regular.otf", "NotoSansCJK-Regular.ttc",
    "simsun.ttc", "msyh.ttc", "Arial.ttf",
]
_font_cache = {}


def _get_font(size: int = 14) -> ImageFont.FreeTypeFont:
    """获取可用字体"""
    cache_key = f"bilingual_{size}"
    if cache_key in _font_cache:
        return _font_cache[cache_key]

    for search_path in FONT_SEARCH_PATHS:
        if not os.path.isdir(search_path):
            continue
        for candidate in CJK_FONT_CANDIDATES:
            fp = os.path.join(search_path, candidate)
            if os.path.isfile(fp):
                try:
                    font = ImageFont.truetype(fp, size)
                    _font_cache[cache_key] = font
                    return font
                except Exception:
                    continue

    try:
        font = ImageFont.load_default()
        _font_cache[cache_key] = font
        return font
    except Exception:
        return None


class BilingualService:
    """双语合成器"""

    @staticmethod
    async def create_bilingual_page(
        original_path: str,
        translated_path: str,
        layout: str = "side_by_side",
    ) -> dict:
        """创建双语对照单页"""
        try:
            orig_img = Image.open(original_path).convert("RGB")
            trans_img = Image.open(translated_path).convert("RGB")
        except Exception as e:
            return {"status": "error", "error": str(e)}

        if layout == "side_by_side":
            # 左右分屏
            ow, oh = orig_img.size
            tw, th = trans_img.size
            # 统一高度
            max_h = max(oh, th)
            result = Image.new("RGB", (ow + tw + 10, max_h), (255, 255, 255))
            result.paste(orig_img, (0, (max_h - oh) // 2))
            result.paste(trans_img, (ow + 10, (max_h - th) // 2))

            # 添加标签
            draw = ImageDraw.Draw(result)
            font = _get_font(16)
            if font:
                draw.text((5, 2), "Original", fill=(100, 100, 100), font=font)
                draw.text((ow + 15, 2), "Translated", fill=(100, 100, 100), font=font)

        elif layout == "top_bottom":
            # 上下对照
            ow, oh = orig_img.size
            tw, th = trans_img.size
            max_w = max(ow, tw)
            result = Image.new("RGB", (max_w, oh + th + 10), (255, 255, 255))
            result.paste(orig_img, ((max_w - ow) // 2, 0))
            result.paste(trans_img, ((max_w - tw) // 2, oh + 10))

        elif layout == "overlay":
            # 半透明叠加
            ow, oh = orig_img.size
            trans_img = trans_img.resize((ow, oh), Image.LANCZOS)
            trans_rgba = Image.new("RGBA", (ow, oh), (0, 0, 0, 0))
            trans_rgba.paste(trans_img.convert("RGBA"), (0, 0))
            # 降低不透明度
            data = trans_rgba.getdata()
            new_data = [(r, g, b, int(a * 0.5)) for r, g, b, a in data]
            trans_rgba.putdata(new_data)
            result = Image.alpha_composite(
                orig_img.convert("RGBA"), trans_rgba
            ).convert("RGB")
        else:
            result = orig_img

        output_path = original_path.rsplit(".", 1)[0] + "_bilingual.png"
        result.save(output_path, format="PNG")
        file_size_mb = os.path.getsize(output_path) / (1024 * 1024)

        return {
            "status": "ok",
            "output_path": output_path,
            "layout": layout,
            "file_size": f"{file_size_mb:.1f}MB",
        }

    @staticmethod
    async def create_bilingual_chapter(
        original_pages: List[str],
        translated_pages: List[str],
        layout: str = "side_by_side",
    ) -> dict:
        """创建双语对照章节（批量）"""
        import tempfile
        output_dir = os.path.join(tempfile.gettempdir(), "bilingual_export")
        os.makedirs(output_dir, exist_ok=True)

        page_count = min(len(original_pages), len(translated_pages))
        output_paths = []

        for i in range(page_count):
            result = await BilingualService.create_bilingual_page(
                original_pages[i], translated_pages[i], layout
            )
            if result.get("status") == "ok":
                output_paths.append(result["output_path"])

        return {
            "status": "ok",
            "total_pages": page_count,
            "output_dir": output_dir,
            "layout": layout,
        }

    @staticmethod
    async def add_subtitle_overlay(
        image_path: str,
        subtitles: List[dict],
        position: str = "bottom",
    ) -> dict:
        """在图片底部添加字幕文字叠加"""
        try:
            img = Image.open(image_path).convert("RGBA")
        except Exception as e:
            return {"status": "error", "error": str(e)}

        w, h = img.size
        font = _get_font(18)
        if font is None:
            return {"status": "error", "error": "No font available"}

        # 创建字幕图层
        draw = ImageDraw.Draw(img)
        subtitle_bar_height = 40 + len(subtitles) * 28

        if position == "bottom":
            y_start = h - subtitle_bar_height
        elif position == "top":
            y_start = 0
        else:
            y_start = h - subtitle_bar_height

        # 半透明背景条
        overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
        overlay_draw = ImageDraw.Draw(overlay)
        overlay_draw.rectangle(
            [(0, y_start), (w, y_start + subtitle_bar_height)],
            fill=(0, 0, 0, 160),
        )
        img = Image.alpha_composite(img, overlay)

        draw = ImageDraw.Draw(img)
        y_offset = y_start + 8
        for sub in subtitles:
            text = sub.get("text", "")
            color_str = sub.get("color", "#FFFFFF")
            try:
                r, g, b = int(color_str[1:3], 16), int(color_str[3:5], 16), int(color_str[5:7], 16)
            except (ValueError, IndexError):
                r, g, b = 255, 255, 255

            # 居中绘制
            bbox = draw.textbbox((0, 0), text, font=font)
            text_w = bbox[2] - bbox[0]
            x = (w - text_w) // 2
            draw.text((x, y_offset), text, fill=(r, g, b, 255), font=font)
            y_offset += 28

        output_path = image_path.rsplit(".", 1)[0] + "_sub.png"
        img.convert("RGB").save(output_path, format="PNG")

        return {
            "status": "ok",
            "output_path": output_path,
            "subtitles_added": len(subtitles),
        }
