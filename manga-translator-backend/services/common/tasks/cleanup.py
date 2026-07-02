from __future__ import annotations
"""
定时清理任务 — Celery Beat 调度

- cleanup_expired_trash: 每天清理30天前删除的项目（含MinIO文件清理）
- cleanup_failed_tasks: 清理7天前的失败任务记录
"""
import logging
from datetime import datetime, timezone, timedelta

from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from common.core.config import settings
from .celery_app import celery_app

logger = logging.getLogger(__name__)


def _get_async_session():
    """创建异步数据库会话"""
    engine = create_async_engine(settings.DATABASE_URL, echo=False)
    return sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)()


def _extract_minio_object_name(url: str) -> str | None:
    """从存储URL中提取MinIO对象名（去除/storage/前缀）"""
    if not url:
        return None
    # URL格式: /storage/{bucket}/{object_name} 或 /storage/{user_id}/...
    if url.startswith("/storage/"):
        return url[len("/storage/"):]
    # 也可能直接是 bucket/object 格式
    return url.lstrip("/")


def _delete_minio_objects(object_names: list[str]) -> tuple[int, int]:
    """批量删除MinIO对象，返回(成功数, 总存储字节)"""
    from common.core.minio import minio_client

    deleted_count = 0
    freed_bytes = 0
    bucket = settings.MINIO_BUCKET

    for name in object_names:
        if not name:
            continue
        try:
            # 获取对象信息以统计释放空间
            try:
                stat = minio_client.stat_object(bucket, name)
                freed_bytes += stat.size or 0
            except Exception:
                pass

            minio_client.remove_object(bucket, name)
            deleted_count += 1
        except Exception as e:
            logger.warning(f"MinIO delete failed for {name}: {e}")

    return deleted_count, freed_bytes


@celery_app.task(name="common.tasks.cleanup.cleanup_expired_trash")
def cleanup_expired_trash():
    """清理30天前删除的项目（永久删除，含MinIO文件清理）"""
    import asyncio

    async def _run():
        from common.models.project import Project
        from common.models.chapter import Chapter
        from common.models.page import Page
        from common.models.text_region import TextRegion

        session = _get_async_session()
        try:
            cutoff = datetime.now(timezone.utc) - timedelta(days=settings.TRASH_RETENTION_DAYS)

            # 使用 trashed_at 字段而不是 updated_at（更精确）
            result = await session.execute(
                select(Project).where(
                    Project.status == "trashed",
                    Project.trashed_at < cutoff,
                )
            )
            expired_projects = list(result.scalars().all())

            cleaned = 0
            total_freed_bytes = 0
            total_files_deleted = 0

            for project in expired_projects:
                # 先收集所有需要清理的MinIO文件URL
                minio_objects = []

                if project.cover_url:
                    minio_objects.append(_extract_minio_object_name(project.cover_url))

                # 获取项目下所有章节
                chapters_result = await session.execute(
                    select(Chapter).where(Chapter.project_id == project.project_id)
                )
                chapters = list(chapters_result.scalars().all())

                for chapter in chapters:
                    # 获取章节下所有页面（收集文件URL）
                    pages_result = await session.execute(
                        select(Page).where(Page.chapter_id == chapter.chapter_id)
                    )
                    pages = list(pages_result.scalars().all())

                    for page in pages:
                        minio_objects.append(_extract_minio_object_name(page.original_url))
                        minio_objects.append(_extract_minio_object_name(page.processed_url))
                        minio_objects.append(_extract_minio_object_name(page.thumbnail_url))

                        # 删除文字区域
                        await session.execute(
                            delete(TextRegion).where(TextRegion.page_id == page.page_id)
                        )
                        await session.delete(page)

                    await session.delete(chapter)

                await session.delete(project)
                cleaned += 1

                # 执行MinIO文件删除
                valid_objects = [o for o in minio_objects if o]
                if valid_objects:
                    deleted, freed = _delete_minio_objects(valid_objects)
                    total_files_deleted += deleted
                    total_freed_bytes += freed

            await session.commit()

            freed_mb = total_freed_bytes / (1024 * 1024) if total_freed_bytes > 0 else 0
            logger.info(
                f"Trash cleanup: permanently deleted {cleaned} expired projects, "
                f"removed {total_files_deleted} files from MinIO, "
                f"freed {freed_mb:.2f} MB storage"
            )

            # 同时清理失败的导出任务（7天前）
            from common.models.export_task import ExportTask
            task_cutoff = datetime.now(timezone.utc) - timedelta(days=7)
            task_result = await session.execute(
                delete(ExportTask).where(
                    ExportTask.status == "failed",
                    ExportTask.created_at < task_cutoff,
                )
            )
            await session.commit()
            logger.info(f"Cleaned up {task_result.rowcount} old failed export tasks")

            return {
                "cleaned_projects": cleaned,
                "cleaned_tasks": task_result.rowcount,
                "files_deleted": total_files_deleted,
                "storage_freed_mb": round(freed_mb, 2),
            }

        except Exception as e:
            await session.rollback()
            logger.error(f"Trash cleanup failed: {e}")
            raise
        finally:
            await session.close()

    return asyncio.run(_run())


@celery_app.task(name="common.tasks.cleanup.cleanup_old_notifications")
def cleanup_old_notifications():
    """清理90天前的已读通知"""
    import asyncio

    async def _run():
        from common.models.notification import Notification

        session = _get_async_session()
        try:
            cutoff = datetime.now(timezone.utc) - timedelta(days=90)
            result = await session.execute(
                delete(Notification).where(
                    Notification.is_read == True,
                    Notification.created_at < cutoff,
                )
            )
            await session.commit()
            logger.info(f"Cleaned up {result.rowcount} old notifications")
            return {"cleaned_notifications": result.rowcount}
        except Exception as e:
            await session.rollback()
            logger.error(f"Notification cleanup failed: {e}")
            raise
        finally:
            await session.close()

    return asyncio.run(_run())
