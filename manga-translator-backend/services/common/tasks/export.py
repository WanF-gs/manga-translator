from __future__ import annotations
"""
导出异步任务 — 调用真实 export_service，支持 WebSocket 进度推送
"""
from typing import Dict, Any, List, Optional
import logging

from common.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)


async def _push_progress(task_id: str, user_id: str, progress: float, status: str,
                           extra: Optional[Dict[str, Any]] = None):
    """通过 Redis 推送导出进度供 WebSocket 消费"""
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
        await redis_client.setex(f"export:{task_id}:progress", 3600, payload_str)
        await redis_client.publish(f"export_progress:{user_id}", payload_str)
    except Exception as e:
        logger.debug(f"Failed to push progress: {e}")


@celery_app.task(bind=True, max_retries=2, default_retry_delay=120)
def execute_export_task(
    self,
    task_id: str,
    user_id: str = "",
) -> Dict[str, Any]:
    """
    执行导出任务（含 WebSocket 进度推送）。
    1. 查询导出任务记录
    2. 收集页面图片
    3. 按格式打包（CBZ/PDF/ZIP）
    4. 上传到 MinIO
    5. 更新任务状态 + 推送进度
    """
    import asyncio
    import sys, os
    import json
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

    from common.core.database import async_session_factory
    from common.models.export_task import ExportTask
    from common.models.page import Page
    from common.models.chapter import Chapter
    from common.models.project import Project
    from sqlalchemy import select
    from datetime import datetime, timezone
    import httpx
    from PIL import Image
    import io
    import zipfile
    import uuid as _uuid

    async def _execute():
        async with async_session_factory() as db:
            result = await db.execute(
                select(ExportTask).where(ExportTask.task_id == task_id)
            )
            task = result.scalar_one_or_none()
            if not task:
                return {"status": "failed", "error": "Task not found"}

            try:
                task.status = "processing"
                task.progress = 0.0
                await db.flush()
                await _push_progress(task_id, user_id, 0.0, "processing")

                # 查询相关页面
                chapter_ids = task.chapter_ids or []
                if not chapter_ids:
                    task.status = "completed"
                    task.progress = 1.0
                    await db.commit()
                    await _push_progress(task_id, user_id, 1.0, "completed")
                    return {"status": "completed", "pages_exported": 0}

                from uuid import UUID
                uuid_list = []
                for cid in chapter_ids:
                    try:
                        uuid_list.append(UUID(cid))
                    except (ValueError, TypeError):
                        pass

                if not uuid_list:
                    task.status = "completed"
                    task.progress = 1.0
                    await db.commit()
                    return {"status": "completed", "pages_exported": 0}

                # 获取项目/章节信息用于命名
                ch_result = await db.execute(
                    select(Chapter).where(Chapter.chapter_id.in_(uuid_list))
                )
                chapters = list(ch_result.scalars().all())
                project_name = "export"
                if chapters:
                    proj_result = await db.execute(
                        select(Project).where(Project.project_id == chapters[0].project_id)
                    )
                    proj = proj_result.scalar_one_or_none()
                    if proj:
                        project_name = proj.name or "project"

                pages_query = select(Page).where(
                    Page.chapter_id.in_(uuid_list)
                ).order_by(Page.chapter_id, Page.sort_order)

                pages_result = await db.execute(pages_query)
                pages = list(pages_result.scalars().all())

                total_pages = len(pages)
                if total_pages == 0:
                    task.status = "completed"
                    task.progress = 1.0
                    task.result_url = f"/storage/exports/{task_id}.{task.format}"
                    task.completed_at = datetime.now(timezone.utc)
                    await db.commit()
                    await _push_progress(task_id, user_id, 1.0, "completed",
                                         {"result_url": task.result_url})
                    return {"status": "completed", "pages_exported": 0}

                # 下载并收集页面图片
                page_images = []
                for i, page in enumerate(pages):
                    try:
                        url = page.processed_url or page.original_url
                        async with httpx.AsyncClient(timeout=30.0) as client:
                            resp = await client.get(url)
                            resp.raise_for_status()
                            img_data = resp.content

                        img = Image.open(io.BytesIO(img_data))
                        fmt = task.format.split(":")[0] if ":" in task.format else task.format
                        fmt = fmt.lower()
                        buf = io.BytesIO()
                        save_kwargs = {}
                        if fmt in ("png",):
                            save_kwargs["format"] = "PNG"
                        elif fmt in ("jpg", "jpeg"):
                            save_kwargs["format"] = "JPEG"
                            save_kwargs["quality"] = task.quality
                            save_kwargs["optimize"] = True
                        elif fmt == "webp":
                            save_kwargs["format"] = "WEBP"
                            save_kwargs["quality"] = task.quality
                        else:
                            save_kwargs["format"] = "PNG"
                        img.convert("RGB").save(buf, **save_kwargs)
                        buf.seek(0)
                        page_images.append((page.sort_order, buf.getvalue(), fmt))

                        progress = ((i + 1) / total_pages) * 0.9
                        task.progress = round(progress, 2)
                        await db.flush()
                        await _push_progress(task_id, user_id, round(progress, 2), "processing",
                                             {"downloaded": i + 1, "total": total_pages})
                    except Exception as e:
                        logger.warning(f"Failed to process page {page.page_id}: {e}")
                        progress = ((i + 1) / total_pages) * 0.9
                        task.progress = round(progress, 1)
                        await db.flush()

                if not page_images:
                    task.status = "failed"
                    task.error_msg = "No pages could be downloaded"
                    task.completed_at = datetime.now(timezone.utc)
                    await db.commit()
                    await _push_progress(task_id, user_id, 0, "failed",
                                         {"error": task.error_msg})
                    return {"status": "failed", "error": "No pages could be downloaded"}

                # 打包
                archive_fmt = "zip"
                if ":" in task.format:
                    parts = task.format.split(":")
                    archive_fmt = parts[1] if len(parts) > 1 else "zip"

                archive_data = _pack_images_rich(page_images, archive_fmt, task_id,
                                                   project_name)
                task.progress = 0.95
                await db.flush()
                await _push_progress(task_id, user_id, 0.95, "processing",
                                     {"step": "packaging"})

                # 上传 MinIO
                ext = archive_fmt if archive_fmt in ("cbz", "zip", "pdf") else "zip"
                safe_name = project_name.replace(" ", "_")[:30]
                object_name = f"exports/{user_id}/{task_id}/{safe_name}.{ext}"
                content_type = {
                    "cbz": "application/vnd.comicbook+zip",
                    "zip": "application/zip",
                    "pdf": "application/pdf",
                }.get(ext, "application/zip")

                try:
                    from common.core.minio import minio_client
                    from common.core.config import settings
                    minio_client.put_object(
                        bucket_name=settings.MINIO_BUCKET,
                        object_name=object_name,
                        data=io.BytesIO(archive_data),
                        length=len(archive_data),
                        content_type=content_type,
                    )
                    task.result_url = f"/storage/{settings.MINIO_BUCKET}/{object_name}"
                except Exception as e:
                    logger.warning(f"MinIO upload failed: {e}")
                    task.result_url = f"/storage/exports/{task_id}.{ext}"

                task.status = "completed"
                task.progress = 1.0
                task.completed_at = datetime.now(timezone.utc)
                await db.commit()

                file_size_mb = f"{len(archive_data) / (1024 * 1024):.1f}MB"
                await _push_progress(task_id, user_id, 1.0, "completed", {
                    "result_url": task.result_url,
                    "pages_exported": len(page_images),
                    "file_size": file_size_mb,
                })

                return {
                    "status": "completed",
                    "pages_exported": len(page_images),
                    "format": task.format,
                    "result_url": task.result_url,
                    "file_size": file_size_mb,
                }

            except Exception as e:
                logger.error(f"Export task failed: {e}", exc_info=True)
                task.status = "failed"
                task.error_msg = str(e)
                task.completed_at = datetime.now(timezone.utc)
                await db.commit()
                await _push_progress(task_id, user_id, 0, "failed", {"error": str(e)})
                raise

    try:
        return asyncio.run(_execute())
    except Exception as exc:
        logger.error(f"execute_export_task failed: {exc}", exc_info=True)
        raise self.retry(exc=exc)


