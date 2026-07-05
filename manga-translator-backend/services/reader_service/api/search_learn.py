from __future__ import annotations
"""Cross-Work Search & Learning API (v3.0)."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, text, update
from typing import Optional
import uuid, sys, os

_cur = os.path.dirname(os.path.abspath(__file__))
_svc = os.path.dirname(os.path.dirname(_cur))
if _svc not in sys.path:
    sys.path.insert(0, _svc)

from common.core.database import get_db
from common.core.dependencies import get_current_user
from common.core.response import success_response, paginated_response, error_response
from common.core.exceptions import ResourceNotFound
from common.models.text_region import TextRegion
from common.models.page import Page
from common.models.chapter import Chapter
from common.models.project import Project
from common.models.vocabulary import Vocabulary
from common.models.v3_models import LearningProgress, Achievement, UserAchievement

import logging
logger = logging.getLogger(__name__)

router = APIRouter()

@router.get("/search")
async def search_across_works(
    q: Optional[str] = Query(None, description="搜索关键词"),
    project_id: Optional[str] = Query(None),
    language: Optional[str] = Query(None),
    region_type: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Cross-work full-text search. Searches translated & original text."""
    # B10 FIX: Return friendly error when q is missing
    if not q or not q.strip():
        return error_response(code=1003, message="请提供搜索关键词（参数 q），例如：GET /api/v1/search?q=关键词", status_code=400)
    
    query_term = " & ".join(q.split())

    base_query = text("""
        SELECT tr.region_id, tr.page_id, tr.original_text, tr.translated_text,
               tr.type, tr.confidence, pg.sort_order as page_number,
               ch.name as chapter_name, p.name as project_name,
               p.project_id, p.source_lang,
               ts_rank(tr.search_vector, to_tsquery('simple', :query)) as rank
        FROM text_regions tr
        JOIN pages pg ON tr.page_id = pg.page_id
        JOIN chapters ch ON pg.chapter_id = ch.chapter_id
        JOIN projects p ON ch.project_id = p.project_id
        WHERE p.user_id = :user_id
          AND p.status = 'active'
          AND (tr.original_text ILIKE :like_q OR tr.translated_text ILIKE :like_q)
    """)

    params = {"query": query_term, "user_id": str(current_user["sub"]), "like_q": f"%{q}%"}

    if project_id:
        base_query = text(base_query.text + " AND p.project_id = :project_id")
        params["project_id"] = project_id
    if language:
        base_query = text(base_query.text + " AND p.source_lang = :language")
        params["language"] = language
    if region_type:
        base_query = text(base_query.text + " AND tr.type = :region_type")
        params["region_type"] = region_type

    base_query = text(base_query.text + " ORDER BY rank DESC LIMIT :limit OFFSET :offset")
    params["limit"] = page_size
    params["offset"] = (page - 1) * page_size

    result = await db.execute(base_query, params)
    rows = result.fetchall()
    items = [{
        "region_id": str(r[0]),
        "page_id": str(r[1]),
        "original_text": r[2],
        "translated_text": r[3],
        "type": r[4],
        "confidence": r[5],
        "page_number": r[6],
        "chapter_name": r[7],
        "project_name": r[8],
        "project_id": str(r[9]),
        "source_lang": r[10],
        "context": {"before": r[2][:50] if r[2] else "", "after": ""},
    } for r in rows]

    return paginated_response(items=items, page=page, page_size=page_size, total=len(items))

