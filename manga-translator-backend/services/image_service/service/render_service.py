from __future__ import annotations
"""
文字渲染服务 v2 — 气泡自适应排版，完全对齐 PRD §2.4.3

核心改进（相对 v1）：
1. 气泡形状感知排版：
   - 加载区域类型与检测轮廓，计算气泡内每行的最大可用宽度
   - 不规则气泡（星形、云形、带尾锥）内文字自适应形状
2. 自动缩字号：文字溢出时逐步缩小至原字号70%，仍溢出则截断+省略号
3. 竖排→横排自动转换：日文竖排原文自动转为中文横排
4. 漫画级字体渲染：内置漫画字体样式预设，清晰描边
5. 画质无损：保持原图分辨率，PNG 无损输出
6. 对齐规则：默认居中对齐，支持左/右对齐切换
"""
import uuid
import io
import os
import pathlib
import logging
import math
from typing import List, Optional, Tuple

import httpx
from PIL import Image, ImageDraw, ImageFont
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from common.core.config import settings
from common.models.page import Page
from common.models.text_region import TextRegion

logger = logging.getLogger(__name__)

STORAGE_BASE_URL = os.getenv("STORAGE_BASE_URL", "http://localhost:8002")
LOCAL_STORAGE_ROOT = os.getenv("LOCAL_STORAGE_ROOT", os.path.join(settings.UPLOAD_DIR, "uploads"))
LOCAL_UPLOADS_DIR = os.getenv("LOCAL_UPLOADS_DIR", settings.UPLOAD_DIR)

# ============================================================
# 字体系统
# ============================================================

FONT_SEARCH_PATHS = [
    settings.FONT_DIR,
    "/usr/share/fonts/truetype/wqy",   # v12: WSL/Linux WQY Zen Hei (CJK default)
    "/usr/share/fonts",
    "/usr/local/share/fonts",
    "/usr/share/fonts/truetype/noto",
    "/usr/share/fonts/opentype/noto",
    "/usr/share/fonts/truetype/droid",
    os.path.join(os.path.dirname(__file__), "fonts"),
    # 从 image_service/service/ 向上 4 层到 manga-translator-backend/，再进 fonts/
    os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), "fonts"),
    os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "fonts"),  # services/fonts (兜底)
    "C:/Windows/Fonts",
]

CJK_FONT_CANDIDATES = [
    # v12: WSL/Linux system CJK fonts first (most likely available without extra install)
    "wqy-zenhei.ttc", "wqy-microhei.ttc",
    "DroidSansFallbackFull.ttf",
    # Custom fonts from project fonts/ directory
    "NotoSansSC-Regular.otf", "NotoSansSC-VF.ttf", "NotoSansSC-Bold.otf",
    "SourceHanSansSC-Regular.otf", "SourceHanSansSC-Regular.ttf",
    "NotoSansCJK-Regular.ttc", "NotoSansJP-Regular.otf", "NotoSansJP-Bold.otf",
    "NotoSansKR-Regular.otf", "NotoSansKR-Bold.otf",
    "SourceHanSansK-Regular.otf", "SourceHanSansK-Regular.ttf",
    "malgun.ttf", "malgunbd.ttf",
    "simsun.ttc", "simsun.ttf", "msyh.ttc", "msyh.ttf",
    "msgothic.ttc", "AppleGothic.ttf",
    "Arial.ttf", "DejaVuSans.ttf",
    "LXGWWenKai-Regular.ttf", "LXGWWenKai-Bold.ttf",
    "anime_ace.ttf", "anime_ace_3.ttf", "comic shanns 2.ttf",
]

_font_cache: dict = {}


def _find_font(size: int = 16) -> Optional[ImageFont.FreeTypeFont]:
    cache_key = f"default_{size}"
    if cache_key in _font_cache:
        return _font_cache[cache_key]

    for search_path in FONT_SEARCH_PATHS:
        if not os.path.isdir(search_path):
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
            for root, _, files in os.walk(search_path):
                for f in files:
                    if f.startswith(candidate.split(".")[0]) and f.lower().endswith((".ttf", ".otf", ".ttc")):
                        try:
                            font = ImageFont.truetype(os.path.join(root, f), size)
                            _font_cache[cache_key] = font
                            return font
                        except Exception:
                            continue
                break

    try:
        font = ImageFont.load_default()
        _font_cache[cache_key] = font
        return font
    except Exception:
        return None