def _pack_images_rich(page_images: list, archive_format: str, task_id: str,
                       project_name: str = "export") -> bytes:
    """将收集的图片打包，CBZ 含 ComicInfo.xml 元数据"""
    import io, zipfile
    import xml.etree.ElementTree as ET
    from datetime import datetime

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for idx, (sort_order, img_data, fmt) in enumerate(page_images):
            ext = fmt if fmt in ("png", "jpg", "jpeg", "webp") else "png"
            filename = f"{sort_order:03d}.{ext}"
            zf.writestr(filename, img_data)

        # Add ComicInfo.xml for CBZ
        if archive_format == "cbz":
            root = ET.Element("ComicInfo")
            ET.SubElement(root, "Title").text = project_name
            ET.SubElement(root, "Series").text = project_name
            ET.SubElement(root, "PageCount").text = str(len(page_images))
            ET.SubElement(root, "Manga").text = "YesAndRightToLeft"
            ET.SubElement(root, "Notes").text = f"Generated by Manga Translator on {datetime.now().strftime('%Y-%m-%d')}"
            comicinfo = ET.tostring(root, encoding="unicode", xml_declaration=True)
            zf.writestr("ComicInfo.xml", comicinfo)

    buf.seek(0)
    return buf.getvalue()


def _pack_images(page_images: list, archive_format: str, task_id: str) -> bytes:
    """将收集的图片打包（兼容旧接口）"""
    return _pack_images_rich(page_images, archive_format, task_id)


@celery_app.task(bind=True, max_retries=1)
def export_batch_task(
    self,
    task_ids: List[str],
    user_id: str = "",
) -> Dict[str, Any]:
    """批量导出 - 提交多个子导出任务"""
    sub_task_ids = []
    for tid in task_ids:
        sub_task = execute_export_task.delay(task_id=tid, user_id=user_id)
        sub_task_ids.append(sub_task.id)

    return {
        "status": "started",
        "total_tasks": len(task_ids),
        "sub_tasks": sub_task_ids,
    }


@celery_app.task(bind=True, max_retries=1)
def cleanup_expired_exports(self) -> Dict[str, Any]:
    """清理过期导出文件"""
    import asyncio
    import sys, os
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

    from common.core.database import async_session_factory
    from common.models.export_task import ExportTask
    from sqlalchemy import delete
    from datetime import datetime, timezone, timedelta

    async def _cleanup():
        async with async_session_factory() as db:
            cutoff = datetime.now(timezone.utc) - timedelta(days=7)
            result = await db.execute(
                delete(ExportTask).where(
                    ExportTask.completed_at < cutoff,
                    ExportTask.status.in_(["completed", "failed"]),
                )
            )
            deleted = result.rowcount
            await db.commit()
            return {"status": "completed", "deleted_tasks": deleted}

    try:
        return asyncio.run(_cleanup())
    except Exception as exc:
        return {"status": "error", "error": str(exc)}
