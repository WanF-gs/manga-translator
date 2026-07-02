from __future__ import annotations
"""导出服务 - 真实实现

单页导出(JPG/PNG/WebP)、批量导出(CBZ/PDF/ZIP打包)、双语对照合成
"""
import uuid
import io
import os
import zipfile
import logging
from datetime import datetime, timezone
from typing import Optional, List, Tuple, Dict, Any

import httpx
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))

from common.core.config import settings
from common.models.page import Page
from common.models.chapter import Chapter
from common.models.project import Project
from common.models.export_task import ExportTask

logger = logging.getLogger(__name__)

# 格式参数
IMG_FORMAT_PARAMS = {
    "png": {"format": "PNG", "ext": "png"},
    "jpg": {"format": "JPEG", "ext": "jpg"},
    "jpeg": {"format": "JPEG", "ext": "jpg"},
    "webp": {"format": "WEBP", "ext": "webp"},
}


async def _download_image(url: str) -> Optional[bytes]:
    """下载图片 — P0 FIX: 自动补全相对路径为完整 URL"""
    # 相对路径补全：/uploads/... 或 /storage/... → http://localhost:8080/...
    if url and url.startswith("/"):
        base = os.getenv("STORAGE_BASE_URL", "http://localhost:8080")
        url = base.rstrip("/") + url
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            return resp.content
    except Exception as e:
        logger.warning(f"Failed to download {url}: {e}")
        return None


def _save_image(img: Image.Image, format: str, quality: int) -> bytes:
    """将 PIL Image 保存为指定格式的字节"""
    buf = io.BytesIO()
    fmt_key = format.lower()
    fmt_params = IMG_FORMAT_PARAMS.get(fmt_key, {"format": "PNG", "ext": "png"})
    save_kwargs = {"format": fmt_params["format"]}
    if fmt_params["format"] in ("JPEG", "WEBP"):
        save_kwargs["quality"] = quality
        save_kwargs["optimize"] = True
    img.convert("RGB").save(buf, **save_kwargs)
    buf.seek(0)
    return buf.getvalue()


def _write_local_fallback(data: bytes, bucket: str, object_name: str) -> str:
    """MinIO 不可用时，写入 project-service 共享的本地存储卷。

    project-service 的 /storage/{path} 端点从 {UPLOAD_DIR}/uploads/{path} 读取，
    并在磁盘未命中时回落到 MinIO。export-service 与 project-service 共享
    project_uploads 卷（挂载于 /tmp/manga-storage），因此写到这里即可被下载。
    返回与 MinIO 成功路径完全一致的 /storage/{bucket}/{object_name}，保证路径统一。
    """
    upload_dir = getattr(settings, "UPLOAD_DIR", "/tmp/manga-storage")
    full_path = os.path.join(upload_dir, "uploads", bucket, *object_name.split("/"))
    os.makedirs(os.path.dirname(full_path), exist_ok=True)
    with open(full_path, "wb") as f:
        f.write(data)
    return f"/storage/{bucket}/{object_name}"


def _upload_to_minio(data: bytes, object_name: str, content_type: str = "application/octet-stream") -> str:
    """持久化导出产物并返回可下载的 /storage URL。

    主路径：上传到 MinIO（与 project-service 共享的对象存储）。
    兜底：MinIO 不可用时写入共享磁盘卷。两条路径都返回相同的
    /storage/{bucket}/{object_name}，避免此前 /uploads/exports/... 幽灵 URL
    （既没落盘、又被网关路由到未持有该文件的 image-service）导致的下载 404。
    """
    bucket = settings.MINIO_BUCKET
    try:
        from common.core.minio import minio_client
        # 桶不存在时 put_object 会失败，导出前确保其存在
        try:
            if not minio_client.bucket_exists(bucket):
                minio_client.make_bucket(bucket)
        except Exception as e:
            logger.debug(f"bucket_exists/make_bucket check skipped: {e}")
        minio_client.put_object(
            bucket_name=bucket,
            object_name=object_name,
            data=io.BytesIO(data),
            length=len(data),
            content_type=content_type,
        )
        return f"/storage/{bucket}/{object_name}"
    except Exception as e:
        logger.warning(f"MinIO upload failed, falling back to local disk: {e}")
        try:
            return _write_local_fallback(data, bucket, object_name)
        except Exception as disk_err:
            # 两条持久化路径都失败 → 显式抛错，让任务被诚实标记为 failed，
            # 而不是返回一个指向不存在文件的“成功”URL
            logger.error(f"Local fallback write also failed: {disk_err}")
            raise RuntimeError(
                f"导出产物持久化失败：MinIO 与本地磁盘均不可用 ({e}; {disk_err})"
            ) from disk_err