def _get_font(family: Optional[str] = None, size: int = 16) -> Optional[ImageFont.FreeTypeFont]:
    cache_key = f"{family}_{size}"
    if cache_key in _font_cache:
        return _font_cache[cache_key]

    # family 若是一个存在的字体文件绝对路径，直接加载（字体解析器返回的路径）
    if family and os.path.isabs(family) and os.path.isfile(family):
        try:
            font = ImageFont.truetype(family, size)
            _font_cache[cache_key] = font
            return font
        except Exception:
            pass

    if family:
        for search_path in FONT_SEARCH_PATHS:
            if not os.path.isdir(search_path):
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
        for search_path in FONT_SEARCH_PATHS:
            if not os.path.isdir(search_path):
                continue
            for root, _, files in os.walk(search_path):
                for f in files:
                    if family.lower() in f.lower() and f.lower().endswith((".ttf", ".otf", ".ttc")):
                        try:
                            font = ImageFont.truetype(os.path.join(root, f), size)
                            _font_cache[cache_key] = font
                            return font
                        except Exception:
                            continue
                break

    return _find_font(size)


# ============================================================
# 气泡形状感知文字换行 — PRD §2.4.3 核心实现
# ============================================================

def _get_bubble_available_width(
    y_pos: float,
    region_x: int,
    region_w: int,
    region_h: int,
    region_type: str,
) -> int:
    """
    计算气泡内某 Y 坐标位置的最大可用文字宽度。
    
    对于圆形/椭圆形气泡，中间宽、上下窄。
    对于矩形旁白框，宽度恒定。
    对于不规则气泡，基于椭圆近似。
    
    Args:
        y_pos: 文字行在区域内的相对 Y 坐标（从区域顶部算起）
        region_x: 区域左上角 X
        region_w: 区域宽度
        region_h: 区域高度
        region_type: speech/thought/narration/onomatopoeia/effect
    
    Returns:
        该 Y 位置的最大可用宽度（像素）
    """
    # 填充率：让文字尽量占满气泡宽度，避免过窄导致英文逐词折断
    fill_ratio = 0.92
    if region_type in ("narration", "effect", "onomatopoeia"):
        return max(10, int(region_w * fill_ratio) - 6)

    if region_type in ("speech", "thought"):
        center_y = region_h / 2.0
        a = region_h / 2.0
        b = (region_w / 2.0) * fill_ratio
        dy = y_pos - center_y
        if abs(dy) >= a:
            # 顶/底部仍给最小可用宽度，避免返回 0 触发逐字竖排
            return max(10, int(region_w * 0.35))
        half_width = b * math.sqrt(max(0.0, 1 - (dy * dy) / (a * a)))
        available = int(half_width * 2) - 6
        # 下限：至少能放下较宽的词，避免椭圆上下段把英文挤成单字
        return max(int(region_w * 0.45), available)

    return max(10, int(region_w * fill_ratio) - 6)


