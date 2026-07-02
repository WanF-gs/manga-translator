from __future__ import annotations
"""
Content moderation celery tasks.
Automatically checks uploaded content for safety compliance.
"""
import asyncio
import logging
from typing import Dict, Any

from common.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(bind=True, max_retries=2, default_retry_delay=30)
def moderate_uploaded_content(
    self,
    page_id: str,
    user_id: str = "",
) -> Dict[str, Any]:
    """
    Moderate uploaded manga page content.
    1. Download page image
    2. Extract text (if already OCR'd)
    3. Call content safety API
    4. Mark page as blocked/approved
    5. Create notification if violation found
    """
    import sys, os
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

    from common.core.database import async_session_factory
    from common.models.page import Page
    from common.models.text_region import TextRegion
    from common.models.notification import Notification
    from sqlalchemy import select
    import uuid
    from datetime import datetime, timezone

    async def _moderate():
        async with async_session_factory() as db:
            # Get page
            result = await db.execute(select(Page).where(Page.page_id == page_id))
            page = result.scalar_one_or_none()
            if not page:
                return {"status": "failed", "error": "Page not found"}

            # Collect text content from OCR'd regions
            regions_result = await db.execute(
                select(TextRegion).where(TextRegion.page_id == page_id)
            )
            regions = list(regions_result.scalars().all())

            text_content = [
                r.original_text for r in regions
                if r.original_text and len(r.original_text.strip()) > 2
            ]

            # Call content safety
            from common.clients.content_safety import content_safety_client

            moderation_result = await content_safety_client.moderate_upload(
                image_url=page.original_url,
                text_content=text_content,
            )

            if not moderation_result.get("safe", True):
                # Content violation detected
                action = moderation_result.get("action", "flag_for_review")
                if action == "block":
                    page.status = "blocked"
                else:
                    page.status = "flagged"  # PRD P0: flagged for manual review

                page.preprocessing_result = page.preprocessing_result or {}
                page.preprocessing_result["moderation"] = moderation_result

                # Create notification for user
                if user_id:
                    reasons = moderation_result.get("reasons", ["Content violation"])
                    notif_title = "内容安全检测提醒"
                    notif_content = (
                        f"页面内容触发安全检测：{'; '.join(reasons)}。"
                        f"操作：{action}。页面已被{'拦截' if action == 'block' else '标记待审'}"
                    )
                    notification = Notification(
                        notification_id=uuid.uuid4(),
                        user_id=uuid.UUID(user_id),
                        type="content_violation",
                        title=notif_title,
                        content=notif_content,
                        is_read=False,
                        ref_type="page",
                        ref_id=uuid.UUID(page_id),
                    )
                    db.add(notification)

                await db.commit()

                return {
                    "status": page.status,
                    "page_id": page_id,
                    "result": moderation_result,
                }
            else:
                # Content safe
                page.preprocessing_result = page.preprocessing_result or {}
                page.preprocessing_result["moderation"] = moderation_result
                if page.status not in ("blocked", "flagged"):
                    page.status = "approved"

                await db.commit()

                return {
                    "status": "approved",
                    "page_id": page_id,
                    "result": moderation_result,
                }

    try:
        return asyncio.run(_moderate())
    except Exception as exc:
        logger.error(f"Moderation task failed: {exc}", exc_info=True)
        raise self.retry(exc=exc)


@celery_app.task(bind=True, max_retries=1)
def moderate_project(
    self,
    project_id: str,
    user_id: str = "",
) -> Dict[str, Any]:
    """
    Moderate all pages in a project.
    Dispatches individual moderation tasks for each page.
    """
    import sys, os
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

    from common.core.database import async_session_factory
    from common.models.page import Page
    from common.models.chapter import Chapter
    from sqlalchemy import select
    
    async def _do():
        async with async_session_factory() as db:
            # Get all chapters in project
            ch_result = await db.execute(
                select(Chapter).where(Chapter.project_id == project_id)
            )
            chapters = list(ch_result.scalars().all())

            task_ids = []
            for ch in chapters:
                pages_result = await db.execute(
                    select(Page).where(Page.chapter_id == ch.chapter_id)
                )
                for page in pages_result.scalars().all():
                    if page.status in ("pending", "uploaded", "detected"):
                        task = moderate_uploaded_content.delay(
                            page_id=str(page.page_id),
                            user_id=user_id,
                        )
                        task_ids.append(task.id)

            return {
                "status": "started",
                "project_id": project_id,
                "total_pages_checked": len(task_ids),
                "sub_tasks": task_ids,
            }
    
    try:
        return asyncio.run(_do())
    except Exception as exc:
        raise self.retry(exc=exc)
