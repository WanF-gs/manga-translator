from __future__ import annotations
"""导出任务数据访问层"""
from typing import List, Optional, Tuple
import uuid

from sqlalchemy import select, func, delete, update
from sqlalchemy.ext.asyncio import AsyncSession

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))

from common.models.export_task import ExportTask


class ExportRepo:
    """导出任务仓库"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(self, task: ExportTask) -> ExportTask:
        """创建导出任务"""
        self.db.add(task)
        await self.db.flush()
        await self.db.refresh(task)
        return task

    async def find_by_id(self, task_id: str) -> Optional[ExportTask]:
        """按ID查询任务"""
        result = await self.db.execute(
            select(ExportTask).where(ExportTask.task_id == uuid.UUID(task_id))
        )
        return result.scalar_one_or_none()

    async def find_by_user_paginated(
        self, user_id: str, page: int = 1, page_size: int = 20,
        status: Optional[str] = None, project_id: Optional[str] = None,
    ) -> Tuple[List[ExportTask], int]:
        """分页查询用户的导出任务"""
        query = select(ExportTask).where(ExportTask.user_id == uuid.UUID(user_id))
        count_query = select(func.count()).select_from(ExportTask).where(
            ExportTask.user_id == uuid.UUID(user_id)
        )

        if status:
            query = query.where(ExportTask.status == status)
            count_query = count_query.where(ExportTask.status == status)

        if project_id:
            query = query.where(ExportTask.project_id == uuid.UUID(project_id))
            count_query = count_query.where(ExportTask.project_id == uuid.UUID(project_id))

        query = query.order_by(ExportTask.created_at.desc())
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self.db.execute(query)
        items = list(result.scalars().all())

        count_result = await self.db.execute(count_query)
        total = count_result.scalar() or 0

        return items, total

    async def update_status(
        self, task_id: str, status: str, progress: float = 0.0,
        result_url: Optional[str] = None, error_msg: Optional[str] = None,
    ) -> Optional[ExportTask]:
        """更新任务状态"""
        task = await self.find_by_id(task_id)
        if not task:
            return None

        task.status = status
        task.progress = progress
        if result_url:
            task.result_url = result_url
        if error_msg:
            task.error_msg = error_msg

        from datetime import datetime, timezone
        if status in ("completed", "failed"):
            task.completed_at = datetime.now(timezone.utc)

        await self.db.flush()
        await self.db.refresh(task)
        return task

    async def delete_task(self, task_id: str, user_id: str) -> bool:
        """删除任务（仅允许删除已完成或失败的任务）"""
        result = await self.db.execute(
            delete(ExportTask).where(
                ExportTask.task_id == uuid.UUID(task_id),
                ExportTask.user_id == uuid.UUID(user_id),
                ExportTask.status.in_(["completed", "failed", "cancelled"]),
            )
        )
        await self.db.flush()
        return result.rowcount > 0
