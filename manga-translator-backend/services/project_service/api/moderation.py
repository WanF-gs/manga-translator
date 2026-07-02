from __future__ import annotations
"""
Content moderation API.
POST /pages/{page_id}/moderate
GET  /pages/{page_id}/moderation-status
"""
from fastapi import APIRouter, Depends, HTTPException

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from common.core.database import get_db
from common.core.response import success_response
from common.core.security import get_current_user

from sqlalchemy import select
from common.models.page import Page

router = APIRouter(tags=["Moderation"])


@router.post("/pages/{page_id}/moderate", summary="触发内容安全检测")
async def moderate_page(
    page_id: str,
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Manually trigger content moderation for a page.
    Checks image and extracted text for inappropriate content.
    """
    from common.tasks.moderation_tasks import moderate_uploaded_content

    # Verify page exists
    result = await db.execute(select(Page).where(Page.page_id == page_id))
    page = result.scalar_one_or_none()
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")

    task = moderate_uploaded_content.delay(
        page_id=page_id,
        user_id=current_user["sub"],
    )

    return success_response(
        data={"task_id": task.id, "page_id": page_id},
        message="Content moderation started",
    )


@router.get("/pages/{page_id}/moderation-status", summary="获取内容安全检测状态")
async def get_moderation_status(
    page_id: str,
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Check the moderation status of a page.
    """
    result = await db.execute(select(Page).where(Page.page_id == page_id))
    page = result.scalar_one_or_none()
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")

    moderation_data = (page.preprocessing_result or {}).get("moderation", {})

    return success_response(data={
        "page_id": page_id,
        "status": page.status,  # approved, blocked, pending, flagged
        "moderation_result": moderation_data,
    })


@router.get("/pages/{page_id}/content-review", summary="获取内容审核结果")
async def get_content_review(
    page_id: str,
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Get content review result for a page.
    Maps to: GET /api/v1/pages/:pid/content-review
    """
    result = await db.execute(select(Page).where(Page.page_id == page_id))
    page = result.scalar_one_or_none()
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")

    moderation_data = (page.preprocessing_result or {}).get("moderation", {})

    return success_response(data={
        "page_id": str(page.page_id),
        "status": page.status,
        "review_result": {
            "safe": moderation_data.get("safe", True),
            "suggestion": moderation_data.get("suggestion", "pass"),
            "action": moderation_data.get("action", "allow"),
            "reasons": moderation_data.get("reasons", []),
            "image_result": moderation_data.get("image_result"),
            "text_results": moderation_data.get("text_results", []),
        },
    })
