from __future__ import annotations
"""导出任务管理 API"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, update
from datetime import datetime, timezone
import uuid

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from common.core.dependencies import get_db, get_current_user
from common.core.response import success_response, paginated_response, error_response
from common.models.export_task import ExportTask
from ..service.export_service import ExportService
from ..repository.export_repo import ExportRepo

router = APIRouter(prefix="/export-tasks", tags=["Export Tasks"])


@router.get("")
async def list_tasks(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: str = Query(None, description="过滤状态: pending, processing, completed, failed, paused, cancelled"),
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """获取导出任务列表"""
    repo = ExportRepo(db)
    service = ExportService(repo, db)
    items, total = await service.list_tasks(
        user_id=current_user["sub"],
        page=page,
        page_size=page_size,
        status=status,
    )
    return paginated_response(items=items, page=page, page_size=page_size, total=total)


@router.delete("/{task_id}")
async def delete_task(
    task_id: str,
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """删除导出任务及文件"""
    repo = ExportRepo(db)
    service = ExportService(repo, db)
    await service.delete_task(task_id, current_user["sub"])
    return success_response(message="导出任务已删除")


@router.post("/{task_id}/retry")
async def retry_task(
    task_id: str,
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """重试失败的导出任务"""
    repo = ExportRepo(db)
    service = ExportService(repo, db)
    result = await service.retry_task(task_id, current_user["sub"])
    return success_response(data=result, message="已重新提交导出任务")


@router.post("/{task_id}/pause")
async def pause_task(
    task_id: str,
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """暂停正在处理的导出任务"""
    try:
        task_uuid = uuid.UUID(task_id)
    except ValueError:
        return error_response(code=4001, message="Invalid task_id format")

    result = await db.execute(
        select(ExportTask).where(
            ExportTask.task_id == task_uuid,
            ExportTask.user_id == uuid.UUID(current_user["sub"]),
        )
    )
    task = result.scalar_one_or_none()
    if not task:
        return error_response(code=4004, message="Task not found", status_code=404)

    if task.status != "processing":
        return error_response(code=4002, message=f"Cannot pause task with status '{task.status}'")

    task.status = "paused"
    task.updated_at = datetime.now(timezone.utc)
    await db.commit()

    # Signal Celery to pause via Redis
    try:
        from common.core.redis import redis_client
        await redis_client.setex(f"export:pause:{task_id}", 3600, "1")
    except Exception:
        pass

    return success_response(data={"task_id": task_id, "status": "paused"}, message="导出任务已暂停")


@router.post("/{task_id}/resume")
async def resume_task(
    task_id: str,
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """恢复已暂停的导出任务"""
    try:
        task_uuid = uuid.UUID(task_id)
    except ValueError:
        return error_response(code=4001, message="Invalid task_id format")

    result = await db.execute(
        select(ExportTask).where(
            ExportTask.task_id == task_uuid,
            ExportTask.user_id == uuid.UUID(current_user["sub"]),
        )
    )
    task = result.scalar_one_or_none()
    if not task:
        return error_response(code=4004, message="Task not found", status_code=404)

    if task.status != "paused":
        return error_response(code=4002, message=f"Cannot resume task with status '{task.status}'")

    task.status = "processing"
    task.updated_at = datetime.now(timezone.utc)
    await db.commit()

    # Remove pause signal from Redis
    try:
        from common.core.redis import redis_client
        await redis_client.delete(f"export:pause:{task_id}")
    except Exception:
        pass

    return success_response(data={"task_id": task_id, "status": "processing"}, message="导出任务已恢复")


@router.post("/{task_id}/cancel")
async def cancel_task(
    task_id: str,
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """取消导出任务"""
    try:
        task_uuid = uuid.UUID(task_id)
    except ValueError:
        return error_response(code=4001, message="Invalid task_id format")

    result = await db.execute(
        select(ExportTask).where(
            ExportTask.task_id == task_uuid,
            ExportTask.user_id == uuid.UUID(current_user["sub"]),
        )
    )
    task = result.scalar_one_or_none()
    if not task:
        return error_response(code=4004, message="Task not found", status_code=404)

    if task.status in ("completed", "cancelled"):
        return error_response(code=4002, message=f"Cannot cancel task with status '{task.status}'")

    task.status = "cancelled"
    task.error_msg = "Cancelled by user"
    task.updated_at = datetime.now(timezone.utc)
    await db.commit()

    # Signal Celery to cancel via Redis
    try:
        from common.core.redis import redis_client
        await redis_client.setex(f"export:cancel:{task_id}", 3600, "1")
    except Exception:
        pass

    return success_response(data={"task_id": task_id, "status": "cancelled"}, message="导出任务已取消")