@router.get("/learn/progress")
async def get_learning_progress(
    language: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Get user's learning progress items (for learn page word list)."""
    user_id = current_user["sub"]

    # Query vocab → learning_progress join
    query = (
        select(Vocabulary, LearningProgress)
        .join(LearningProgress, Vocabulary.vocab_id == LearningProgress.vocab_id, isouter=False)
        .where(Vocabulary.user_id == user_id)
    )
    if language:
        query = query.where(Vocabulary.language == language)
    query = query.order_by(LearningProgress.next_review_at.asc().nullslast())

    rows = (await db.execute(query)).all()

    items = []
    for vocab, lp in rows:
        # Parse definition field (format: reading\nmeaning or just word)
        definition = vocab.definition or ""
        meaning = definition
        if "\n" in definition:
            meaning = definition.split("\n", 1)[1]
        items.append({
            "progress_id": str(lp.progress_id),
            "vocab_id": str(vocab.vocab_id),
            "word": vocab.word,
            "language": vocab.language,
            "meaning": meaning,
            "mastery_level": lp.mastery_level or 1,
            "review_count": lp.review_count or 0,
            "next_review_at": lp.next_review_at.isoformat() if lp.next_review_at else None,
            "last_reviewed_at": lp.last_review_at.isoformat() if lp.last_review_at else None,
            "created_at": vocab.created_at.isoformat() if vocab.created_at else None,
        })

    return success_response(data={"items": items, "total": len(items)})

@router.get("/learn/achievements")
async def list_achievements(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """List all achievements and user's progress."""
    all_achievements = (await db.execute(select(Achievement))).scalars().all()
    user_achievements = {str(ua.achievement_id): ua for ua in (await db.execute(
        select(UserAchievement).where(UserAchievement.user_id == current_user["sub"])
    )).scalars().all()}

    def _build_achievement_item(a):
        ua = user_achievements.get(str(a.achievement_id))
        return {
            "user_achievement_id": str(ua.user_achievement_id) if ua else str(uuid.uuid4()),
            "achievement": {
                "achievement_id": str(a.achievement_id),
                "name": a.name,
                "description": a.description or "",
                "icon": a.icon_url or "",
                "category": a.category,
                "condition_type": a.category,
                "condition_value": a.required_value,
            },
            "progress": ua.progress if ua else 0,
            "completed": (ua.unlocked_at is not None) if ua else False,
            "completed_at": ua.unlocked_at.isoformat() if (ua and ua.unlocked_at) else None,
        }

    return success_response(data={
        "items": [_build_achievement_item(a) for a in all_achievements],
    })

@router.get("/learn/review")
async def get_review_list(
    language: Optional[str] = Query(None),
    count: int = Query(10, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Get vocabulary items due for review (Ebbinghaus schedule).

    §3.1: 如果没有到期的（due）词，回退返回该语言下 mastery_level 最低的 N 条
    新词，让用户始终能开始复习（避免空列表导致的"无响应"体验）。
    如果指定语言没有词汇，则回退到所有语言。
    """
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)

    # First try: items where next_review_at has passed
    query = (
        select(LearningProgress, Vocabulary)
        .join(Vocabulary, LearningProgress.vocab_id == Vocabulary.vocab_id)
        .where(
            LearningProgress.user_id == current_user["sub"],
            LearningProgress.next_review_at <= now,
        )
    )
    if language:
        query = query.where(Vocabulary.language == language)
    query = query.order_by(LearningProgress.next_review_at.asc())

    rows = (await db.execute(query)).all()
    logger.info(f"getReview first try: {len(rows)} rows for user={current_user['sub']}, lang={language}")

    # Fallback: 没有 due 的词时，返回该语言下 mastery_level 最低的 N 条
    if not rows and language:
        fallback_query = (
            select(LearningProgress, Vocabulary)
            .join(Vocabulary, LearningProgress.vocab_id == Vocabulary.vocab_id)
            .where(LearningProgress.user_id == current_user["sub"])
            .where(Vocabulary.language == language)
            .order_by(
                LearningProgress.mastery_level.asc(),
                LearningProgress.next_review_at.asc().nulls_first(),
            )
        )
        rows = (await db.execute(fallback_query.limit(count))).all()
        logger.info(f"getReview fallback (language={language}): {len(rows)} rows")

    items = []
    for lp, vocab in rows:
        # Parse definition field (format: reading\nmeaning or just word)
        definition = vocab.definition or ""
        reading = ""
        meaning = definition
        if "\n" in definition:
            parts = definition.split("\n", 1)
            reading = parts[0]
            meaning = parts[1] if len(parts) > 1 else definition

        items.append({
            "progress_id": str(lp.progress_id),
            "vocab_id": str(lp.vocab_id) if lp.vocab_id else None,
            "word": vocab.word,
            "reading": reading,
            "meaning": meaning,
            "translation": meaning,
            "part_of_speech": vocab.part_of_speech,
            "mastery_level": lp.mastery_level or 1,
            "review_count": lp.review_count or 0,
            "last_review_at": lp.last_review_at.isoformat() if lp.last_review_at else None,
            "next_review_at": lp.next_review_at.isoformat() if lp.next_review_at else None,
            "streak_days": lp.streak_days or 0,
            "example_sentence": vocab.example_sentence,
        })

    logger.info(f"getReview returning {len(items)} items")
    return success_response(data={"items": items, "total": len(items)})

@router.put("/learn/progress/{progress_id}")
async def update_learning_progress(
    progress_id: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Update learning progress: mastery level, notes, streak, etc.
    
    When mastery_level is updated, also updates the Ebbinghaus schedule (next_review_at, last_review_at).
    """
    from datetime import datetime, timedelta
    
    progress = (await db.execute(
        select(LearningProgress).where(
            LearningProgress.progress_id == progress_id,
            LearningProgress.user_id == current_user["sub"],
        )
    )).scalar_one_or_none()

    if not progress:
        raise ResourceNotFound("LearningProgress", progress_id)

    updatable_fields = ["mastery_level", "review_count", "streak_days", "notes"]
    for field in updatable_fields:
        if field in body:
            setattr(progress, field, body[field])
    
    # Update Ebbinghaus schedule when mastery_level is changed
    if "mastery_level" in body:
        now = datetime.utcnow()
        intervals = [1, 2, 4, 7, 15]  # Ebbinghaus intervals in days
        
        progress.last_review_at = now
        progress.review_count = (progress.review_count or 0) + 1
        interval_idx = min(progress.review_count - 1, len(intervals) - 1)
        progress.next_review_at = now + timedelta(days=intervals[interval_idx])
        progress.streak_days = (progress.streak_days or 0) + 1

    await db.flush()
    
    # Check and unlock achievements on review
    if "mastery_level" in body:
        try:
            uid = uuid.UUID(current_user["sub"])
            from common.utils.achievement_checker import check_and_unlock_achievements
            await check_and_unlock_achievements(db, uid)
        except Exception as e:
            logger.debug(f"[Achievement] check skipped in update_progress: {e}")
    
    return success_response(data={
        "progress_id": str(progress.progress_id),
        "vocab_id": str(progress.vocab_id) if progress.vocab_id else None,
        "mastery_level": progress.mastery_level,
        "review_count": progress.review_count,
        "streak_days": progress.streak_days,
        "next_review_at": progress.next_review_at.isoformat() if progress.next_review_at else None,
        "last_review_at": progress.last_review_at.isoformat() if progress.last_review_at else None,
    })

@router.post("/learn/review/{vocab_id}")
async def review_vocab(
    vocab_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Record a vocabulary review (updates Ebbinghaus schedule)."""
    from datetime import datetime, timedelta

    progress = (await db.execute(
        select(LearningProgress).where(
            LearningProgress.user_id == current_user["sub"],
            LearningProgress.vocab_id == vocab_id,
        )
    )).scalar_one_or_none()

    now = datetime.utcnow()
    intervals = [1, 2, 4, 7, 15]  # Ebbinghaus intervals in days

    if not progress:
        progress = LearningProgress(
            user_id=current_user["sub"],
            vocab_id=uuid.UUID(vocab_id),
            review_count=1,
            last_review_at=now,
            next_review_at=now + timedelta(days=1),
            mastery_level=1,
        )
        db.add(progress)
    else:
        progress.review_count += 1
        progress.last_review_at = now
        progress.mastery_level = min(5, progress.mastery_level + 1)
        interval_idx = min(progress.review_count - 1, len(intervals) - 1)
        progress.next_review_at = now + timedelta(days=intervals[interval_idx])
        progress.streak_days = (progress.streak_days or 0) + 1

    await db.flush()
    return success_response(data={
        "vocab_id": vocab_id,
        "review_count": progress.review_count,
        "mastery_level": progress.mastery_level,
        "next_review_at": progress.next_review_at.isoformat() if progress.next_review_at else None,
    })


# ── API-3: GET /learn/stats ──
@router.get("/learn/stats")
async def get_word_stats(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Get vocabulary statistics: total, mastered, learning, due for review."""
    total_words = (await db.execute(
        select(func.count(Vocabulary.vocab_id)).where(Vocabulary.user_id == current_user["sub"])
    )).scalar() or 0

    progress_list = (await db.execute(
        select(LearningProgress).where(LearningProgress.user_id == current_user["sub"])
    )).scalars().all()

    mastered = sum(1 for p in progress_list if p.mastery_level and p.mastery_level >= 4)
    learning = sum(1 for p in progress_list if p.mastery_level and 1 <= p.mastery_level < 4)
    new_words = total_words - len(progress_list)

    from datetime import datetime, timezone
    # 用 timezone-aware datetime 与 DB 中的 TIMESTAMPTZ 字段比较
    now = datetime.now(timezone.utc)
    due_review = sum(1 for p in progress_list if p.next_review_at and p.next_review_at <= now)

    return success_response(data={
        "total_words": total_words,
        "mastered": mastered,
        "learning": learning,
        "reviewing": learning,  # alias for frontend
        "new_words": new_words,
        "due_review": due_review,
    })


# ── API-5: GET /search/{result_id}/context ──
@router.get("/search/{result_id}/context")
async def get_search_context(
    result_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Get the page context for a search result — navigate to the exact page and highlight the region."""
    # result_id here is actually region_id from search results
    region = (await db.execute(
        select(TextRegion).where(
            TextRegion.region_id == result_id,
            TextRegion.user_id == current_user["sub"],
        )
    )).scalar_one_or_none()

    if not region:
        raise ResourceNotFound("SearchResult", result_id)

    page = (await db.execute(
        select(Page).where(Page.page_id == region.page_id)
    )).scalar_one_or_none()

    if not page:
        raise ResourceNotFound("Page", str(region.page_id))

    chapter = (await db.execute(
        select(Chapter).where(Chapter.chapter_id == page.chapter_id)
    )).scalar_one_or_none()

    project = None
    if chapter:
        project = (await db.execute(
            select(Project).where(Project.project_id == chapter.project_id)
        )).scalar_one_or_none()

    return success_response(data={
        "region_id": str(region.region_id),
        "page_id": str(region.page_id),
        "page_number": page.sort_order,
        "region_bounds": {
            "x": region.x,
            "y": region.y,
            "width": region.width,
            "height": region.height,
        },
        "chapter_name": chapter.name if chapter else None,
        "chapter_id": str(chapter.chapter_id) if chapter else None,
        "project_name": project.name if project else None,
        "project_id": str(project.project_id) if project else None,
        "page_url": f"/pc/projects/{str(project.project_id) if project else ''}/edit?page={page.sort_order}&highlight={result_id}",
    })