def _wrap_text_bubble_aware(
    text: str,
    font: ImageFont.FreeTypeFont,
    region_x: int,
    region_w: int,
    region_h: int,
    region_type: str,
    draw: ImageDraw.Draw,
    line_spacing: float = 1.2,
) -> Tuple[List[str], float]:
    """
    气泡感知文字换行。
    
    针对气泡形状动态调整每行的最大宽度。
    返回 (行列表, 总高度)。
    """
    if not text:
        return [""], 0

    text = text.strip()
    is_cjk = any("\u4e00" <= c <= "\u9fff" or "\u3040" <= c <= "\u30ff" or
                 "\uac00" <= c <= "\ud7af" for c in text)

    # 目标行宽：取气泡"中部"的统一可用宽度做换行（更接近人工嵌字），
    # 而非逐行按椭圆收窄——避免上下行被椭圆边缘挤成单字产生竖列。
    target_width = _get_bubble_available_width(
        region_h / 2.0, region_x, region_w, region_h, region_type
    )
    target_width = max(target_width, 12)

    def _line_w(text_s):
        if not text_s:
            return 0
        bb = draw.textbbox((0, 0), text_s, font=font)
        return bb[2] - bb[0]

    lines_final = []

    if is_cjk:
        current = ""
        for ch in text:
            test = current + ch
            if _line_w(test) <= target_width or not current:
                current = test
            else:
                lines_final.append(current)
                current = ch
        if current:
            lines_final.append(current)
    else:
        words = text.split()
        current = ""
        for word in words:
            test = (current + " " + word).strip()
            if _line_w(test) <= target_width or not current:
                current = test
            else:
                lines_final.append(current)
                if _line_w(word) > target_width:
                    sub = ""
                    for c in word:
                        t = sub + c
                        if _line_w(t) <= target_width or not sub:
                            sub = t
                        else:
                            lines_final.append(sub)
                            sub = c
                    current = sub
                else:
                    current = word
        if current:
            lines_final.append(current)

    if not lines_final:
        return [""], 0

    line_height = draw.textbbox((0, 0), "Ag", font=font)[3]
    total_height = line_height * len(lines_final) * line_spacing
    return lines_final, total_height


def _estimate_start_size(text, region_w, region_h, is_cjk, hard_max=64):
    """基于面积反推合理起始字号，避免从固定 20px 盲试。"""
    import math as _m
    n = max(1, len(text.strip()))
    fill = 0.60
    k = 0.62 if is_cjk else 0.52
    area = max(1.0, region_w * region_h * fill)
    size = int(_m.sqrt(area / (n * k * k)))
    return max(9, min(hard_max, size))


def _auto_scale_font(
    text: str,
    region_w: int,
    region_h: int,
    region_type: str,
    draw: ImageDraw.Draw,
    initial_size: int = 20,
    min_size_ratio: float = 0.70,
    line_spacing: float = 1.15,
    font_family: Optional[str] = None,
) -> Tuple[Optional[ImageFont.FreeTypeFont], List[str], int]:
    """
    自动选字号以适配气泡区域（对标 imgtrans / BalloonsTranslator）。

    - 起始字号用面积估算 + initial_size 的较大者，避免过小
    - 向下探到 MIN_FONT_SIZE(=9)，宁可字号小也显示完整，不轻易截断
    - 同时校验高度与行宽，避免溢出气泡
    """
    MIN_FONT_SIZE = 9
    is_cjk = any("\u4e00" <= c <= "\u9fff" or "\u3040" <= c <= "\u30ff" or
                 "\uac00" <= c <= "\ud7af" for c in text)

    est = _estimate_start_size(text, region_w, region_h, is_cjk)
    start = min(max(est, initial_size, 12), 72)

    def _has_midword_break(lines):
        """拉丁文本：换行后按空格重组，若与原词序列不一致说明有单词被拆断。"""
        if is_cjk:
            return False
        return " ".join(lines).split() != text.split()

    best_font = None
    best_lines = []
    fallback_font = None
    fallback_lines = []
    fallback_size = MIN_FONT_SIZE

    for size in range(start, MIN_FONT_SIZE - 1, -1):
        font = _get_font(family=font_family, size=size)
        if font is None:
            continue
        lines, total_h = _wrap_text_bubble_aware(
            text, font, 0, region_w, region_h, region_type, draw, line_spacing
        )
        max_line_w = max((draw.textbbox((0, 0), ln, font=font)[2] for ln in lines), default=0)
        fits = total_h <= region_h - 4 and max_line_w <= region_w - 4
        if fits:
            if not _has_midword_break(lines):
                return font, lines, size
            if fallback_font is None:
                fallback_font, fallback_lines, fallback_size = font, lines, size
        best_font = font
        best_lines = lines

    if fallback_font is not None:
        return fallback_font, fallback_lines, fallback_size

    # 最小字号仍放不下：尽量多显示，仅极端情况截断
    if best_font and best_lines:
        line_h = draw.textbbox((0, 0), "Ag", font=best_font)[3]
        max_lines = max(1, int((region_h - 4) / (line_h * line_spacing)))
        if len(best_lines) > max_lines:
            truncated = best_lines[:max_lines]
            last = truncated[-1]
            while last and draw.textbbox((0, 0), last + "\u2026", font=best_font)[2] > region_w - 4:
                last = last[:-1]
            truncated[-1] = (last + "\u2026") if last else "\u2026"
            return best_font, truncated, MIN_FONT_SIZE
        return best_font, best_lines, MIN_FONT_SIZE

    return None, [text], initial_size


