from __future__ import annotations
"""
Bilingual composition service for manga export.
Three modes: side-by-side, top-bottom, in-bubble.
"""
import io
import logging
import os
from typing import Dict, Any, Optional

import httpx
from PIL import Image

logger = logging.getLogger(__name__)


def _resolve_url(url: str) -> str:
    """P0 FIX: 将相对路径补全为完整 URL"""
    if url and url.startswith("/"):
        base = os.getenv("STORAGE_BASE_URL", "http://localhost:8080")
        url = base.rstrip("/") + url
    return url


class BilingualComposer:
    """Compose original and translated pages into bilingual output."""

    MODES = ["side-by-side", "top-bottom", "in-bubble"]
    GAP = 10  # pixels between images
    LABEL_HEIGHT = 30  # label height for mode labels
    LABEL_FONT_SIZE = 14

    async def compose(
        self,
        mode: str,
        original_url: str,
        translated_url: str,
        original_label: str = "原文",
        translated_label: str = "译文",
        gap: int = 10,
    ) -> Optional[bytes]:
        """
        Compose two images into one bilingual output.
        
        Args:
            mode: "side-by-side", "top-bottom", or "in-bubble"
            original_url: URL of original image
            translated_url: URL of translated image
            original_label: Label for original side
            translated_label: Label for translated side
            gap: Gap between images in pixels
        
        Returns:
            PNG image bytes or None on failure
        """
        if mode not in self.MODES:
            mode = "side-by-side"

        # Download images
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp1 = await client.get(_resolve_url(original_url))
                resp1.raise_for_status()
                img1 = Image.open(io.BytesIO(resp1.content)).convert("RGB")

                resp2 = await client.get(_resolve_url(translated_url))
                resp2.raise_for_status()
                img2 = Image.open(io.BytesIO(resp2.content)).convert("RGB")
        except Exception as e:
            logger.error(f"Failed to download images: {e}")
            return None

        if mode == "side-by-side":
            result = await self.compose_side_by_side(img1, img2, gap, original_label, translated_label)
        elif mode == "top-bottom":
            result = await self.compose_top_bottom(img1, img2, gap, original_label, translated_label)
        else:
            # in-bubble: use original image size, translated is already rendered
            result = img2

        # Encode to PNG
        output = io.BytesIO()
        result.save(output, format="PNG", optimize=True)
        output.seek(0)
        return output.getvalue()

    async def compose_side_by_side(
        self,
        original: Image.Image,
        translated: Image.Image,
        gap: int = 10,
        original_label: str = "原文",
        translated_label: str = "译文",
    ) -> Image.Image:
        """
        Compose two images side by side.
        Original on left, translated on right.
        """
        # Make both images same height
        max_height = max(original.height, translated.height)
        w1, h1 = original.width, original.height
        w2, h2 = translated.width, translated.height

        # Scale to same height if needed
        if h1 != max_height:
            ratio = max_height / h1
            w1 = int(w1 * ratio)
            original = original.resize((w1, max_height), Image.LANCZOS)
        if h2 != max_height:
            ratio = max_height / h2
            w2 = int(w2 * ratio)
            translated = translated.resize((w2, max_height), Image.LANCZOS)

        # Create canvas
        total_width = w1 + gap + w2
        canvas = Image.new("RGB", (total_width, max_height), (255, 255, 255))

        # Paste images
        canvas.paste(original, (0, 0))
        canvas.paste(translated, (w1 + gap, 0))

        # Add labels using PIL text
        try:
            from PIL import ImageDraw, ImageFont
            draw = ImageDraw.Draw(canvas)
            
            # Try to find a font
            font = None
            font_paths = [
                "C:/Windows/Fonts/msyh.ttc",
                "C:/Windows/Fonts/simsun.ttc",
                "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                "/System/Library/Fonts/Helvetica.ttc",
            ]
            for fp in font_paths:
                try:
                    font = ImageFont.truetype(fp, 18)
                    break
                except Exception:
                    continue
            
            if font is None:
                font = ImageFont.load_default()

            # Semi-transparent background for labels
            label_bg_height = 24
            label_alpha = 128
            
            # Original label
            label1_bg = Image.new("RGBA", (min(w1, 80), label_bg_height), (0, 0, 0, label_alpha))
            canvas_rgba = canvas.convert("RGBA")
            canvas_rgba.paste(label1_bg, (5, 5), label1_bg)
            
            # Translated label
            label2_bg = Image.new("RGBA", (min(w2, 80), label_bg_height), (0, 0, 0, label_alpha))
            canvas_rgba.paste(label2_bg, (w1 + gap + 5, 5), label2_bg)
            
            canvas = canvas_rgba.convert("RGB")
            draw = ImageDraw.Draw(canvas)
            draw.text((10, 7), original_label, fill=(255, 255, 255), font=font)
            draw.text((w1 + gap + 10, 7), translated_label, fill=(255, 255, 255), font=font)
        except Exception as e:
            logger.debug(f"Failed to add labels: {e}")

        return canvas

    async def compose_top_bottom(
        self,
        original: Image.Image,
        translated: Image.Image,
        gap: int = 10,
        original_label: str = "原文",
        translated_label: str = "译文",
    ) -> Image.Image:
        """
        Compose two images vertically.
        Original on top, translated on bottom.
        """
        # Make both images same width
        max_width = max(original.width, translated.width)
        w1, h1 = original.width, original.height
        w2, h2 = translated.width, translated.height

        if w1 != max_width:
            ratio = max_width / w1
            h1 = int(h1 * ratio)
            original = original.resize((max_width, h1), Image.LANCZOS)
        if w2 != max_width:
            ratio = max_width / w2
            h2 = int(h2 * ratio)
            translated = translated.resize((max_width, h2), Image.LANCZOS)

        # Create canvas
        total_height = h1 + gap + h2
        canvas = Image.new("RGB", (max_width, total_height), (255, 255, 255))

        canvas.paste(original, (0, 0))
        canvas.paste(translated, (0, h1 + gap))

        # Add labels
        try:
            from PIL import ImageDraw, ImageFont
            draw = ImageDraw.Draw(canvas)
            
            font = None
            font_paths = [
                "C:/Windows/Fonts/msyh.ttc",
                "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            ]
            for fp in font_paths:
                try:
                    font = ImageFont.truetype(fp, 18)
                    break
                except Exception:
                    continue
            if font is None:
                font = ImageFont.load_default()

            label_bg_height = 24
            label_alpha = 128
            
            label1_bg = Image.new("RGBA", (min(max_width, 80), label_bg_height), (0, 0, 0, label_alpha))
            canvas_rgba = canvas.convert("RGBA")
            canvas_rgba.paste(label1_bg, (5, 5), label1_bg)
            
            label2_bg = Image.new("RGBA", (min(max_width, 80), label_bg_height), (0, 0, 0, label_alpha))
            canvas_rgba.paste(label2_bg, (5, h1 + gap + 5), label2_bg)
            
            canvas = canvas_rgba.convert("RGB")
            draw = ImageDraw.Draw(canvas)
            draw.text((10, 7), original_label, fill=(255, 255, 255), font=font)
            draw.text((10, h1 + gap + 7), translated_label, fill=(255, 255, 255), font=font)
        except Exception as e:
            logger.debug(f"Failed to add labels: {e}")

        return canvas

    async def compose_in_bubble(
        self,
        page_id: str,
        original_text: str,
        translated_text: str,
        db_session,
    ) -> Optional[bytes]:
        """
        Show both original and translated text in the same bubble.
        Uses render_service to draw text with annotations.
        """
        from image_service.service.render_service import RenderService
        
        try:
            service = RenderService(db_session)
            result = await service.render(
                page_id=page_id,
                user_id="system",
                regions=[{
                    "region_id": page_id,
                    "translated_text": f"{original_text}\n——\n{translated_text}",
                }],
                preserve_style=True,
                auto_resize=True,
            )
            
            result_url = result.get("result_url")
            if result_url and result_url.startswith("/storage/"):
                async with httpx.AsyncClient(timeout=30.0) as client:
                    resp = await client.get(result_url)
                    resp.raise_for_status()
                    return resp.content
        except Exception as e:
            logger.warning(f"In-bubble composition failed: {e}")
        
        return None