def _resolve_naming_rule(rule: str, project_name: str, chapter_name: str, page_num: int) -> str:
    """解析自定义命名规则
    支持变量: ${project}, ${chapter}, ${page}
    示例: "${project}_${chapter}_${page}" -> "MyManga_Ch01_001"
    """
    result = rule.replace("${project}", project_name or "project")
    result = result.replace("${chapter}", chapter_name or "chapter")
    result = result.replace("${page}", f"{page_num:03d}")
    return result


async def _push_export_progress(task_id: str, user_id: str, progress: float, status: str,
                                  extra: Optional[Dict[str, Any]] = None):
    """通过 Redis 推送导出进度（供 WebSocket 消费）"""
    try:
        import json
        from common.core.redis import redis_client
        payload = {
            "task_id": task_id,
            "user_id": user_id,
            "progress": progress,
            "status": status,
            **(extra or {}),
        }
        payload_str = json.dumps(payload)
        await redis_client.setex(
            f"export:{task_id}:progress",
            3600,
            payload_str,
        )
        # 同时发布到频道供 WebSocket 推送给客户端
        await redis_client.publish(
            f"export_progress:{user_id}",
            payload_str,
        )
    except Exception as e:
        logger.debug(f"Failed to push progress: {e}")


class ExportService:
    """导出业务服务"""

    def __init__(self, repo, db: AsyncSession):
        self.repo = repo
        self.db = db

    async def export_single(
        self,
        user_id: str,
        page_id: str,
        format: str,
        quality: int,
        include_original: bool,
        include_detected: bool,
        bilingual: bool,
    ) -> dict:
        """导出单页"""
        task_id = str(uuid.uuid4())
        format = format.lower()
        if format not in ("png", "jpg", "jpeg", "webp"):
            format = "png"

        ext = format
        filename = f"page_{page_id[:8]}.{ext}"

        # 查询页面
        result = await self.db.execute(
            select(Page).where(Page.page_id == page_id)
        )
        page = result.scalar_one_or_none()
        if not page:
            return {"task_id": task_id, "status": "failed", "error": "Page not found"}

        # 获取要导出的图片
        image_url = page.processed_url or page.original_url
        img_data = await _download_image(image_url)
        if not img_data:
            return {"task_id": task_id, "status": "failed", "error": "Cannot download image"}

        # 格式转换
        img = Image.open(io.BytesIO(img_data))
        output_data = _save_image(img, format, quality)
        file_size = f"{len(output_data) / (1024 * 1024):.1f}MB"

        # 上传
        object_name = f"exports/{user_id}/{task_id}/{filename}"
        download_url = _upload_to_minio(output_data, object_name, f"image/{format}")

        # P0 FIX: 通过 page → chapter → project 链正确获取 project_id
        # 原来的代码错误地把 page.chapter_id (章节UUID) 当作 project_id 写入
        chapter_result = await self.db.execute(
            select(Chapter).where(Chapter.chapter_id == page.chapter_id)
        )
        chapter = chapter_result.scalar_one_or_none()
        real_project_id = chapter.project_id if chapter else page.chapter_id

        # 创建导出任务记录
        export_task = ExportTask(
            user_id=uuid.UUID(user_id),
            project_id=real_project_id,  # ✅ 正确的 project_id
            chapter_ids=[str(page.chapter_id)],
            format=format,
            quality=quality,
            status="completed",
            progress=1.0,
            result_url=download_url,
            completed_at=datetime.now(timezone.utc),
        )
        self.db.add(export_task)
        await self.db.commit()

        return {
            "task_id": str(export_task.task_id),
            "status": "completed",
            "download_url": download_url,
            "pages_exported": 1,
            "file_size": file_size,
            "format": format,
            "quality": quality,
            "bilingual": bilingual,
        }

    async def export_chapter(
        self,
        user_id: str,
        chapter_id: str,
        format: str,
        quality: int,
        archive_format: str = None,
        bilingual: bool = False,
        bilingual_mode: str = "side-by-side",
        page_range: str = None,
        naming_rule: str = "${page}",
    ) -> dict:
        """导出章节（打包为 CBZ/PDF/ZIP），支持自定义命名和双语"""
        task_id = str(uuid.uuid4())
        format = format.lower()
        archive_format = (archive_format or "cbz").lower()

        # 查询章节信息
        chapter_result = await self.db.execute(
            select(Chapter).where(Chapter.chapter_id == uuid.UUID(chapter_id))
        )
        chapter = chapter_result.scalar_one_or_none()
        if not chapter:
            return {"task_id": task_id, "status": "failed", "error": "Chapter not found"}

        chapter_name = chapter.name or f"Ch{chapter.sort_order:02d}"

        # 查询所属项目名称
        proj_result = await self.db.execute(
            select(Project).where(Project.project_id == chapter.project_id)
        )
        project = proj_result.scalar_one_or_none()
        project_name = project.name if project else "project"

        # 查询章节的页面
        query = select(Page).where(
            Page.chapter_id == uuid.UUID(chapter_id)
        ).order_by(Page.sort_order.asc())

        if page_range:
            try:
                parts = page_range.split("-")
                if len(parts) == 2:
                    start, end = int(parts[0]) - 1, int(parts[1])
                    query = query.offset(start).limit(end - start)
                else:
                    indices = [int(p.strip()) - 1 for p in page_range.split(",")]
                    query = query.offset(min(indices)).limit(max(indices) - min(indices) + 1)
            except (ValueError, IndexError):
                pass

        result = await self.db.execute(query)
        pages = list(result.scalars().all())
        if not pages:
            return {"task_id": task_id, "status": "failed", "error": "No pages found"}

        # 下载所有页面图片，支持双语对照合成
        page_images = []
        for idx, p in enumerate(pages):
            url = p.processed_url or p.original_url

            if bilingual and p.original_url and p.processed_url:
                # 双语对照合成
                try:
                    from .bilingual_composer import BilingualComposer
                    composer = BilingualComposer()
                    bilingual_data = await composer.compose(
                        mode=bilingual_mode,
                        original_url=p.original_url,
                        translated_url=p.processed_url,
                    )
                    if bilingual_data:
                        img = Image.open(io.BytesIO(bilingual_data))
                        output_bytes = _save_image(img, format, quality)
                        page_num = p.sort_order if p.sort_order else idx + 1
                        filename_in_archive = _resolve_naming_rule(
                            naming_rule, project_name, chapter_name, page_num
                        )
                        page_images.append((filename_in_archive, output_bytes, format))
                        continue
                except Exception as e:
                    logger.warning(f"Bilingual compose failed for page {p.page_id}: {e}")

            img_data = await _download_image(url)
            if img_data:
                img = Image.open(io.BytesIO(img_data))
                output_bytes = _save_image(img, format, quality)
                page_num = p.sort_order if p.sort_order else idx + 1
                filename_in_archive = _resolve_naming_rule(
                    naming_rule, project_name, chapter_name, page_num
                )
                page_images.append((filename_in_archive, output_bytes, format))

        if not page_images:
            return {"task_id": task_id, "status": "failed", "error": "Cannot download pages"}

        # 打包 - 使用 rich exporters
        metadata = {
            "title": str(project_name),
            "series": str(project_name),
            "chapter_name": chapter_name,
            "chapter_number": str(chapter.sort_order),
            "translator": "Manga Translator AI",
            "language": "zh",
            "page_count": len(page_images),
        }

        if archive_format == "cbz":
            archive_data = _create_cbz_rich(page_images, chapter_name, metadata)
            content_type = "application/vnd.comicbook+zip"
        elif archive_format == "zip":
            archive_data = _create_zip(page_images, chapter_name)
            content_type = "application/zip"
        elif archive_format == "pdf":
            archive_data = _create_pdf_rich(page_images, chapter_name, metadata)
            content_type = "application/pdf"
        else:
            archive_data = _create_cbz_rich(page_images, chapter_name, metadata)
            content_type = "application/vnd.comicbook+zip"

        ext = archive_format
        safe_name = project_name.replace(" ", "_")[:20] if project_name else "export"
        filename = f"{safe_name}_{chapter_name[:20]}.{ext}"

        object_name = f"exports/{user_id}/{task_id}/{filename}"
        download_url = _upload_to_minio(archive_data, object_name, content_type)

        file_size = f"{len(archive_data) / (1024 * 1024):.1f}MB"

        export_task = ExportTask(
            user_id=uuid.UUID(user_id),
            project_id=chapter.project_id,
            chapter_ids=[chapter_id],
            format=f"{format}:{archive_format}",
            quality=quality,
            status="completed",
            progress=1.0,
            result_url=download_url,
            completed_at=datetime.now(timezone.utc),
        )
        self.db.add(export_task)
        await self.db.commit()

        return {
            "task_id": str(export_task.task_id),
            "status": "completed",
            "download_url": download_url,
            "pages_exported": len(pages),
            "file_size": file_size,
            "format": format,
            "archive_format": archive_format,
            "bilingual": bilingual,
            "bilingual_mode": bilingual_mode if bilingual else None,
            "naming_rule": naming_rule,
        }

    async def export_project(
        self,
        user_id: str,
        project_id: str,
        format: str,
        quality: int,
        archive_format: str = None,
        bilingual: bool = False,
        bilingual_mode: str = "side-by-side",
        include_chapters: List[str] = None,
        naming_rule: str = "${chapter}/${page}",
        per_chapter_cbz: bool = False,
    ) -> dict:
        """导出整个项目

        Args:
            per_chapter_cbz: 如果 True 且 archive_format=cbz，则每个章节单独打包为一个 CBZ，
                            最后合并为一个 ZIP（单行本包）
        """
        format = format.lower()
        archive_format = (archive_format or "zip").lower()

        # 查询项目信息
        proj_result = await self.db.execute(
            select(Project).where(Project.project_id == uuid.UUID(project_id))
        )
        project = proj_result.scalar_one_or_none()
        project_name = project.name if project else "project"

        # 查询章节
        chapter_query = select(Chapter).where(Chapter.project_id == uuid.UUID(project_id))
        if include_chapters:
            chapter_query = chapter_query.where(Chapter.chapter_id.in_(
                [uuid.UUID(c) for c in include_chapters]
            ))
        chapter_query = chapter_query.order_by(Chapter.sort_order.asc())

        chapters_result = await self.db.execute(chapter_query)
        chapters = list(chapters_result.scalars().all())

        if not chapters:
            return {"status": "failed", "error": "No chapters found"}

        # 如果需要按章节分包 CBZ
        if per_chapter_cbz and archive_format == "cbz":
            return await self._export_per_chapter_cbz(
                user_id, project_id, project_name, format, quality,
                bilingual, bilingual_mode, chapters, naming_rule
            )

        # 收集所有页面
        all_page_images = []
        total_pages = 0
        for ch in chapters:
            ch_name = ch.name or f"Ch{ch.sort_order:02d}"
            pages_result = await self.db.execute(
                select(Page).where(Page.chapter_id == ch.chapter_id)
                .order_by(Page.sort_order.asc())
            )
            pages = list(pages_result.scalars().all())
            for idx, p in enumerate(pages):
                url = p.processed_url or p.original_url

                if bilingual and p.original_url and p.processed_url:
                    try:
                        from .bilingual_composer import BilingualComposer
                        composer = BilingualComposer()
                        bilingual_data = await composer.compose(
                            mode=bilingual_mode,
                            original_url=p.original_url,
                            translated_url=p.processed_url,
                        )
                        if bilingual_data:
                            img = Image.open(io.BytesIO(bilingual_data))
                            output_bytes = _save_image(img, format, quality)
                            page_num = p.sort_order if p.sort_order else idx + 1
                            fname = _resolve_naming_rule(
                                naming_rule, project_name, ch_name, page_num
                            )
                            all_page_images.append((fname, output_bytes, format))
                            continue
                    except Exception as e:
                        logger.warning(f"Bilingual compose failed: {e}")

                img_data = await _download_image(url)
                if img_data:
                    img = Image.open(io.BytesIO(img_data))
                    output_bytes = _save_image(img, format, quality)
                    page_num = p.sort_order if p.sort_order else idx + 1
                    fname = _resolve_naming_rule(
                        naming_rule, project_name, ch_name, page_num
                    )
                    all_page_images.append((fname, output_bytes, format))
            total_pages += len(pages)

        if not all_page_images:
            return {"status": "failed", "error": "No pages could be downloaded"}

        # 打包
        metadata = {
            "title": str(project_name),
            "series": str(project_name),
            "author": "Manga Translator",
            "description": f"Export of {project_name}",
            "chapter_count": len(chapters),
            "page_count": total_pages,
        }

        if archive_format == "cbz":
            archive_data = _create_cbz_rich(all_page_images, project_name, metadata)
        elif archive_format == "pdf":
            archive_data = _create_pdf_rich(all_page_images, project_name, metadata)
        else:
            archive_data = _create_zip(all_page_images, project_name)

        task_id = str(uuid.uuid4())
        ext = archive_format
        safe_name = project_name.replace(" ", "_")[:40] if project_name else "export"
        filename = f"{safe_name}.{ext}"
        object_name = f"exports/{user_id}/{task_id}/{filename}"
        content_type = "application/zip" if archive_format in ("zip", "cbz") else "application/pdf"
        download_url = _upload_to_minio(archive_data, object_name, content_type)

        file_size = f"{len(archive_data) / (1024 * 1024):.1f}MB"

        export_task = ExportTask(
            user_id=uuid.UUID(user_id),
            project_id=uuid.UUID(project_id),
            chapter_ids=[str(ch.chapter_id) for ch in chapters],
            format=f"{format}:{archive_format}",
            quality=quality,
            status="completed",
            progress=1.0,
            result_url=download_url,
            completed_at=datetime.now(timezone.utc),
        )
        self.db.add(export_task)
        await self.db.commit()

        return {
            "task_id": str(export_task.task_id),
            "status": "completed",
            "download_url": download_url,
            "pages_exported": total_pages,
            "chapters_exported": len(chapters),
            "file_size": file_size,
            "format": format,
            "archive_format": archive_format,
            "bilingual": bilingual,
            "bilingual_mode": bilingual_mode if bilingual else None,
            "naming_rule": naming_rule,
        }

    async def _export_per_chapter_cbz(
        self, user_id: str, project_id: str, project_name: str,
        format: str, quality: int, bilingual: bool, bilingual_mode: str,
        chapters: list, naming_rule: str,
    ) -> dict:
        """每个章节单独打包CBZ，最终合并为一个ZIP"""
        import tempfile
        import shutil

        task_id = str(uuid.uuid4())
        tmp_dir = tempfile.mkdtemp()
        total_pages = 0
        chapter_cbz_files = []

        for ch in chapters:
            ch_name = ch.name or f"Ch{ch.sort_order:02d}"
            pages_result = await self.db.execute(
                select(Page).where(Page.chapter_id == ch.chapter_id)
                .order_by(Page.sort_order.asc())
            )
            pages = list(pages_result.scalars().all())
            ch_images = []

            for idx, p in enumerate(pages):
                url = p.processed_url or p.original_url
                page_num = p.sort_order if p.sort_order else idx + 1

                if bilingual and p.original_url and p.processed_url:
                    try:
                        from .bilingual_composer import BilingualComposer
                        composer = BilingualComposer()
                        bilingual_data = await composer.compose(
                            mode=bilingual_mode,
                            original_url=p.original_url,
                            translated_url=p.processed_url,
                        )
                        if bilingual_data:
                            img = Image.open(io.BytesIO(bilingual_data))
                            output_bytes = _save_image(img, format, quality)
                            fname = _resolve_naming_rule(naming_rule, project_name, ch_name, page_num)
                            ch_images.append((fname, output_bytes, format))
                            continue
                    except Exception:
                        pass

                img_data = await _download_image(url)
                if img_data:
                    img = Image.open(io.BytesIO(img_data))
                    output_bytes = _save_image(img, format, quality)
                    fname = _resolve_naming_rule(naming_rule, project_name, ch_name, page_num)
                    ch_images.append((fname, output_bytes, format))

            if ch_images:
                metadata = {
                    "title": str(project_name),
                    "series": str(project_name),
                    "chapter_name": ch_name,
                    "chapter_number": str(ch.sort_order),
                }
                cbz_data = _create_cbz_rich(ch_images, ch_name, metadata)
                cbz_path = os.path.join(tmp_dir, f"{ch_name}.cbz")
                with open(cbz_path, "wb") as f:
                    f.write(cbz_data)
                chapter_cbz_files.append((ch_name, cbz_data))
                total_pages += len(ch_images)

        # 合并所有 CBZ 章节到一个 ZIP
        merged_buf = io.BytesIO()
        with zipfile.ZipFile(merged_buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for ch_name, cbz_data in chapter_cbz_files:
                zf.writestr(f"{ch_name}.cbz", cbz_data)

            # 添加 README
            readme = f"Project: {project_name}\nChapters: {len(chapters)}\nTotal Pages: {total_pages}\n"
            zf.writestr("README.txt", readme)

        merged_buf.seek(0)
        archive_data = merged_buf.getvalue()

        safe_name = project_name.replace(" ", "_")[:40] if project_name else "export"
        filename = f"{safe_name}_cbz_bundle.zip"
        object_name = f"exports/{user_id}/{task_id}/{filename}"
        download_url = _upload_to_minio(archive_data, object_name, "application/zip")

        file_size = f"{len(archive_data) / (1024 * 1024):.1f}MB"

        export_task = ExportTask(
            user_id=uuid.UUID(user_id),
            project_id=uuid.UUID(project_id),
            chapter_ids=[str(ch.chapter_id) for ch in chapters],
            format=f"{format}:cbz_bundle",
            quality=quality,
            status="completed",
            progress=1.0,
            result_url=download_url,
            completed_at=datetime.now(timezone.utc),
        )
        self.db.add(export_task)
        await self.db.commit()

        shutil.rmtree(tmp_dir, ignore_errors=True)

        return {
            "task_id": str(export_task.task_id),
            "status": "completed",
            "download_url": download_url,
            "pages_exported": total_pages,
            "chapters_exported": len(chapters),
            "file_size": file_size,
            "format": format,
            "archive_format": "cbz_bundle",
            "bilingual": bilingual,
            "per_chapter_cbz": True,
        }

    async def get_export_status(self, task_id: str, user_id: str) -> Optional[dict]:
        """获取导出任务状态"""
        result = await self.db.execute(
            select(ExportTask).where(
                ExportTask.task_id == uuid.UUID(task_id),
                ExportTask.user_id == uuid.UUID(user_id),
            )
        )
        task = result.scalar_one_or_none()
        if not task:
            return None
        return {
            "task_id": str(task.task_id),
            "status": task.status,
            "progress": task.progress,
            "download_url": task.result_url,
            "error_msg": task.error_msg,
            "created_at": task.created_at.isoformat() if task.created_at else None,
            "completed_at": task.completed_at.isoformat() if task.completed_at else None,
        }

    async def get_download_url(self, task_id: str, user_id: str) -> Optional[str]:
        """获取下载链接"""
        result = await self.db.execute(
            select(ExportTask).where(
                ExportTask.task_id == uuid.UUID(task_id),
                ExportTask.user_id == uuid.UUID(user_id),
            )
        )
        task = result.scalar_one_or_none()
        return task.result_url if task else None

    async def list_tasks(
        self, user_id: str, page: int, page_size: int, status: str = None
    ) -> Tuple[List[dict], int]:
        """列出导出任务"""
        query = select(ExportTask).where(ExportTask.user_id == uuid.UUID(user_id))
        count_query = select(ExportTask).where(ExportTask.user_id == uuid.UUID(user_id))

        if status:
            query = query.where(ExportTask.status == status)
            count_query = count_query.where(ExportTask.status == status)

        query = query.order_by(ExportTask.created_at.desc())
        query = query.offset((page - 1) * page_size).limit(page_size)

        from sqlalchemy import func
        result = await self.db.execute(query)
        tasks = list(result.scalars().all())
        count_result = await self.db.execute(
            select(func.count()).select_from(count_query.subquery())
        )
        total = count_result.scalar() or 0

        task_list = []
        for t in tasks:
            task_list.append({
                "task_id": str(t.task_id),
                "type": "project" if len(t.chapter_ids or []) > 1 else ("chapter" if len(t.chapter_ids or []) == 1 else "single"),
                "format": t.format,
                "status": t.status,
                "progress": t.progress,
                "file_size": None,
                "created_at": t.created_at.isoformat() if t.created_at else None,
            })

        return task_list, total

    async def delete_task(self, task_id: str, user_id: str):
        """删除导出任务"""
        await self.repo.delete_task(task_id, user_id)

    async def retry_task(self, task_id: str, user_id: str) -> dict:
        """重试导出任务：根据原任务参数重新执行导出"""
        # 查询原任务
        result = await self.db.execute(
            select(ExportTask).where(
                ExportTask.task_id == uuid.UUID(task_id),
                ExportTask.user_id == uuid.UUID(user_id),
            )
        )
        old_task = result.scalar_one_or_none()
        if not old_task:
            return {"task_id": task_id, "status": "failed", "error": "Task not found"}

        # 解析原任务参数
        fmt_parts = old_task.format.split(":") if old_task.format else ["png"]
        img_format = fmt_parts[0]
        archive_format = fmt_parts[1] if len(fmt_parts) > 1 else None
        quality = old_task.quality or 90

        try:
            if not archive_format:
                # 单页导出：从 chapter_ids[0] 对应的章节中找第一个页面
                chapter_id = old_task.chapter_ids[0] if old_task.chapter_ids else None
                if not chapter_id:
                    return {"task_id": task_id, "status": "failed", "error": "No chapter reference in task"}
                pages_result = await self.db.execute(
                    select(Page).where(Page.chapter_id == uuid.UUID(chapter_id))
                    .order_by(Page.sort_order.asc()).limit(1)
                )
                first_page = pages_result.scalar_one_or_none()
                if not first_page:
                    return {"task_id": task_id, "status": "failed", "error": "No pages found in chapter"}
                return await self.export_single(
                    user_id=user_id,
                    page_id=str(first_page.page_id),
                    format=img_format,
                    quality=quality,
                    include_original=False,
                    include_detected=False,
                    bilingual=False,
                )
            elif len(old_task.chapter_ids or []) == 1:
                # 章节导出
                return await self.export_chapter(
                    user_id=user_id,
                    chapter_id=old_task.chapter_ids[0],
                    format=img_format,
                    quality=quality,
                    archive_format=archive_format,
                    bilingual=False,
                    page_range=None,
                )
            else:
                # 项目导出
                return await self.export_project(
                    user_id=user_id,
                    project_id=str(old_task.project_id) if old_task.project_id else "",
                    format=img_format,
                    quality=quality,
                    archive_format=archive_format,
                    bilingual=False,
                    include_chapters=old_task.chapter_ids,
                )
        except Exception as e:
            logger.exception(f"Retry task {task_id} failed: {e}")
            return {
                "task_id": task_id,
                "status": "failed",
                "error": str(e),
            }


def _create_cbz(page_images: list, name: str) -> bytes:
    """创建 CBZ 文件（即 ZIP 包含图片）"""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for idx, (sort_order, img_data, fmt) in enumerate(page_images):
            ext = fmt if fmt in ("png", "jpg", "jpeg", "webp") else "png"
            if isinstance(sort_order, str):
                filename = f"{sort_order}.{ext}"
            else:
                filename = f"{sort_order:03d}.{ext}"
            zf.writestr(filename, img_data)
    buf.seek(0)
    return buf.getvalue()


def _create_cbz_rich(page_images: list, name: str, metadata: dict = None) -> bytes:
    """创建 CBZ 文件，含 ComicInfo.xml 元数据"""
    import xml.etree.ElementTree as ET
    metadata = metadata or {}

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for idx, (sort_order, img_data, fmt) in enumerate(page_images):
            ext = fmt if fmt in ("png", "jpg", "jpeg", "webp") else "png"
            if isinstance(sort_order, str):
                filename = f"{sort_order}.{ext}"
            else:
                filename = f"{sort_order:03d}.{ext}"
            zf.writestr(filename, img_data)

        # Generate ComicInfo.xml
        root = ET.Element("ComicInfo")
        ET.SubElement(root, "Title").text = str(metadata.get("title", name))
        ET.SubElement(root, "Series").text = str(metadata.get("series", ""))
        ET.SubElement(root, "Number").text = str(metadata.get("chapter_number", ""))
        ET.SubElement(root, "Summary").text = str(metadata.get("summary", ""))
        ET.SubElement(root, "Writer").text = str(metadata.get("author", ""))
        ET.SubElement(root, "Translator").text = str(metadata.get("translator", "Manga Translator AI"))
        ET.SubElement(root, "Genre").text = str(metadata.get("genre", "Manga"))
        ET.SubElement(root, "PageCount").text = str(metadata.get("page_count", len(page_images)))
        ET.SubElement(root, "LanguageISO").text = str(metadata.get("language", "zh"))
        ET.SubElement(root, "Manga").text = "YesAndRightToLeft"
        ET.SubElement(root, "Notes").text = f"Generated by Manga Translator on {datetime.now().strftime('%Y-%m-%d')}"

        comicinfo = ET.tostring(root, encoding="unicode", xml_declaration=True)
        zf.writestr("ComicInfo.xml", comicinfo)

    buf.seek(0)
    return buf.getvalue()


def _create_zip(page_images: list, name: str, prefix: str = "images/") -> bytes:
    """创建 ZIP 文件"""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for idx, (sort_order, img_data, fmt) in enumerate(page_images):
            ext = fmt if fmt in ("png", "jpg", "jpeg", "webp") else "png"
            if isinstance(sort_order, str):
                filename = f"{prefix}{sort_order}.{ext}"
            else:
                filename = f"{prefix}{sort_order:03d}.{ext}"
            zf.writestr(filename, img_data)
    buf.seek(0)
    return buf.getvalue()


def _create_pdf(page_images: list, name: str) -> bytes:
    """创建 PDF 文件（使用 reportlab）"""
    return _create_pdf_rich(page_images, name, {})


def _create_pdf_rich(page_images: list, name: str, metadata: dict = None) -> bytes:
    """创建 PDF 文件（使用 reportlab，自动生成目录结构）"""
    metadata = metadata or {}
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.units import mm
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.colors import HexColor
        from reportlab.lib.enums import TA_CENTER
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak

        buf = io.BytesIO()
        title = metadata.get("title", name)
        author = metadata.get("author", "Manga Translator")

        doc = SimpleDocTemplate(
            buf,
            pagesize=A4,
            topMargin=15 * mm,
            bottomMargin=15 * mm,
            leftMargin=12 * mm,
            rightMargin=12 * mm,
            title=title,
            author=author,
        )

        cover_style = ParagraphStyle(
            "CoverTitle",
            parent=getSampleStyleSheet()["Title"],
            fontSize=24,
            leading=30,
            alignment=TA_CENTER,
            textColor=HexColor("#2c3e50"),
        )
        sub_style = ParagraphStyle(
            "Subtitle",
            parent=getSampleStyleSheet()["Normal"],
            fontSize=14,
            leading=20,
            alignment=TA_CENTER,
            textColor=HexColor("#7f8c8d"),
        )

        story = []

        # Cover page
        story.append(Spacer(1, 80 * mm))
        story.append(Paragraph(title, cover_style))
        story.append(Spacer(1, 10 * mm))
        if metadata.get("chapter_name"):
            story.append(Paragraph(f"章节: {metadata['chapter_name']}", sub_style))
        story.append(Spacer(1, 5 * mm))
        story.append(Paragraph(f"导出日期: {datetime.now().strftime('%Y-%m-%d %H:%M')}", sub_style))
        story.append(Spacer(1, 5 * mm))
        story.append(Paragraph(f"共 {len(page_images)} 页", sub_style))
        story.append(PageBreak())

        # Page images
        page_w, page_h = A4
        from reportlab.platypus import Image as RLImage

        for idx, (sort_order, img_data, fmt) in enumerate(page_images):
            img = Image.open(io.BytesIO(img_data))
            iw, ih = img.size
            scale = min(page_w / iw, page_h / ih) * 0.9
            draw_w, draw_h = iw * scale, ih * scale

            # Convert to PNG bytes for reportlab
            tmp = io.BytesIO()
            img.convert("RGB").save(tmp, format="PNG")
            tmp.seek(0)

            rl_img = RLImage(tmp, width=draw_w, height=draw_h)

            from reportlab.platypus import Table, TableStyle
            # Simple centered image
            tbl = Table([[rl_img]], colWidths=[page_w])
            tbl.setStyle(TableStyle([
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ]))
            story.append(tbl)
            story.append(Spacer(1, 3 * mm))

            if idx < len(page_images) - 1:
                story.append(PageBreak())

        doc.build(story)
        buf.seek(0)
        return buf.getvalue()
    except ImportError:
        logger.warning("reportlab not available, falling back to ZIP packaging")
        return _create_zip(page_images, name)
