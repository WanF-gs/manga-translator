from __future__ import annotations
"""User Feedback API - Rating, correction, training data (v3.0)."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import Optional
import uuid, sys, os

_cur = os.path.dirname(os.path.abspath(__file__))
_svc = os.path.dirname(os.path.dirname(_cur))
if _svc not in sys.path:
    sys.path.insert(0, _svc)

from common.core.database import get_db
from common.core.dependencies import get_current_user
from common.core.response import success_response, paginated_response, created_response
from common.core.exceptions import ResourceNotFound
from common.models.v3_models import Feedback
from common.models.text_region import TextRegion

router = APIRouter()

@router.post("")
async def submit_feedback(
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Submit translation feedback (good/bad/neutral + optional correction)."""
    region_id = body["region_id"]
    region = (await db.execute(select(TextRegion).where(TextRegion.region_id == region_id))).scalar_one_or_none()
    if not region:
        raise ResourceNotFound("Text region", region_id)

    feedback = Feedback(
        user_id=current_user["sub"],
        region_id=uuid.UUID(region_id),
        original_translation=body.get("original_translation") or region.translated_text or "",
        user_translation=body.get("user_translation"),
        rating=body.get("rating", "neutral"),
        correction_reason=body.get("correction_reason"),
    )
    db.add(feedback)
    await db.flush()

    # If user provided a corrected translation, update the region
    if body.get("user_translation"):
        region.translated_text = body["user_translation"]
        await db.flush()

    return created_response(data=_feedback_to_dict(feedback), message="Feedback submitted")

@router.get("")
async def list_feedback(
    region_id: Optional[str] = Query(None),
    rating: Optional[str] = Query(None),
    used_for_training: Optional[bool] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """List user feedback entries."""
    query = select(Feedback).where(Feedback.user_id == current_user["sub"])
    if region_id:
        query = query.where(Feedback.region_id == region_id)
    if rating:
        query = query.where(Feedback.rating == rating)
    if used_for_training is not None:
        query = query.where(Feedback.used_for_training == used_for_training)
    query = query.order_by(Feedback.created_at.desc())

    count_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar()
    query = query.offset((page - 1) * page_size).limit(page_size)
    items = (await db.execute(query)).scalars().all()
    return paginated_response(items=[_feedback_to_dict(f) for f in items], page=page, page_size=page_size, total=total)

@router.get("/stats")
async def feedback_stats(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Get feedback statistics."""
    total = (await db.execute(select(func.count(Feedback.feedback_id)).where(Feedback.user_id == current_user["sub"]))).scalar()
    good = (await db.execute(select(func.count(Feedback.feedback_id)).where(Feedback.user_id == current_user["sub"], Feedback.rating == "good"))).scalar()
    bad = (await db.execute(select(func.count(Feedback.feedback_id)).where(Feedback.user_id == current_user["sub"], Feedback.rating == "bad"))).scalar()
    training_count = (await db.execute(select(func.count(Feedback.feedback_id)).where(Feedback.user_id == current_user["sub"], Feedback.used_for_training == True))).scalar()

    return success_response(data={
        "total": total,
        "good": good,
        "bad": bad,
        "neutral": total - good - bad,
        "used_for_training": training_count,
        "improvement_message": f"您的反馈已帮助改进了 {training_count} 条翻译" if training_count > 0 else "开始提交反馈来帮助改进翻译质量吧！",
    })

def _feedback_to_dict(f: Feedback) -> dict:
    return {
        "feedback_id": str(f.feedback_id),
        "user_id": str(f.user_id),
        "region_id": str(f.region_id),
        "original_translation": f.original_translation,
        "user_translation": f.user_translation,
        "rating": f.rating,
        "correction_reason": f.correction_reason,
        "used_for_training": f.used_for_training,
        "created_at": f.created_at.isoformat() if f.created_at else None,
    }
