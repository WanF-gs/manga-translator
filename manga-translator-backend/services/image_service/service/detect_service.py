from __future__ import annotations
"""文字检测服务 - 真实实现

策略：
1. 优先调用 AI 微服务 (common.clients.ai_service.AIServiceClient)
2. 回退方案：基于 OpenCV 的边缘检测 + 轮廓分析
3. 最终兜底：返回空检测结果
"""
import uuid
import io
import logging
from typing import Optional, List
from urllib.parse import urlparse

import httpx
from PIL import Image
from sqlalchemy import select, delete as sql_delete
from sqlalchemy.ext.asyncio import AsyncSession

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from common.core.config import settings
from common.core.exceptions import ResourceNotFound
from common.models.page import Page
from common.models.text_region import TextRegion

logger = logging.getLogger(__name__)

# 项目服务地址（用于解析相对 URL）
STORAGE_BASE_URL = os.getenv("STORAGE_BASE_URL", "http://localhost:8002")
# 本地文件挂载路径（project_uploads 卷挂载到 /tmp/manga-storage）
LOCAL_STORAGE_ROOT = os.getenv("LOCAL_STORAGE_ROOT", "/tmp/manga-storage/uploads")


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

# 区域类型映射 - 保留AI网关返回的精确类型
REGION_TYPE_MAP = {
    "speech": "speech",
    "thought": "thought",
    "narration": "narration",
    "onomatopoeia": "onomatopoeia",
    "effect": "effect",
    "speech_bubble": "speech",
    "narration_box": "narration",
    "sound_effect": "onomatopoeia",
    "caption": "narration",
    "bubble": "speech",
    "narrative": "narration",
    "sfx": "onomatopoeia",
}


def _normalize_region_type(raw_type: str) -> str:
    return REGION_TYPE_MAP.get(raw_type, raw_type)


def _normalize_bbox(bbox) -> dict:
    """
    将各种 bbox 格式统一为 {x, y, width, height}
    支持: [x, y, w, h] 或 {x, y, width, height} 或 {left, top, right, bottom}
    """
    if isinstance(bbox, (list, tuple)) and len(bbox) >= 4:
        return {"x": bbox[0], "y": bbox[1], "width": bbox[2], "height": bbox[3]}
    if isinstance(bbox, dict):
        if "x" in bbox and "y" in bbox and "width" in bbox and "height" in bbox:
            return bbox
        if "left" in bbox and "top" in bbox and "right" in bbox and "bottom" in bbox:
            return {
                "x": bbox["left"],
                "y": bbox["top"],
                "width": bbox["right"] - bbox["left"],
                "height": bbox["bottom"] - bbox["top"],
            }
    return {"x": 0, "y": 0, "width": 100, "height": 100}


async def _ai_detect(image_url: str, language: str = "ja") -> Optional[List[dict]]:
    """通过 AI 微服务检测文字区域"""
    try:
        from common.clients.ai_service import ai_client
        logger.info(f"AI detect: calling AI Gateway with url={image_url}, lang={language}")
        result = await ai_client.detect_text_regions(image_url, language=language)
        logger.info(f"AI detect: response keys={list(result.keys()) if result else None}, status={result.get('status', 'N/A') if result else 'None'}")
        if result and "regions" in result:
            return result["regions"]
    except Exception as e:
        logger.warning(f"AI detect failed: {e}, falling back to CV-based detection")
    return None


