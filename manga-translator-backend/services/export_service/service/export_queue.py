from __future__ import annotations
"""
Export queue manager - manages export task lifecycle.
"""
import uuid
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone, timedelta

from sqlalchemy import select, update, delete, and_, func
from sqlalchemy.ext.asyncio import AsyncSession

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from common.models.export_task import ExportTask

logger = logging.getLogger(__name__)


class ExportQueueManager:
    """Manages export task creation, lifecycle, and progress."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def create_task(
        self,
        user_id: str,
        task_type: str,  # single, chapter, project
        format: str = "png",
        quality: int = 90,
        archive_format: Optional[str] = None,
        bilingual: bool = False,
        bilingual_mode: str = "side-by-side",
        chapter_ids: Optional[List[str]] = None,
        page_ids: Optional[List[str]] = None,
        project_id: Optional[str] = None,
    ) -> str:
        """
        Create a new export task.
        Returns task_id.
        """
        task_id = str(uuid.uuid4())
        
        task = ExportTask(
            task_id=uuid.UUID(task_id),
            user_id=uuid.UUID(user_id),
            status="pending",
            task_type=task_type,
            format=f"{format}:{archive_format}" if archive_format else format,
            quality=quality,
            progress=0.0,
            bilingual=bilingual,
            bilingual_mode=bilingual_mode,
            chapter_ids=chapter_ids or [],
            page_ids=page_ids or [],
            project_id=uuid.UUID(project_id) if project_id else None,
            result_url=None,
            error_msg=None,
            created_at=datetime.now(timezone.utc),
        )
        
        self.db.add(task)
        await self.db.commit()
        await self.db.refresh(task)
        
        return task_id

    async def update_progress(self, task_id: str, progress: float, status: Optional[str] = None):
        """Update task progress."""
        values = {"progress": min(progress, 100.0)}
        if status:
            values["status"] = status
        
        await self.db.execute(
            update(ExportTask)
            .where(ExportTask.task_id == task_id)
            .values(**values)
        )
        await self.db.flush()

    async def complete_task(self, task_id: str, result_url: str, file_size: int = 0):
        """Mark task as completed."""
        await self.db.execute(
            update(ExportTask)
            .where(ExportTask.task_id == task_id)
            .values(
                status="completed",
                progress=1.0,
                result_url=result_url,
                file_size=file_size,
                completed_at=datetime.now(timezone.utc),
            )
        )
        await self.db.commit()

    async def fail_task(self, task_id: str, error: str):
        """Mark task as failed."""
        await self.db.execute(
            update(ExportTask)
            .where(ExportTask.task_id == task_id)
            .values(
                status="failed",
                error_msg=error,
                completed_at=datetime.now(timezone.utc),
            )
        )
        await self.db.commit()

    async def pause_task(self, task_id: str) -> bool:
        """Pause a running export task."""
        result = await self.db.execute(
            select(ExportTask).where(ExportTask.task_id == task_id)
        )
        task = result.scalar_one_or_none()
        
        if task and task.status in ("pending", "processing"):
            task.status = "paused"
            await self.db.commit()
            return True
        return False

    async def resume_task(self, task_id: str) -> bool:
        """Resume a paused export task."""
        result = await self.db.execute(
            select(ExportTask).where(ExportTask.task_id == task_id)
        )
        task = result.scalar_one_or_none()
        
        if task and task.status == "paused":
            task.status = "processing"
            await self.db.commit()
            return True
        return False

    async def cancel_task(self, task_id: str) -> bool:
        """Cancel an export task."""
        result = await self.db.execute(
            select(ExportTask).where(ExportTask.task_id == task_id)
        )
        task = result.scalar_one_or_none()
        
        if task and task.status in ("pending", "processing", "paused"):
            task.status = "cancelled"
            await self.db.commit()
            return True
        return False

    async def get_task(self, task_id: str) -> Optional[Dict[str, Any]]:
        """Get task details."""
        result = await self.db.execute(
            select(ExportTask).where(ExportTask.task_id == task_id)
        )
        task = result.scalar_one_or_none()
        
        if not task:
            return None
        
        return {
            "task_id": str(task.task_id),
            "status": task.status,
            "task_type": task.task_type,
            "format": task.format,
            "progress": task.progress,
            "result_url": task.result_url,
            "error_msg": task.error_msg,
            "file_size": task.file_size,
            "bilingual": task.bilingual,
            "bilingual_mode": task.bilingual_mode,
            "created_at": task.created_at.isoformat() if task.created_at else None,
            "completed_at": task.completed_at.isoformat() if task.completed_at else None,
        }

    async def get_user_queue(
        self,
        user_id: str,
        status: Optional[str] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> tuple:
        """Get user's export tasks."""
        query = select(ExportTask).where(ExportTask.user_id == user_id)
        
        if status:
            query = query.where(ExportTask.status == status)
        
        query = query.order_by(ExportTask.created_at.desc())
        
        # Count
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await self.db.execute(count_query)
        total = total_result.scalar() or 0
        
        # Paginated results
        offset = (page - 1) * page_size
        query = query.offset(offset).limit(page_size)
        result = await self.db.execute(query)
        tasks = list(result.scalars().all())
        
        items = [
            {
                "task_id": str(t.task_id),
                "status": t.status,
                "task_type": t.task_type,
                "format": t.format,
                "progress": t.progress,
                "result_url": t.result_url,
                "error_msg": t.error_msg,
                "file_size": t.file_size,
                "bilingual": getattr(t, "bilingual", False),
                "created_at": t.created_at.isoformat() if t.created_at else None,
                "completed_at": t.completed_at.isoformat() if t.completed_at else None,
            }
            for t in tasks
        ]
        
        return items, total

    async def delete_task(self, task_id: str, user_id: str) -> bool:
        """Delete an export task."""
        result = await self.db.execute(
            delete(ExportTask).where(
                and_(
                    ExportTask.task_id == task_id,
                    ExportTask.user_id == user_id,
                )
            )
        )
        deleted = result.rowcount
        await self.db.commit()
        return deleted > 0

    async def cleanup_expired(self, days: int = 7) -> int:
        """Clean up expired completed/failed tasks."""
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        
        result = await self.db.execute(
            delete(ExportTask).where(
                and_(
                    ExportTask.completed_at < cutoff,
                    ExportTask.status.in_(["completed", "failed", "cancelled"]),
                )
            )
        )
        deleted = result.rowcount
        await self.db.commit()
        return deleted