# ============================================================
# 颜色与绘制工具
# ============================================================

def _parse_color(color_str: str) -> Tuple[int, int, int]:
    if not color_str:
        return (0, 0, 0)
    color_str = color_str.strip()
    if color_str.startswith("#"):
        color_str = color_str[1:]
        if len(color_str) == 3:
            color_str = "".join(c * 2 for c in color_str)
        if len(color_str) == 6:
            return (int(color_str[0:2], 16), int(color_str[2:4], 16), int(color_str[4:6], 16))
    return (0, 0, 0)


def _draw_manga_text(
    draw: ImageDraw.Draw,
    xy: Tuple[float, float],
    text: str,
    font: ImageFont.FreeTypeFont,
    fill: Tuple[int, int, int],
    outline_width: int = 2,
    outline_color: Tuple[int, int, int, int] = (255, 255, 255, 255),
):
    """
    漫画级文字绘制 — 带清晰描边，符合漫画嵌字视觉标准。
    
    使用双层描边（先粗后细）确保文字在任何背景上都清晰可读。
    """
    x, y = xy
    
    # 外层粗描边
    if outline_width >= 2:
        for dx in range(-2, 3):
            for dy in range(-2, 3):
                if dx == 0 and dy == 0:
                    continue
                if abs(dx) + abs(dy) <= 3:  # 八方向+对角
                    draw.text((x + dx, y + dy), text, font=font, fill=outline_color)
    elif outline_width > 0:
        for dx in range(-1, 2):
            for dy in range(-1, 2):
                if dx == 0 and dy == 0:
                    continue
                draw.text((x + dx, y + dy), text, font=font, fill=outline_color)
    
    # 主文字
    draw.text((x, y), text, font=font, fill=fill)


# ============================================================
# 辅助函数
# ============================================================

def _resolve_image_url(image_url: str) -> str:
    if image_url.startswith("http://") or image_url.startswith("https://"):
        return image_url
    if image_url.startswith("/"):
        return f"{STORAGE_BASE_URL}{image_url}"
    return f"{STORAGE_BASE_URL}/{image_url}"


def _url_to_local_path(image_url: str) -> Optional[str]:
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
# 主渲染服务
# ============================================================