async def _cv_detect(image_data: bytes) -> list:
    """基于 OpenCV 的边缘检测回退方案（v2：增加合并与过滤）"""
    try:
        import cv2
        import numpy as np
        import math

        img_array = np.frombuffer(image_data, dtype=np.uint8)
        img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
        if img is None:
            return []

        h, w = img.shape[:2]
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        diagonal = math.sqrt(w**2 + h**2)

        # MSER 文字区域检测 — 跳过过小的图片避免崩溃
        regions_mser = None
        if w >= 10 and h >= 10:
            try:
                mser = cv2.MSER_create()
                mser.setMinArea(int(w * h * 0.001))
                mser.setMaxArea(int(w * h * 0.08))
                regions_mser, _ = mser.detectRegions(gray)
            except cv2.error:
                logger.warning(f"CV detect: MSER failed on {w}x{h} image, skipping")

        # 形态学方法增强 (smaller kernel to avoid over-merging horizontally)
        _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (8, 3))  # was (15,4) — too wide
        morph = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)

        contours, _ = cv2.findContours(morph, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        raw_boxes = []
        seen_boxes = set()
        
        # Collect contour-based boxes
        for cnt in contours:
            x, y, rw, rh = cv2.boundingRect(cnt)
            if rw < 12 or rh < 8 or rw > w * 0.9 or rh > h * 0.9:
                continue
            if rw * rh < 150:
                continue
            key = (x // 8, y // 8, rw // 8, rh // 8)
            if key in seen_boxes:
                continue
            seen_boxes.add(key)
            raw_boxes.append((x, y, rw, rh, 0.75))

        # Collect MSER-based boxes
        if regions_mser is not None:
            for mser_region in regions_mser:
                rx, ry, rw, rh = cv2.boundingRect(mser_region)
                key = (rx // 8, ry // 8, rw // 8, rh // 8)
                if key in seen_boxes:
                    continue
                if rw < 12 or rh < 8 or rw > w * 0.9 or rh > h * 0.9:
                    continue
                seen_boxes.add(key)
                raw_boxes.append((rx, ry, rw, rh, 0.70))

        logger.info(f"CV detect: {len(raw_boxes)} raw boxes")

        # Merge nearby boxes into bubble-level regions (PRD 2.2.8: tighter merge to avoid oversized boxes)
        merge_dist = diagonal * 0.018  # reduced from 0.03 — was merging separate text groups into huge regions
        clusters = []
        used = set()

        def centroid_dist(b1, b2):
            cx1, cy1 = b1[0] + b1[2]/2, b1[1] + b1[3]/2
            cx2, cy2 = b2[0] + b2[2]/2, b2[1] + b2[3]/2
            return math.sqrt((cx1-cx2)**2 + (cy1-cy2)**2)

        for i, box in enumerate(raw_boxes):
            if i in used:
                continue
            cluster = [box]
            used.add(i)
            changed = True
            while changed:
                changed = False
                for j, other in enumerate(raw_boxes):
                    if j in used:
                        continue
                    for cb in cluster:
                        if centroid_dist(cb, other) < merge_dist:
                            cluster.append(other)
                            used.add(j)
                            changed = True
                            break
            clusters.append(cluster)

        # Merge clusters into final regions (PRD 2.2.8: tight bounds for quality)
        regions = []
        # PRD 2.2.8: Absolute size caps to prevent oversized boxes
        abs_max_w = int(w * 0.28)   # No box wider than 28% of image width
        abs_max_h = int(h * 0.22)   # No box taller than 22% of image height
        max_area_px = w * h * 0.06  # No box larger than 6% of total image area
        
        for cluster in clusters:
            if len(cluster) == 1:
                bx, by_, bw, bh, conf = cluster[0]
                # PRD 2.2.1: ≥2px margin from text to border, minimal padding
                pad_x = max(2, int(bw * 0.02))  # reduced from 0.05
                pad_y = max(2, int(bh * 0.02))
                bx = max(0, bx - pad_x)
                by_ = max(0, by_ - pad_y)
                bw = min(w - bx, bw + 2 * pad_x)
                bh = min(h - by_, bh + 2 * pad_y)
            else:
                min_x = min(b[0] for b in cluster)
                min_y = min(b[1] for b in cluster)
                max_x = max(b[0] + b[2] for b in cluster)
                max_y = max(b[1] + b[3] for b in cluster)
                bw = max_x - min_x
                bh = max_y - min_y
                pad_x = max(2, int(bw * 0.03))  # reduced from 0.08
                pad_y = max(2, int(bh * 0.03))
                bx = max(0, min_x - pad_x)
                by_ = max(0, min_y - pad_y)
                bw = min(w - bx, bw + 2 * pad_x)
                bh = min(h - by_, bh + 2 * pad_y)
                conf = max(b[4] for b in cluster)

            if bw < 20 or bh < 12:
                continue
            if bw * bh < 200:
                continue

            # PRD 2.2.8: Absolute size caps — prevent huge boxes covering non-text areas
            if bw > abs_max_w or bh > abs_max_h:
                continue  # Region too large — likely background/art, not text
            if bw * bh > max_area_px:
                continue  # Area too large per PRD coverage constraints

            # Basic aspect ratio check (PRD 2.2.1: filter extreme aspect ratios)
            aspect_ratio = bw / max(bh, 1)
            if aspect_ratio < 0.2 or aspect_ratio > 8.0:
                continue

            # P0 PRECISION FIX: Non-text content filtering for CV fallback
            # Check if region actually contains text-like patterns
            roi = gray[by_:by_+bh, bx:bx+bw] if 0 <= by_ < h and 0 <= bx < w and bh > 0 and bw > 0 else None
            if roi is not None and roi.size > 0:
                try:
                    # Feature 1: Dark pixel ratio (text is darker than background)
                    dark_ratio = np.sum(roi < 110) / max(roi.size, 1)
                    if dark_ratio < 0.06 or dark_ratio > 0.55:
                        continue  # Too few or too many dark pixels = no text / solid fill
                    
                    # Feature 2: Edge density check
                    edges = cv2.Canny(roi, 50, 150)
                    edge_density = np.sum(edges > 0) / max(edges.size, 1)
                    if edge_density < 0.04:
                        continue  # No edges = flat background/image area
                    
                    # Feature 3: Character-like component count
                    _, roi_binary = cv2.threshold(roi, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
                    n_labels = cv2.connectedComponentsWithStats(roi_binary, connectivity=8)[0]
                    if n_labels <= 2:
                        continue  # No separable components = not text
                except Exception:
                    pass  # If analysis fails, keep the region (don't filter)

            # Classify region type based on shape characteristics
            area_ratio = (bw * bh) / (w * h + 1e-6)
            if aspect_ratio > 3.0:
                region_type = "narration"
            elif aspect_ratio > 2.0 and area_ratio > 0.03:
                region_type = "onomatopoeia"
            elif aspect_ratio < 0.5:
                region_type = "effect"
            elif len(cluster) == 1 and bw < w * 0.05 and bh < h * 0.05:
                region_type = "thought"
            else:
                region_type = "speech"

            regions.append({
                "region_id": str(uuid.uuid4()),
                "bbox": [bx, by_, bw, bh],
                "type": region_type,
                "confidence": round(min(0.95, conf + 0.05), 2),
                "angle": 0,
            })

        # Sort top-to-bottom, left-to-right
        regions.sort(key=lambda r: (r["bbox"][1], r["bbox"][0]))
        logger.info(f"CV detect: merged to {len(regions)} regions (abs_max={abs_max_w}x{abs_max_h}, area_cap={max_area_px})")
        return regions[:25]  # PRD 2.2.1: ~5-25 regions per manga page
    except ImportError:
        logger.warning("OpenCV not available for fallback detection")
        return []


async def _pil_detect(image_data: bytes) -> list:
    """基于 PIL 的纯 Python 回退方案（无外部依赖）"""
    try:
        img = Image.open(io.BytesIO(image_data)).convert("L")
        w, h = img.size
        # 边缘检测：使用简单的梯度方法
        pixels = img.load()
        edges = Image.new("L", (w, h))
        edge_pixels = edges.load()

        for y in range(1, h - 1):
            for x in range(1, w - 1):
                gx = abs(pixels[x + 1, y] - pixels[x - 1, y])
                gy = abs(pixels[x, y + 1] - pixels[x, y - 1])
                edge_pixels[x, y] = min(255, gx + gy)

        # 简单的连通区域分析
        threshold = 60
        visited = set()
        regions = []

        step = 4  # 步进加速
        for start_y in range(0, h, step):
            for start_x in range(0, w, step):
                if (start_x, start_y) in visited:
                    continue
                if edge_pixels[start_x, start_y] < threshold:
                    continue

                # BFS 扩展
                stack = [(start_x, start_y)]
                min_x, min_y, max_x, max_y = start_x, start_y, start_x, start_y
                area = 0

                while stack and area < 20000:
                    cx, cy = stack.pop()
                    if (cx, cy) in visited:
                        continue
                    if cx < 0 or cx >= w or cy < 0 or cy >= h:
                        continue
                    if edge_pixels[cx, cy] < threshold:
                        continue
                    visited.add((cx, cy))
                    area += 1
                    min_x, max_x = min(min_x, cx), max(max_x, cx)
                    min_y, max_y = min(min_y, cy), max(max_y, cy)
                    for dx, dy in [(-step, 0), (step, 0), (0, -step), (0, step)]:
                        nx, ny = cx + dx, cy + dy
                        if 0 <= nx < w and 0 <= ny < h and (nx, ny) not in visited:
                            stack.append((nx, ny))

                rw = max_x - min_x + 1
                rh = max_y - min_y + 1
                # 过滤条件：宽高合理
                if (rw > 20 and rh > 12 and rw < w * 0.85 and rh < h * 0.85
                        and 0.1 < rw / rh < 15 and area > 50):
                    regions.append({
                        "region_id": str(uuid.uuid4()),
                        "bbox": [min_x, min_y, rw, rh],
                        "type": "bubble",
                        "confidence": 0.65,
                        "angle": 0,
                    })

        # 按位置排序：从上到下，从左到右
        regions.sort(key=lambda r: (r["bbox"][1], r["bbox"][0]))
        return regions[:50]
    except Exception as e:
        logger.warning(f"PIL detect failed: {e}")
        return []


class DetectService:
    """文字区域检测服务"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def detect(
        self, page_id: str, user_id: str, detect_all: bool, language: str
    ) -> dict:
        """检测页面中的文字区域并存入DB"""
        task_id = str(uuid.uuid4())

        # 查询页面获取图片URL
        result = await self.db.execute(
            select(Page).where(Page.page_id == page_id)
        )
        page = result.scalar_one_or_none()
        if not page:
            raise ResourceNotFound(f"Page {page_id} not found")

        image_url = page.original_url
        # P0 FIX: 如果 original_url 是自引用URL，使用 processed_url 作为备选
        if image_url and image_url.startswith("/api/v1/pages/") and page.processed_url:
            logger.info(f"Detect: original_url is self-referencing, using processed_url instead")
            image_url = page.processed_url
        resolved_url = _resolve_image_url(image_url)
        regions = []
        image_data = None  # 用于后续边缘过滤获取真实页面尺寸

        logger.info(f"Detect: page={page_id}, image_url={image_url}, resolved_url={resolved_url}")

        # 策略1: 调用 AI 微服务（使用解析后的绝对 URL）
        regions = await _ai_detect(resolved_url, language=language)

        # 策略2: 回退到本地 CV 检测
        if regions is None:
            # 优先从本地文件系统读取（project_uploads 卷挂载）
            local_path = _url_to_local_path(image_url) if image_url else None
            if local_path:
                try:
                    with open(local_path, "rb") as f:
                        image_data = f.read()
                    logger.info(f"Detect: loaded image from local path: {local_path} ({len(image_data)} bytes)")
                except Exception as e:
                    logger.warning(f"Detect: failed to read local file {local_path}: {e}")
                    image_data = None

            # 回退 HTTP 下载
            if not image_data:
                try:
                    async with httpx.AsyncClient(timeout=30.0) as client:
                        resp = await client.get(resolved_url)
                        resp.raise_for_status()
                        image_data = resp.content
                    logger.info(f"Detect: downloaded image from {resolved_url} ({len(image_data)} bytes)")
                except Exception as e:
                    logger.warning(f"Detect: failed to download image from {resolved_url}: {e}")
                    image_data = None

            if image_data:
                regions = await _cv_detect(image_data)
                logger.info(f"Detect: CV detection found {len(regions)} regions")
                if not regions:
                    regions = await _pil_detect(image_data)
                    logger.info(f"Detect: PIL detection found {len(regions)} regions")

            if regions is None:
                regions = []

        logger.info(f"Detect: total regions={len(regions)}")

        # ===== CRITICAL FIX: 先删除该页面的旧区域，避免重试导致累积 =====
        await self.db.execute(
            sql_delete(TextRegion).where(TextRegion.page_id == page_id)
        )
        await self.db.flush()
        logger.info(f"Detect: cleared old regions for page {page_id}")

        # 存入 TextRegion 表
        saved_regions = []

        # PRD 2.2.3: 获取页面尺寸用于边缘区域智能过滤
        page_w, page_h = 1200, 1600  # 默认尺寸
        try:
            img = Image.open(io.BytesIO(image_data)) if image_data else None
            if img:
                page_w, page_h = img.size
        except Exception:
            pass

        for idx, region in enumerate(regions):
            bbox = region.get("bbox", region.get("boundary", [0, 0, 100, 100]))
            boundary = _normalize_bbox(bbox)
            region_type = _normalize_region_type(region.get("type", "bubble"))

            # PRD 2.2.3: 边缘区域智能过滤 — 排除贴近页面边缘的孤立方块/噪点
            bx, by = boundary["x"], boundary["y"]
            bw, bh = boundary["width"], boundary["height"]
            edge_margin = min(page_w, page_h) * 0.06  # 6% 边距 (tightened from 4%)
            is_edge = (
                bx < edge_margin or by < edge_margin
                or (bx + bw) > page_w - edge_margin
                or (by + bh) > page_h - edge_margin
            )
            is_tiny = bw < 30 or bh < 18 or (bw * bh < 400)  # 极小方块或面积过小 → 噪点
            if is_edge and is_tiny:
                continue
            
            # 置信度过滤：低于 0.50 的区域跳过（PRD 2.2.1: 置信度<60%高亮提醒，<50%直接过滤）
            region_confidence = region.get("confidence", 0.8)
            if region_confidence < 0.50:
                continue
            
            # 极小孤立区域（宽高都 < 35px）即使不在边缘也跳过
            if bw < 25 and bh < 15:
                continue

            # P0: Store detection metadata in boundary:
            # - is_vertical, arc_curvature (已有)
            # - bubble_contour (气泡轮廓多边形) — PRD §2.4.3 自适应排版
            # - polygon (紧致多边形边界) — PRD §2.2.8 选区边界精度
            # - shape_type (形状类型: ellipse/convex_hull/rectangle) — PRD §2.2.8
            enriched_boundary = dict(boundary)
            enriched_boundary["is_vertical"] = region.get("is_vertical", False)
            enriched_boundary["arc_curvature"] = region.get("arc_curvature", 0.0)

            # PRD §2.2.8: 保存气泡轮廓多边形
            if region.get("bubble_contour"):
                enriched_boundary["bubble_contour"] = region["bubble_contour"]

            # PRD §2.2.8: 保存紧致多边形边界（含 polygon 字段）
            full_boundary = region.get("boundary", {})
            if isinstance(full_boundary, dict):
                if full_boundary.get("polygon"):
                    enriched_boundary["polygon"] = full_boundary["polygon"]
                if full_boundary.get("shape_type"):
                    enriched_boundary["shape_type"] = full_boundary["shape_type"]
                elif region.get("bubble_contour"):
                    enriched_boundary["shape_type"] = "ellipse"
                else:
                    enriched_boundary["shape_type"] = "rectangle"

            # PRD §2.2.8: 向后兼容 — 若缺少 polygon，用 bbox 四个角自动生成
            if "polygon" not in enriched_boundary:
                bx, by_, bw_, bh_ = boundary["x"], boundary["y"], boundary["width"], boundary["height"]
                enriched_boundary["polygon"] = [
                    [bx, by_], [bx + bw_, by_], [bx + bw_, by_ + bh_], [bx, by_ + bh_]
                ]

            # PRD §2.2.8: 拟合到真实轮廓（椭圆/凸包）时用 polygon 模式，纯 bbox 降级为 rect
            _shape = enriched_boundary.get("shape_type", "rectangle")
            _poly = enriched_boundary.get("polygon") or []
            boundary_mode = "polygon" if (_shape in ("ellipse", "convex_hull") and len(_poly) >= 3) else "rect"

            text_region = TextRegion(
                page_id=uuid.UUID(page_id),
                type=region_type,
                boundary=enriched_boundary,
                boundary_mode=boundary_mode,
                confidence=region.get("confidence", 0.8),
                sort_order=idx,
            )
            self.db.add(text_region)
            saved_regions.append({
                "region_id": str(text_region.region_id),
                "bbox": [boundary["x"], boundary["y"],
                          boundary["width"], boundary["height"]],
                "type": region_type,
                "confidence": text_region.confidence,
                "angle": region.get("angle", 0),
                "is_vertical": region.get("is_vertical", False),
                "boundary_mode": boundary_mode,
                # PRD §2.2.8: 响应中返回多边形边界
                "boundary": {
                    "x": boundary["x"], "y": boundary["y"],
                    "width": boundary["width"], "height": boundary["height"],
                    "polygon": enriched_boundary.get("polygon"),
                    "points": enriched_boundary.get("polygon"),
                    "shape_type": enriched_boundary.get("shape_type", "rectangle"),
                },
            })

        await self.db.commit()

        return {
            "task_id": task_id,
            "status": "completed",
            "regions": saved_regions,
            "image_url": image_url,
        }

    async def get_status(self, page_id: str, task_id: str, user_id: str) -> dict:
        """获取检测任务状态 - 从DB查询已有区域"""
        result = await self.db.execute(
            select(TextRegion)
            .where(TextRegion.page_id == page_id)
            .order_by(TextRegion.sort_order.asc())
        )
        regions = list(result.scalars().all())

        region_list = []
        for r in regions:
            boundary = r.boundary or {}
            region_list.append({
                "region_id": str(r.region_id),
                "bbox": [boundary.get("x", 0), boundary.get("y", 0),
                          boundary.get("width", 0), boundary.get("height", 0)],
                "type": r.type,
                "confidence": r.confidence,
                "angle": 0,
            })

        return {
            "task_id": task_id,
            "status": "completed",
            "progress": 100,
            "regions": region_list,
        }
