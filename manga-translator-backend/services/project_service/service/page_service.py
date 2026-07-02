from __future__ import annotations
"""
Page management business logic.
"""
import logging
import uuid
import io
import struct
from typing import Dict, Any, List, Tuple

from sqlalchemy.ext.asyncio import AsyncSession

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from common.models.page import Page
from common.models.text_region import TextRegion
from ..repository.page_repo import PageRepository

# Supported extensions
SUPPORTED_IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff", ".tif", ".gif"}


class PageService:
    """Page CRUD and management service."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.repo = PageRepository(db)

    async def upload_pages(
        self, chapter_id: str, user_id: str, files_data: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Real page upload with file storage.
        
        Args:
            chapter_id: Target chapter ID
            user_id: Current user ID
            files_data: List of {filename, content (bytes), size (int)}
        """
        from ..service.file_service import FileService

        # Validate chapter exists
        chapter = await self.repo.find_chapter_by_id(chapter_id)
        if not chapter:
            raise ValueError("Chapter not found")

        file_service = FileService()

        # Get starting sort_order
        max_order = await self.repo.get_max_sort_order(chapter_id)

        pages = []
        skipped = 0
        preprocessing_stats = {"deskewed": 0, "cropped": 0, "enhanced": 0}

        for idx, file_data in enumerate(files_data):
            content = file_data.get("content", b"")
            file_name = file_data.get("filename", f"page_{idx + 1:03d}.png")
            file_size = file_data.get("size", len(content))

            if not content:
                skipped += 1
                continue

            # Validate extension
            ext = os.path.splitext(file_name)[1].lower()
            if ext not in SUPPORTED_IMAGE_EXT:
                skipped += 1
                continue

            # Upload to storage via FileService
            try:
                upload_result = await file_service.upload_single_image(
                    content, file_name, file_size, user_id
                )
            except Exception as e:
                # Log and skip failed uploads
                skipped += 1
                continue

            # Estimate image dimensions from binary header
            width, height = self._estimate_image_size(content, ext)

            # Generate and upload thumbnail
            thumbnail_url = upload_result.file_url
            try:
                thumbnail_url = await self._generate_thumbnail(
                    content, file_name, file_size, user_id, file_service
                )
            except Exception:
                pass  # 缩略图生成失败时回退到原图 URL

            # Create Page record
            page = Page(
                page_id=uuid.uuid4(),
                chapter_id=uuid.UUID(chapter_id),
                original_url=upload_result.file_url,
                thumbnail_url=thumbnail_url,
                sort_order=max_order + idx + 1,
                status="pending",
                width=width,
                height=height,
                file_size=file_size,
            )
            self.db.add(page)
            pages.append(page)

        await self.db.flush()

        # After successful upload, dispatch async content safety review for each page
        moderation_task_ids = []
        try:
            from common.tasks.moderation_tasks import moderate_uploaded_content
            for p in pages:
                task = moderate_uploaded_content.delay(
                    page_id=str(p.page_id),
                    user_id=user_id,
                )
                moderation_task_ids.append({"page_id": str(p.page_id), "task_id": task.id})
        except Exception:
            # Graceful degradation: don't block upload if moderation dispatch fails
            moderation_task_ids = []

        return {
            "pages": [
                {
                    "page_id": str(p.page_id),
                    "chapter_id": str(p.chapter_id),
                    "original_url": p.original_url,
                    "thumbnail_url": p.thumbnail_url,
                    "sort_order": p.sort_order,
                    "status": p.status,
                    "width": p.width,
                    "height": p.height,
                    "file_size": p.file_size,
                    "content_review_status": "pending",  # async review in progress
                }
                for p in pages
            ],
            "total_uploaded": len(pages),
            "skipped": skipped,
            "preprocessing": preprocessing_stats,
            "content_review": {"tasks": moderation_task_ids},
        }

    @staticmethod
    async def _generate_thumbnail(
        image_bytes: bytes,
        file_name: str,
        file_size: int,
        user_id: str,
        file_service: "FileService",
        thumb_width: int = 200,
    ) -> str:
        """使用 PIL 生成缩略图并上传到存储"""
        from PIL import Image
        import io as io_module

        img = Image.open(io_module.BytesIO(image_bytes)).convert("RGB")
        w, h = img.size
        if w > thumb_width:
            ratio = thumb_width / w
            new_h = int(h * ratio)
            img = img.resize((thumb_width, new_h), Image.LANCZOS)
        elif w <= thumb_width:
            # 原图已经很小，不再缩小
            pass

        thumb_buffer = io_module.BytesIO()
        img.save(thumb_buffer, format="JPEG", quality=75)
        thumb_bytes = thumb_buffer.getvalue()

        thumb_name = f"thumb_{file_name}"
        if not thumb_name.lower().endswith((".jpg", ".jpeg")):
            thumb_name = f"thumb_{os.path.splitext(file_name)[0]}.jpg"

        thumb_result = await file_service.upload_single_image(
            thumb_bytes, thumb_name, len(thumb_bytes), user_id
        )
        return thumb_result.file_url

    @staticmethod
    def _estimate_image_size(image_bytes: bytes, ext: str) -> Tuple[int, int]:
        """Estimate image width and height from binary header (zero-dep)."""
        try:
            import struct
            if ext in (".png",):
                if len(image_bytes) >= 24 and image_bytes[:8] == b"\x89PNG\r\n\x1a\n":
                    w, h = struct.unpack(">II", image_bytes[16:24])
                    return (w, h)
            elif ext in (".jpg", ".jpeg"):
                data = image_bytes
                idx = 2
                while idx < len(data) - 9:
                    if data[idx] != 0xFF:
                        break
                    marker = data[idx + 1]
                    if marker in (0xC0, 0xC1, 0xC2):
                        h, w = struct.unpack(">HH", data[idx + 5:idx + 9])
                        return (w, h)
                    length = struct.unpack(">H", data[idx + 2:idx + 4])[0]
                    idx += 2 + length
            elif ext == ".gif":
                if len(image_bytes) >= 10:
                    w, h = struct.unpack("<HH", image_bytes[6:10])
                    return (w, h)
            elif ext == ".webp":
                if len(image_bytes) >= 30 and image_bytes[:4] == b"RIFF":
                    chunk_header = image_bytes[12:16]
                    if chunk_header == b"VP8 " and len(image_bytes) >= 28:
                        w = struct.unpack("<H", image_bytes[24:26])[0] & 0x3FFF
                        h = struct.unpack("<H", image_bytes[26:28])[0] & 0x3FFF
                        return (w, h)
                    elif chunk_header == b"VP8L" and len(image_bytes) >= 25:
                        bits = struct.unpack("<I", image_bytes[21:25])[0]
                        w = (bits & 0x3FFF) + 1
                        h = ((bits >> 14) & 0x3FFF) + 1
                        return (w, h)
            elif ext in (".bmp",):
                if len(image_bytes) >= 26:
                    w, h = struct.unpack("<ii", image_bytes[18:26])
                    if w > 0 and h > 0:
                        return (w, abs(h))
            elif ext in (".tiff", ".tif"):
                if len(image_bytes) >= 8:
                    le = image_bytes[:2] == b"II"
                    if not le:
                        w = struct.unpack(">H", image_bytes[18:20])[0]
                        h = struct.unpack(">H", image_bytes[22:24])[0]
                    else:
                        w = struct.unpack("<H", image_bytes[18:20])[0]
                        h = struct.unpack("<H", image_bytes[22:24])[0]
                    if w > 0 and h > 0:
                        return (w, h)
        except Exception:
            pass
        return (0, 0)

    async def list_pages(
        self,
        chapter_id: str,
        page: int = 1,
        page_size: int = 50,
        status: str = None,
    ) -> Tuple[List[Dict[str, Any]], int]:
        """List pages in a chapter."""
        pages, total = await self.repo.list_pages(
            chapter_id=chapter_id,
            page=page,
            page_size=page_size,
            status=status,
        )

        items = []
        for p in pages:
            items.append({
                "page_id": str(p.page_id),
                "original_url": p.original_url,
                "thumbnail_url": p.thumbnail_url,
                "sort_order": p.sort_order,
                "status": p.status,
                "width": p.width,
                "height": p.height,
                "region_count": 0,
            })

        return items, total

    async def get_page_detail(self, page_id: str) -> Dict[str, Any]:
        """Get page detail with text regions."""
        page = await self.repo.find_by_id(page_id)
        if not page:
            raise ValueError("Page not found")

        chapter = await self.repo.find_chapter_by_id(str(page.chapter_id))
        project_id = str(chapter.project_id) if chapter else None

        # Get regions
        regions_result = await self.repo.get_regions_by_page(page_id)
        regions = []
        for r in regions_result:
            # 提取 char_confidences（存储在 style_config._char_confidences 中）
            raw_style = dict(r.style_config or {}) if isinstance(r.style_config, dict) else {}
            char_cc = raw_style.pop("_char_confidences", []) if isinstance(raw_style, dict) else []
            
            regions.append({
                "region_id": str(r.region_id),
                "type": r.type,
                "boundary": r.boundary,
                "boundary_mode": getattr(r, "boundary_mode", None) or "rect",
                "original_text": r.original_text,
                "translated_text": r.translated_text,
                "confidence": r.confidence,
                "char_confidences": [float(c) for c in char_cc] if char_cc else [],  # 三级优化：暴露到顶层
                "is_locked": r.is_locked,
                "style_config": raw_style,
                "sort_order": r.sort_order,
            })

        return {
            "page_id": str(page.page_id),
            "chapter_id": str(page.chapter_id),
            "project_id": project_id,
            "original_url": page.original_url,
            "processed_url": page.processed_url,
            "thumbnail_url": page.thumbnail_url,
            "sort_order": page.sort_order,
            "status": page.status,
            "width": page.width,
            "height": page.height,
            "file_size": page.file_size,
            "preprocessing_result": page.preprocessing_result,
            "regions": regions,
        }

    async def update_regions(self, page_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Update text regions on a page (batch create/update/delete)."""
        regions_data = data.get("regions", [])
        deleted_ids = data.get("deleted_regions", [])

        # Delete specified regions
        for rid in deleted_ids:
            region = await self.repo.find_region_by_id(rid)
            if region:
                await self.db.delete(region)

        # Update/create regions
        for region_data in regions_data:
            rid = region_data.get("region_id")
            if rid:
                region = await self.repo.find_region_by_id(rid)
                if region:
                    if "type" in region_data:
                        region.type = region_data["type"]
                    if "boundary" in region_data:
                        region.boundary = region_data["boundary"]
                    if "boundary_mode" in region_data:
                        region.boundary_mode = region_data["boundary_mode"]
                    if "is_locked" in region_data:
                        region.is_locked = region_data["is_locked"]
                    if "sort_order" in region_data:
                        region.sort_order = region_data["sort_order"]
            else:
                region = TextRegion(
                    region_id=uuid.uuid4(),
                    page_id=page_id,
                    type=region_data.get("type", "speech"),
                    boundary=region_data.get("boundary", {}),
                    boundary_mode=region_data.get("boundary_mode", "rect"),
                    is_locked=region_data.get("is_locked", False),
                    sort_order=region_data.get("sort_order", 1),
                )
                self.db.add(region)

        await self.db.flush()

        # Return updated regions
        regions_result = await self.repo.get_regions_by_page(page_id)
        regions = []
        for r in regions_result:
            regions.append({
                "region_id": str(r.region_id),
                "type": r.type,
                "boundary": r.boundary,
                "boundary_mode": getattr(r, "boundary_mode", None) or "rect",
                "is_locked": r.is_locked,
                "sort_order": r.sort_order,
            })

        return {"regions": regions}

    async def delete_page(self, page_id: str) -> None:
        """Delete a page and its regions."""
        page = await self.repo.find_by_id(page_id)
        if not page:
            raise ValueError("Page not found")
        # Delete associated regions first
        regions = await self.repo.get_regions_by_page(page_id)
        for r in regions:
            await self.db.delete(r)
        await self.db.delete(page)
        await self.db.flush()

    async def update_page(self, page_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Update page fields (sort_order, status, etc.)."""
        page = await self.repo.find_by_id(page_id)
        if not page:
            raise ValueError("Page not found")
        if "sort_order" in data:
            page.sort_order = data["sort_order"]
        if "status" in data:
            page.status = data["status"]
        await self.db.flush()
        return {
            "page_id": str(page.page_id),
            "sort_order": page.sort_order,
            "status": page.status,
        }

    async def bulk_update_sort(self, chapter_id: str, page_ids: List[str]) -> Dict[str, Any]:
        """
        Bulk update page sort orders.
        Each page in page_ids gets sort_order = its index in the list (0-based).
        """
        from sqlalchemy import select, update as sa_update

        # Verify all pages belong to the given chapter
        result = await self.db.execute(
            select(Page).where(
                Page.chapter_id == uuid.UUID(chapter_id),
                Page.page_id.in_([uuid.UUID(pid) for pid in page_ids]),
            )
        )
        existing_pages = {str(p.page_id): p for p in result.scalars().all()}

        updated_count = 0
        for idx, pid in enumerate(page_ids):
            page = existing_pages.get(pid)
            if page:
                page.sort_order = idx
                updated_count += 1

        await self.db.flush()
        return {"chapter_id": chapter_id, "updated_count": updated_count, "page_ids": page_ids}

    async def upload_archive(
        self,
        chapter_id: str,
        user_id: str,
        file_content: bytes,
        file_name: str,
        file_size: int,
    ) -> Dict[str, Any]:
        """
        上传压缩包/PDF 并自动拆分为独立页面。
        支持 ZIP/CBZ/RAR/CBR/7Z/CB7/PDF 格式。
        """
        from ..service.file_service import FileService

        # Validate chapter exists
        chapter = await self.repo.find_chapter_by_id(chapter_id)
        if not chapter:
            raise ValueError("Chapter not found")

        file_service = FileService()

        # Parse archive
        ext = os.path.splitext(file_name)[1].lower()
        logger = logging.getLogger(__name__)
        logger.info(f"upload_archive: chapter={chapter_id}, file={file_name}, size={file_size}, ext={ext}")
        upload_result = await file_service.upload_and_parse_archive(
            file_content, file_name, file_size, user_id
        )

        pages_info = upload_result.pages or []
        logger.info(f"upload_archive: parsed {len(pages_info)} pages, is_pdf={ext == '.pdf'}")
        if not pages_info:
            raise ValueError("No valid image pages found in archive")

        # Get starting sort_order
        max_order = await self.repo.get_max_sort_order(chapter_id)

        is_pdf = ext == ".pdf"
        source_pdf_path = upload_result.source_archive_path

        # 确保永久存储目录存在
        originals_dir = os.path.join(file_service.storage_path, user_id, "originals")
        os.makedirs(originals_dir, exist_ok=True)

        pages_created = []
        for idx, page_info in enumerate(pages_info):
            page_id = uuid.uuid4()

            if is_pdf:
                # PRD §2.1.1: PDF 自动逐页拆分为独立页面
                # 渲染 PDF 页面为 PNG 并存为真实文件，确保 original_url 为直接可读的图片路径
                rendered_stored_name = f"pdf_{uuid.uuid4().hex}.png"
                rendered_path = os.path.join(originals_dir, rendered_stored_name)
                try:
                    png_bytes, rw, rh = file_service.render_single_pdf_page(
                        source_pdf_path, idx, user_id, zoom=2.0
                    )
                    with open(rendered_path, "wb") as f:
                        f.write(png_bytes)
                    original_url = f"/storage/{user_id}/originals/{rendered_stored_name}"
                    page_info.width = rw
                    page_info.height = rh
                    page_info.file_size = len(png_bytes)
                    logger.debug(f"upload_archive: PDF page {idx} rendered to {rendered_stored_name} ({rw}x{rh}, {len(png_bytes)} bytes)")
                except Exception as e:
                    logger.warning(f"upload_archive: PDF page {idx} render failed, using placeholder: {e}")
                    original_url = f"/api/v1/pages/{page_id}/image"

                preprocessing_result = {
                    "source_pdf": source_pdf_path,
                    "pdf_page_index": idx,
                }

                # 为 PDF 页面生成真实缩略图
                thumbnail_url = original_url  # 默认回退到原图
                try:
                    thumb_bytes, tw, th = file_service.render_pdf_page_thumbnail(
                        source_pdf_path, idx, user_id, thumb_width=200
                    )
                    thumb_stored_name = f"thumb_{uuid.uuid4().hex}.jpg"
                    thumb_path = os.path.join(originals_dir, thumb_stored_name)
                    with open(thumb_path, "wb") as f:
                        f.write(thumb_bytes)
                    thumbnail_url = f"/storage/{user_id}/originals/{thumb_stored_name}"
                    logger.debug(f"upload_archive: PDF thumb generated for page {idx}, size={len(thumb_bytes)}")
                except Exception as e:
                    logger.warning(f"upload_archive: PDF thumb generation skipped for page {idx}: {e}")
            else:
                # Archive (ZIP/RAR/7Z): original_url → 解压出的图片
                original_url = f"/storage/{user_id}/originals/{page_info.file_name}"
                preprocessing_result = None

                # 为非 PDF 页面生成缩略图
                thumbnail_url = original_url  # 默认回退
                original_path = os.path.join(originals_dir, page_info.file_name)
                try:
                    if os.path.isfile(original_path):
                        with open(original_path, "rb") as f:
                            img_bytes = f.read()
                        thumbnail_url = await self._generate_thumbnail(
                            img_bytes, page_info.file_name, len(img_bytes),
                            user_id, file_service
                        )
                        logger.debug(f"upload_archive: thumb generated for archive page {idx}")
                    else:
                        # 如果图片文件已被移动或不存在
                        if page_info.thumbnail_file_name and os.path.isfile(
                            os.path.join(originals_dir, page_info.thumbnail_file_name)
                        ):
                            thumbnail_url = f"/storage/{user_id}/originals/{page_info.thumbnail_file_name}"
                except Exception as e:
                    logger.warning(f"upload_archive: thumb generation skipped for page {idx}: {e}")

            page = Page(
                page_id=page_id,
                chapter_id=uuid.UUID(chapter_id),
                original_url=original_url,
                thumbnail_url=thumbnail_url,
                sort_order=max_order + idx + 1,
                status="pending",
                width=page_info.width,
                height=page_info.height,
                file_size=page_info.file_size,
                preprocessing_result=preprocessing_result,
            )
            self.db.add(page)
            pages_created.append(page)

        await self.db.flush()
        logger.info(f"upload_archive: {len(pages_created)} pages flushed to DB, awaiting commit")

        await self.db.commit()
        logger.info(f"upload_archive: transaction committed — {len(pages_created)} pages persisted")

        return {
            "pages": [
                {
                    "page_id": str(p.page_id),
                    "chapter_id": str(p.chapter_id),
                    "original_url": p.original_url,
                    "thumbnail_url": p.thumbnail_url,
                    "sort_order": p.sort_order,
                    "status": p.status,
                    "width": p.width,
                    "height": p.height,
                }
                for p in pages_created
            ],
            "total_uploaded": len(pages_created),
            "archive_format": ext,
            "source_file": file_name,
        }
