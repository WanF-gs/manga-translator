from __future__ import annotations
"""
通知异步任务
"""
from typing import Dict, Any, List, Optional
from common.tasks.celery_app import celery_app


@celery_app.task(bind=True, max_retries=2, default_retry_delay=10)
def send_notification(
    self,
    user_id: str,
    type: str,
    title: str,
    content: str = "",
    ref_type: Optional[str] = None,
    ref_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    异步发送站内通知。
    """
    import asyncio
    import sys
    import os
    import uuid
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

    from common.core.database import async_session_factory
    from common.models.notification import Notification

    async def _send():
        async with async_session_factory() as db:
            notification = Notification(
                notification_id=uuid.uuid4(),
                user_id=uuid.UUID(user_id),
                type=type,
                title=title,
                content=content,
                is_read=False,
                ref_type=ref_type,
                ref_id=uuid.UUID(ref_id) if ref_id else None,
            )
            db.add(notification)
            await db.commit()
            await db.refresh(notification)

            return {
                "status": "sent",
                "notification_id": str(notification.notification_id),
                "user_id": user_id,
                "type": type,
            }

    try:
        return asyncio.run(_send())
    except Exception as exc:
        raise self.retry(exc=exc)


@celery_app.task(bind=True, max_retries=2, default_retry_delay=10)
def batch_send_notification(
    self,
    user_ids: List[str],
    type: str,
    title: str,
    content: str = "",
    ref_type: Optional[str] = None,
    ref_id: Optional[str] = None,
) -> Dict[str, Any]:
    """批量发送通知给多个用户"""
    task_ids = []
    for uid in user_ids:
        task = send_notification.delay(
            user_id=uid,
            type=type,
            title=title,
            content=content,
            ref_type=ref_type,
            ref_id=ref_id,
        )
        task_ids.append(task.id)

    return {
        "status": "started",
        "total_users": len(user_ids),
        "sub_tasks": task_ids,
    }


@celery_app.task(bind=True, max_retries=1)
def cleanup_read_notifications(self, days: int = 30) -> Dict[str, Any]:
    """清理已读通知（定时任务）"""
    import asyncio
    import sys
    import os
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

    from common.core.database import async_session_factory
    from common.models.notification import Notification
    from sqlalchemy import delete
    from datetime import datetime, timezone, timedelta

    async def _cleanup():
        async with async_session_factory() as db:
            cutoff = datetime.now(timezone.utc) - timedelta(days=days)
            result = await db.execute(
                delete(Notification).where(
                    Notification.is_read == True,
                    Notification.created_at < cutoff,
                )
            )
            deleted = result.rowcount
            await db.commit()
            return {"status": "completed", "deleted_notifications": deleted}

    try:
        return asyncio.run(_cleanup())
    except Exception as exc:
        return {"status": "error", "error": str(exc)}