class RenderService:
    """文字渲染服务 v2 — 气泡自适应排版"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def render(
        self,
        page_id: str,
        user_id: str,
        regions: list,
        preserve_style: bool,
        auto_resize: bool,
    ) -> dict:
        """
        将翻译文本渲染到图像上（气泡自适应排版）。
        
        Args:
            page_id: 页面 ID
            user_id: 用户 ID
            regions: [{region_id, translated_text, font_size?, ...}]
            preserve_style: 保留原文字样式
            auto_resize: 自动调整字号以适配区域
        """
        task_id = str(uuid.uuid4())
        warnings = []

        # 查询页面
        result = await self.db.execute(
            select(Page).where(Page.page_id == page_id)
        )
        page = result.scalar_one_or_none()
        if not page:
            return {"task_id": task_id, "status": "failed",
                    "result_url": None, "warnings": ["Page not found"]}

        # 下载图片（优先使用 processed_url = 擦除后的图）
        image_url = page.processed_url or page.original_url
        image_bytes = None

        local_path = _url_to_local_path(image_url) if image_url else None
        if local_path:
            try:
                with open(local_path, "rb") as f:
                    image_bytes = f.read()
                logger.info(f"Render: loaded image from local path {local_path}")
            except Exception as e:
                logger.warning(f"Render: failed to read local file {local_path}: {e}")

        if not image_bytes and image_url:
            download_urls = [_resolve_image_url(image_url)]
            if image_url.startswith("/uploads/"):
                download_urls.insert(0, f"http://localhost:8003{image_url}")
            if image_url.startswith("/storage/"):
                download_urls.insert(0, f"http://localhost:8002{image_url}")

            for download_url in download_urls:
                try:
                    async with httpx.AsyncClient(timeout=60.0) as client:
                        resp = await client.get(download_url)
                        resp.raise_for_status()
                        image_bytes = resp.content
                        logger.info(f"Render: downloaded image from {download_url}")
                        break
                except Exception as e:
                    logger.warning(f"Render: failed to download from {download_url}: {e}")
            
            if not image_bytes:
                return {
                    "task_id": task_id, "status": "failed",
                    "result_url": image_url,
                    "warnings": ["Failed to load image from all sources"],
                }

        if not image_bytes:
            return {
                "task_id": task_id, "status": "failed",
                "result_url": image_url,
                "warnings": ["Failed to load image (empty content)"],
            }

        try:
            # 保持原图模式（RGB=彩色漫画, RGBA=带透明度）
            img = Image.open(io.BytesIO(image_bytes))
            original_mode = img.mode
            if original_mode not in ("RGB", "RGBA"):
                img = img.convert("RGB")
                original_mode = "RGB"
        except Exception as e:
            logger.error(f"Render: failed to decode image: {e}")
            return {
                "task_id": task_id, "status": "failed",
                "result_url": image_url,
                "warnings": [f"Failed to decode image: {str(e)}"],
            }

        # 确保 RGBA 用于图层合成
        if img.mode != "RGBA":
            img = img.convert("RGBA")

        # 动态坐标校准：检测坐标基于API报告的页面尺寸，实际图片可能不同
        # 计算缩放因子，将DB中的边界坐标映射到实际图片像素空间
        actual_w, actual_h = img.size
        api_w = page.width or actual_w
        api_h = page.height or actual_h
        coord_scale_x = actual_w / api_w if api_w > 0 else 1.0
        coord_scale_y = actual_h / api_h if api_h > 0 else 1.0

        # P0 FIX: 缩放因子异常时（如 page.width/height 读取错误），避免把大量区域压到左上角重叠
        if coord_scale_x < 0.5 or coord_scale_x > 2.0 or coord_scale_y < 0.5 or coord_scale_y > 2.0:
            logger.warning(
                f"Render: abnormal coordinate scale detected — api={api_w}x{api_h}, "
                f"actual={actual_w}x{actual_h}, scale=({coord_scale_x:.3f}, {coord_scale_y:.3f}). "
                f"Falling back to scale=1.0 to prevent overlapping regions at top-left."
            )
            coord_scale_x = 1.0
            coord_scale_y = 1.0

        if abs(coord_scale_x - 1.0) > 0.01 or abs(coord_scale_y - 1.0) > 0.01:
            logger.info(f"Render: coordinate calibration — api={api_w}x{api_h}, actual={actual_w}x{actual_h}, "
                        f"scale=({coord_scale_x:.3f}, {coord_scale_y:.3f})")


        # 查询 DB 中的区域信息
        regions_result = await self.db.execute(
            select(TextRegion)
            .where(TextRegion.page_id == page_id)
            .order_by(TextRegion.sort_order.asc())
        )
        db_regions_list = list(regions_result.scalars().all())
        db_regions = {str(r.region_id): r for r in db_regions_list}

        # 如果前端未传 regions，自动从 DB 构建
        if not regions:
            regions = []
            for r in db_regions_list:
                if r.translated_text:
                    style = r.style_config or {}
                    regions.append({
                        "region_id": str(r.region_id),
                        "translated_text": r.translated_text,
                        "font_size": style.get("font_size", 16),
                        "font_family": style.get("font_family"),
                        "font_id": style.get("font_id"),
                        "font_color": style.get("color", "#000000"),
                        "alignment": style.get("text_align", "center"),
                        "line_spacing": style.get("line_spacing", 1.2),
                    })

        # 创建文字图层
        overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)
        rendered_count = 0
        skipped_count = 0

        for region in regions:

            region_id = region.get("region_id", "")
            translated_text = region.get("translated_text", "").strip()
            if not translated_text:
                skipped_count += 1
                continue

            db_region = db_regions.get(region_id)
            if not db_region or not db_region.boundary:
                logger.warning(f"Region {region_id[:8]}: missing boundary, skipping")
                skipped_count += 1
                continue


            boundary = db_region.boundary
            try:
                raw_x = float(boundary.get("x", 0))
                raw_y = float(boundary.get("y", 0))
                raw_w = float(boundary.get("width", 100))
                raw_h = float(boundary.get("height", 100))
            except (TypeError, ValueError) as e:
                logger.warning(f"Region {region_id[:8]}: invalid boundary values {boundary}, skipping: {e}")
                skipped_count += 1
                continue

            # P0 FIX: 过滤明显是默认/非法的边界（多个默认框会全部重叠在左上角）
            if raw_x == 0 and raw_y == 0 and raw_w == 100 and raw_h == 100:
                logger.warning(f"Region {region_id[:8]}: default boundary (0,0,100,100), skipping")
                skipped_count += 1
                continue

            x = raw_x * coord_scale_x
            y = raw_y * coord_scale_y
            w = raw_w * coord_scale_x
            h = raw_h * coord_scale_y

            if w <= 0 or h <= 0:
                logger.warning(f"Region {region_id[:8]}: non-positive size ({w:.1f}x{h:.1f}), skipping")
                skipped_count += 1
                continue

            # 确保渲染区域不严重超出图片边界（允许 5% 容差）
            if x + w > actual_w * 1.05 or y + h > actual_h * 1.05:
                logger.warning(
                    f"Region {region_id[:8]}: boundary outside image "
                    f"({x:.1f},{y:.1f},{w:.1f},{h:.1f} vs image {actual_w}x{actual_h}), skipping"
                )
                skipped_count += 1
                continue


            logger.debug(
                f"Region {region_id[:8]}: rendering at ({x:.1f},{y:.1f}) size {w:.1f}x{h:.1f}"
            )


            # 获取区域类型（用于气泡感知排版）
            region_type = getattr(db_region, 'type', None) or 'speech'
            is_vertical = getattr(db_region, 'is_vertical', False)
            
            # 竖排→横排转换（PRD §2.4.3）
            if is_vertical:
                logger.debug(f"Region {region_id[:8]}: vertical→horizontal conversion")
                # 日文竖排转中文横排已经在翻译阶段完成
                # 这里只需标记排版方向

            # 样式参数
            style = db_region.style_config or {}
            font_size = region.get("font_size") or style.get("font_size") or 16
            font_family = region.get("font_family") or style.get("font_family")
            font_color = region.get("font_color") or style.get("color") or "#000000"
            alignment = region.get("alignment") or style.get("text_align") or "center"
            line_spacing = region.get("line_spacing") or style.get("line_spacing") or 1.2

            # ── §2.25 字体系统链路：解析字体文件路径 ──
            # 优先级：区域显式 font_id > 绑定角色的字体 > style_config.font_family > 默认
            resolved_font_path = None
            try:
                from .font_resolver import resolve_region_font_path, glyph_fallback_path
                region_font_id = region.get("font_id") or style.get("font_id")
                char_id = getattr(db_region, "character_id", None)
                logger.info(f"Region {region_id[:8]}: resolve font start, family={font_family}, font_id={region_font_id}, char_id={char_id}")
                resolved_font_path, font_src = await resolve_region_font_path(
                    self.db,
                    font_id=region_font_id,
                    character_id=char_id,
                    font_family=font_family,
                )
                logger.info(f"Region {region_id[:8]}: resolve result path={resolved_font_path}, src={font_src}")
                if resolved_font_path:
                    # 缺字回退（§2.25）：主字体覆盖不全则沿回退链换字体
                    resolved_font_path, missing_chars = glyph_fallback_path(
                        translated_text, resolved_font_path
                    )
                    logger.info(f"Region {region_id[:8]}: fallback result path={resolved_font_path}, missing={missing_chars}")
                    if missing_chars:
                        warnings.append(
                            f"MISSING_GLYPH:{region_id}:{''.join(missing_chars[:20])}"
                        )
                    # 用解析出的真实字体文件路径覆盖 family（_get_font 支持绝对路径）
                    font_family = resolved_font_path
                    logger.debug(f"Region {region_id[:8]}: font via {font_src} -> {resolved_font_path}")
            except Exception as e:
                logger.warning(f"Region {region_id[:8]}: font resolve FAILED: {type(e).__name__}: {e}")

            # 是否为拟声词（大字号、粗体）
            is_sfx = region_type == "onomatopoeia"
            if is_sfx and auto_resize:
                font_size = max(font_size, 28)
                font_color = "#000000"

            # 获取字体
            logger.info(f"Region {region_id[:8]}: _get_font(family={font_family}, size={font_size})")
            font = _get_font(family=font_family, size=font_size)
            if font is None:
                logger.warning(f"Region {region_id[:8]}: _get_font returned None, trying _find_font")
                font = _find_font(size=font_size)
            if font is None:
                warnings.append(f"区域 {region_id[:8]} 无可用字体，跳过")
                continue

            # 气泡感知排版
            padding = 4
            max_text_height = max(h - padding * 2, 10)
            
            if auto_resize:
                # 面积估算起始字号 + 向下探到 9px，宁可字号小也显示完整
                font, lines, actual_size = _auto_scale_font(
                    translated_text, w, h, region_type, draw,
                    initial_size=font_size,
                    line_spacing=line_spacing,
                    font_family=font_family,
                )
                if font is None:
                    warnings.append(f"区域 {region_id[:8]} 文字无法适配")
                    continue
                font_size = actual_size
            else:
                lines, total_h = _wrap_text_bubble_aware(
                    translated_text, font, x, w, h, region_type, draw, line_spacing
                )
                if total_h > max_text_height and len(lines) > 1:
                    warnings.append(f"区域 {region_id[:8]} 文字可能溢出气泡")

            if len(translated_text) > 80 and len(lines) > 4:
                warnings.append(
                    f"区域 {region_id[:8]} 文本较长 ({len(translated_text)}字)，已自动调整"
                )

            # 颜色
            color_rgb = _parse_color(font_color)

            # 计算竖直对齐
            line_height = draw.textbbox((0, 0), "Ag", font=font)[3]
            total_line_height = line_height * len(lines) * line_spacing
            start_y = y + (h - total_line_height) / 2
            if start_y < y + padding:
                start_y = y + padding

            # 描边（漫画风格：白底黑字或黑底白字）
            # 自动判断：深色文字用白色描边，浅色文字用黑色描边
            luminance = 0.299 * color_rgb[0] + 0.587 * color_rgb[1] + 0.114 * color_rgb[2]
            if luminance < 128:
                outline_color = (255, 255, 255, 255)  # 白色描边
            else:
                outline_color = (0, 0, 0, 255)  # 黑色描边
            
            outline_width = 2 if not is_sfx else 3

            # ── 译文底衬（对标 imgtrans/BalloonsTranslator）──
            # 在气泡类区域译文后方铺一层与气泡底色一致的半透明底衬，
            # 彻底遮住擦除残留的原文，保证译文清晰可读。拟声词/效果字不铺(保留艺术效果)。
            if region_type in ("speech", "thought", "narration") and not is_sfx and lines:
                # 计算译文实际占用的包围盒
                text_block_w = max(
                    (draw.textbbox((0, 0), ln, font=font)[2] for ln in lines), default=0
                )
                text_block_h = total_line_height
                bx0 = x + (w - text_block_w) / 2 - 6
                by0 = start_y - 4
                bx1 = x + (w + text_block_w) / 2 + 6
                by1 = start_y + text_block_h + 4
                # 限制在区域内
                bx0 = max(x, bx0); by0 = max(y, by0)
                bx1 = min(x + w, bx1); by1 = min(y + h, by1)
                # 采样气泡底色（取区域四角中位，避开中心文字）
                try:
                    import numpy as _np
                    samp = []
                    for sx, sy in [(x + 3, y + 3), (x + w - 3, y + 3),
                                   (x + 3, y + h - 3), (x + w - 3, y + h - 3)]:
                        px = img.getpixel((int(min(max(sx, 0), img.width - 1)),
                                           int(min(max(sy, 0), img.height - 1))))
                        samp.append(px[:3])
                    bg = tuple(int(_np.median([s[c] for s in samp])) for c in range(3))
                except Exception:
                    bg = (255, 255, 255)
                # 底色太暗(深色气泡)则用其本色，否则用白，避免突兀
                fill_rgba = (bg[0], bg[1], bg[2], 235)
                # 画椭圆底衬(气泡)或圆角矩形(旁白)
                if region_type == "narration":
                    draw.rectangle([bx0, by0, bx1, by1], fill=fill_rgba)
                else:
                    draw.ellipse([bx0, by0, bx1, by1], fill=fill_rgba)

            # 绘制每一行
            for i, line in enumerate(lines):
                line_width = draw.textbbox((0, 0), line, font=font)[2]
                
                # 水平对齐
                if alignment == "center":
                    text_x = x + (w - line_width) / 2
                elif alignment == "right":
                    text_x = x + w - line_width - padding
                else:
                    text_x = x + padding
                
                text_y = start_y + i * line_height * line_spacing
                
                # 确保文字在区域内
                text_x = max(x + 1, min(text_x, x + w - line_width - 1))
                text_y = max(y + 1, text_y)
                
                # 漫画级文字绘制
                _draw_manga_text(
                    draw=draw, xy=(text_x, text_y), text=line,
                    font=font, fill=color_rgb,
                    outline_width=outline_width, outline_color=outline_color,
                )

            # 更新 DB
            db_region.translated_text = translated_text
            rendered_count += 1

        logger.info(
            f"Render summary for page {page_id}: rendered={rendered_count}, skipped={skipped_count}, "
            f"total_regions={len(regions)}, image={actual_w}x{actual_h}"
        )

        # 合成图层
        composite = Image.alpha_composite(img, overlay)


        # 保持原图模式输出
        if original_mode == "RGB":
            final = composite.convert("RGB")
        else:
            final = composite

        # 输出（PNG 无损）
        output_buffer = io.BytesIO()
        final.save(output_buffer, format="PNG", optimize=False)
        output_buffer.seek(0)

        # 上传
        result_url = ""
        try:
            from common.core.minio import minio_client
            bucket = settings.MINIO_BUCKET
            object_name = f"rendered/{page_id}/{task_id}.png"
            output_buffer.seek(0)
            minio_client.put_object(
                bucket_name=bucket,
                object_name=object_name,
                data=output_buffer,
                length=output_buffer.getbuffer().nbytes,
                content_type="image/png",
            )
            result_url = f"/storage/{bucket}/{object_name}"
        except Exception as e:
            logger.warning(f"MinIO upload failed: {e}, falling back to local disk")
            local_dir = pathlib.Path(os.getenv("UPLOAD_DIR", settings.UPLOAD_DIR)) / "pages" / page_id
            local_dir.mkdir(parents=True, exist_ok=True)
            local_path = local_dir / f"rendered_{task_id}.png"
            local_path.write_bytes(output_buffer.getvalue())
            logger.info(f"Saved render result to local path: {local_path}")
            result_url = f"/uploads/pages/{page_id}/rendered_{task_id}.png"

        # 更新 page
        page.processed_url = result_url
        await self.db.commit()

        return {
            "task_id": task_id,
            "status": "completed",
            "result_url": result_url,
            "warnings": warnings,
            "regions_rendered": rendered_count,
            "regions_skipped": skipped_count,
        }


    async def get_status(self, page_id: str, task_id: str, user_id: str) -> dict:
        result = await self.db.execute(
            select(Page).where(Page.page_id == page_id)
        )
        page = result.scalar_one_or_none()
        return {
            "task_id": task_id,
            "status": "completed" if page and page.processed_url else "pending",
            "progress": 100 if page and page.processed_url else 0,
            "result_url": page.processed_url if page else None,
        }
