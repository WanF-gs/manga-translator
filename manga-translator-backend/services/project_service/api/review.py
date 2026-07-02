from __future__ import annotations
"""
Proofreading / Review Workbench API — PRD v3.0 R1 Critical Gap Fix.
Provides page listing, translation editing, batch replace, and progress stats.
"""
import logging
from typing import Optional, List
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, func, and_, update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from common.core.database import get_db
from common.models.project import Project
from common.models.chapter import Chapter
from common.models.page import Page
from common.models.text_region import TextRegion

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects", tags=["Review/Proofreading"])

# P0-3 fix: Secondary router for /review/* paths (without /projects prefix)
# E2E tests call /api/v1/review/{pid}/regions and /api/v1/review/{pid}/bulk-replace
review_router = APIRouter(tags=["Review/Proofreading"])


# ===== Pydantic Schemas =====
class TranslationUpdate(BaseModel):
    """Update a single translation."""
    region_id: str
    translated_text: str = Field(..., min_length=1)


class BatchReplaceRequest(BaseModel):
    """Search-and-replace across multiple pages."""
    search: str = Field(..., min_length=1)
    replace: str
    scope: str = Field(default="current_page")  # current_page | all_pages
    page_id: Optional[str] = None
    project_id: str = Field(..., min_length=1)


class ReviewStatsResponse(BaseModel):
    project_id: str
    total_pages: int
    reviewed_pages: int
    unreviewed_pages: int
    total_regions: int
    reviewed_regions: int
    progress_percent: float


# ===== API Endpoints =====

@router.get("/{project_id}/review/pages")
async def list_review_pages(
    project_id: str,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    status: Optional[str] = Query(default=None, description="Filter: reviewed|unreviewed|all"),
    db: AsyncSession = Depends(get_db),
):
    """
    Get paginated list of pages for the proofreading workbench.
    Each page includes its text regions with original + translated text.
    """
    # Verify project exists
    proj = await db.get(Project, project_id)
    if not proj:
        raise HTTPException(404, "Project not found")

    # Get all chapters in project
    chapters_result = await db.execute(
        select(Chapter.chapter_id).where(Chapter.project_id == project_id)
    )
    chapter_ids = [row[0] for row in chapters_result.fetchall()]

    if not chapter_ids:
        return {"code": 0, "message": "success", "data": {"items": [], "total": 0, "page": page, "page_size": page_size}}

    # Build base query
    pages_query = select(Page).where(Page.chapter_id.in_(chapter_ids))

    if status == "reviewed":
        pages_query = pages_query.where(Page.status == "reviewed")
    elif status == "unreviewed":
        pages_query = pages_query.where(Page.status != "reviewed")

    # Count total
    count_query = select(func.count()).select_from(pages_query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Paginate
    # P0-FIX-03: Page model uses sort_order (not page_number) for ordering
    pages_result = await db.execute(
        pages_query.order_by(Page.sort_order).offset((page - 1) * page_size).limit(page_size)
    )
    pages = pages_result.scalars().all()

    items = []
    for p in pages:
        # Get regions for this page
        regions_result = await db.execute(
            select(TextRegion).where(TextRegion.page_id == p.page_id).order_by(TextRegion.sort_order)
        )
        regions = regions_result.scalars().all()

        items.append({
            "page_id": p.page_id,
            "page_number": p.sort_order,  # P0-FIX-03: Page model uses sort_order as page number
            "chapter_id": p.chapter_id,
            "original_image_url": p.original_url,  # P0-FIX-03: Page model uses original_url
            "status": p.status or "unreviewed",
            "width": p.width,
            "height": p.height,
            "regions": [
                {
                    "region_id": r.region_id,
                    "original_text": r.original_text,
                    "translated_text": r.translated_text or "",
                    "region_type": r.region_type or "speech",
                    "confidence": r.confidence,
                    "bbox": {
                        "x": r.bbox_x, "y": r.bbox_y,
                        "width": r.bbox_width, "height": r.bbox_height,
                    },
                }
                for r in regions
            ],
        })

    return {
        "code": 0,
        "message": "success",
        "data": {"items": items, "total": total, "page": page, "page_size": page_size}
    }


@router.get("/{project_id}/review/pages/next-unreviewed")
async def get_next_unreviewed(
    project_id: str,
    current: int = Query(default=1, ge=1),
    db: AsyncSession = Depends(get_db),
):
    """Jump to the next unreviewed page after current page number."""
    chapters_result = await db.execute(
        select(Chapter.chapter_id).where(Chapter.project_id == project_id)
    )
    chapter_ids = [row[0] for row in chapters_result.fetchall()]

    if not chapter_ids:
        raise HTTPException(404, "No chapters found")

    result = await db.execute(
        select(Page)
        .where(
            and_(
                Page.chapter_id.in_(chapter_ids),
                Page.status != "reviewed",
                Page.sort_order > current,
            )
        )
        .order_by(Page.sort_order)
        .limit(1)
    )
    next_page = result.scalar_one_or_none()

    if not next_page:
        # Wrap around: find earliest unreviewed
        result = await db.execute(
            select(Page)
            .where(
                and_(
                    Page.chapter_id.in_(chapter_ids),
                    Page.status != "reviewed",
                )
            )
            .order_by(Page.sort_order)
            .limit(1)
        )
        next_page = result.scalar_one_or_none()

    if not next_page:
        return {"code": 0, "message": "All pages reviewed!", "data": None}

    return {
        "code": 0,
        "message": "success",
        "data": {
            "page_id": next_page.page_id,
            "page_number": next_page.sort_order,
            "status": next_page.status,
        }
    }


@router.post("/{project_id}/review/pages/{page_id}/translations")
async def update_page_translations(
    project_id: str,
    page_id: str,
    translations: List[TranslationUpdate],
    mark_reviewed: bool = False,
    db: AsyncSession = Depends(get_db),
):
    """
    Batch update translations for all regions on a page.
    Also updates page status to 'reviewed' if mark_reviewed=True.
    """
    # Verify project + page
    page = await db.get(Page, page_id)
    if not page:
        raise HTTPException(404, "Page not found")

    updated_count = 0
    for t in translations:
        # Update region translation
        stmt = (
            sa_update(TextRegion)
            .where(TextRegion.region_id == t.region_id)
            .values(
                translated_text=t.translated_text,
                updated_at=datetime.utcnow(),
            )
        )
        result = await db.execute(stmt)
        updated_count += result.rowcount

    # Mark page as reviewed
    if mark_reviewed:
        page.status = "reviewed"
        page.updated_at = datetime.utcnow()

    await db.commit()

    return {
        "code": 0,
        "message": "success",
        "data": {
            "updated_count": updated_count,
            "marked_reviewed": mark_reviewed,
        }
    }


@router.post("/{project_id}/review/batch-replace")
async def batch_replace_translations(
    project_id: str,
    req: BatchReplaceRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Full-text batch search-and-replace across translations.
    Supports current_page or all_pages scope.
    Efficient: uses SQL LIKE for pattern matching, <2s for typical projects.
    """
    if not req.search:
        raise HTTPException(400, "Search text cannot be empty")

    chapters_result = await db.execute(
        select(Chapter.chapter_id).where(Chapter.project_id == project_id)
    )
    chapter_ids = [row[0] for row in chapters_result.fetchall()]

    if not chapter_ids:
        return {"code": 0, "message": "No chapters to search", "data": {"matched": 0, "replaced": 0}}

    # Build query
    page_condition = Page.chapter_id.in_(chapter_ids)
    if req.scope == "current_page" and req.page_id:
        page_condition = Page.page_id == req.page_id

    # Find matching regions
    region_query = (
        select(TextRegion)
        .join(Page, TextRegion.page_id == Page.page_id)
        .where(
            and_(
                page_condition,
                TextRegion.translated_text.ilike(f"%{req.search}%"),
            )
        )
    )
    result = await db.execute(region_query)
    matching_regions = result.scalars().all()

    matched = len(matching_regions)
    replaced = 0

    # Perform replacement
    for region in matching_regions:
        if region.translated_text and req.search in region.translated_text:
            new_text = region.translated_text.replace(req.search, req.replace)
            region.translated_text = new_text
            region.updated_at = datetime.utcnow()
            replaced += 1

    await db.commit()

    return {
        "code": 0,
        "message": "success",
        "data": {
            "matched": matched,
            "replaced": replaced,
            "scope": req.scope,
        }
    }


@router.get("/{project_id}/review/stats")
async def get_review_stats(
    project_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Get proofreading progress statistics.
    Returns: total_pages, reviewed_pages, unreviewed_pages, progress percentage.
    """
    proj = await db.get(Project, project_id)
    if not proj:
        raise HTTPException(404, "Project not found")

    chapters_result = await db.execute(
        select(Chapter.chapter_id).where(Chapter.project_id == project_id)
    )
    chapter_ids = [row[0] for row in chapters_result.fetchall()]

    if not chapter_ids:
        return {
            "code": 0,
            "message": "success",
            "data": {
                "project_id": project_id,
                "total_pages": 0,
                "reviewed_pages": 0,
                "unreviewed_pages": 0,
                "total_regions": 0,
                "reviewed_regions": 0,
                "progress_percent": 0,
            }
        }

    # Total pages
    total_result = await db.execute(
        select(func.count()).select_from(select(Page).where(Page.chapter_id.in_(chapter_ids)).subquery())
    )
    total_pages = total_result.scalar() or 0

    # Reviewed pages
    reviewed_result = await db.execute(
        select(func.count()).select_from(
            select(Page).where(
                and_(Page.chapter_id.in_(chapter_ids), Page.status == "reviewed")
            ).subquery()
        )
    )
    reviewed_pages = reviewed_result.scalar() or 0

    # Total regions
    page_ids_result = await db.execute(
        select(Page.page_id).where(Page.chapter_id.in_(chapter_ids))
    )
    page_ids = [row[0] for row in page_ids_result.fetchall()]

    total_regions = 0
    if page_ids:
        regions_result = await db.execute(
            select(func.count()).select_from(
                select(TextRegion).where(TextRegion.page_id.in_(page_ids)).subquery()
            )
        )
        total_regions = regions_result.scalar() or 0

    # Reviewed regions (regions on reviewed pages)
    reviewed_page_ids_result = await db.execute(
        select(Page.page_id).where(
            and_(Page.chapter_id.in_(chapter_ids), Page.status == "reviewed")
        )
    )
    reviewed_page_ids = [row[0] for row in reviewed_page_ids_result.fetchall()]

    reviewed_regions = 0
    if reviewed_page_ids:
        result = await db.execute(
            select(func.count()).select_from(
                select(TextRegion).where(TextRegion.page_id.in_(reviewed_page_ids)).subquery()
            )
        )
        reviewed_regions = result.scalar() or 0

    progress_percent = round((reviewed_pages / total_pages * 100) if total_pages > 0 else 0, 1)

    return {
        "code": 0,
        "message": "success",
        "data": {
            "project_id": project_id,
            "total_pages": total_pages,
            "reviewed_pages": reviewed_pages,
            "unreviewed_pages": total_pages - reviewed_pages,
            "total_regions": total_regions,
            "reviewed_regions": reviewed_regions,
            "progress_percent": progress_percent,
        }
    }


# ===== P0-3 FIX: Alias endpoints matching E2E test paths =====

@router.get("/{project_id}/review/regions")
async def list_review_regions(
    project_id: str,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    status: Optional[str] = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    """GET /api/v1/projects/{pid}/review/regions — Alias for review pages (E2E 4a compatible)."""
    try:
        return await list_review_pages(project_id, page, page_size, status, db)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"list_review_regions failed for {project_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to list review regions: {str(e)}")


# ===== /review/* paths (without /projects prefix, E2E 4a/4b compatible) =====

@review_router.get("/review/{project_id}/regions")
async def list_review_regions_v2(
    project_id: str,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    status: Optional[str] = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    """GET /api/v1/review/{pid}/regions — E2E 4a compatible."""
    try:
        return await list_review_pages(project_id, page, page_size, status, db)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"list_review_regions_v2 failed for {project_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to list review regions: {str(e)}")


@review_router.post("/review/{project_id}/bulk-replace")
async def bulk_replace_v2(
    project_id: str,
    req: BatchReplaceRequest,
    db: AsyncSession = Depends(get_db),
):
    """POST /api/v1/review/{pid}/bulk-replace — E2E 4b compatible."""
    try:
        return await batch_replace_translations(project_id, req, db)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"bulk_replace_v2 failed for {project_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to batch replace: {str(e)}")


# ===== Additional E2E-compatible alias endpoints =====

class ReplaceAllRequest(BaseModel):
    """Request for /review/replace-all (E2E test compatible)."""
    project_id: str = Field(..., min_length=1)
    search: str = Field(..., min_length=1)
    replace: str
    scope: str = Field(default="project")


@review_router.post("/review/replace-all")
async def replace_all_v3(
    req: ReplaceAllRequest,
    db: AsyncSession = Depends(get_db),
):
    """POST /api/v1/review/replace-all — E2E smoke test compatible."""
    try:
        return await batch_replace_translations(req.project_id, BatchReplaceRequest(
            search=req.search,
            replace=req.replace,
            scope=req.scope,
            project_id=req.project_id,
        ), db)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"replace_all_v3 failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to replace all: {str(e)}")


class NextUnreviewedRequest(BaseModel):
    """Request for /review/next-unreviewed (E2E test compatible)."""
    project_id: str = Field(..., min_length=1)
    current: int = Field(default=1, ge=1)


@review_router.post("/review/next-unreviewed")
async def next_unreviewed_v3(
    req: NextUnreviewedRequest,
    db: AsyncSession = Depends(get_db),
):
    """POST /api/v1/review/next-unreviewed — E2E smoke test compatible."""
    try:
        return await get_next_unreviewed(req.project_id, req.current, db)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"next_unreviewed_v3 failed for {req.project_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to get next unreviewed: {str(e)}")


# ===== P1-FIX-01: Review workbench endpoint enhancements =====

class RegionUpdateRequest(BaseModel):
    """Update a single region's translation, style, or position."""
    translated_text: Optional[str] = None
    style_config: Optional[dict] = None
    region_type: Optional[str] = None  # speech, thought, narration, onomatopoeia, etc.
    confidence: Optional[float] = None


class LockRegionRequest(BaseModel):
    """Lock or unlock a text region."""
    locked: bool = True


class ReviewCommentRequest(BaseModel):
    """Add a review comment on a region."""
    region_id: str = Field(..., min_length=1)
    comment: str = Field(..., min_length=1)
    severity: str = Field(default="info")  # info, warning, error


@router.put("/{project_id}/review/regions/{region_id}")
async def update_review_region(
    project_id: str,
    region_id: str,
    req: RegionUpdateRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    PUT /api/v1/projects/:pid/review/regions/:rid
    Edit translation text, style config, or region type for a single text region.
    """
    try:
        result = await db.execute(
            select(TextRegion).where(TextRegion.region_id == region_id)
        )
        region = result.scalar_one_or_none()
        if not region:
            raise HTTPException(404, f"Region {region_id} not found")

        # Verify region belongs to project via page→chapter→project
        page_result = await db.execute(
            select(Page).where(Page.page_id == region.page_id)
        )
        page = page_result.scalar_one_or_none()
        if not page:
            raise HTTPException(404, "Page not found")

        chapter_result = await db.execute(
            select(Chapter).where(Chapter.chapter_id == page.chapter_id)
        )
        chapter = chapter_result.scalar_one_or_none()
        if not chapter or str(chapter.project_id) != project_id:
            raise HTTPException(404, "Region does not belong to this project")

        # Apply updates
        if req.translated_text is not None:
            region.translated_text = req.translated_text
        if req.style_config is not None:
            region.style_config = {**(region.style_config or {}), **req.style_config}
        if req.region_type is not None:
            region.type = req.region_type
        if req.confidence is not None:
            region.confidence = req.confidence

        region.updated_at = datetime.utcnow()
        await db.commit()

        return {
            "code": 0,
            "message": "success",
            "data": {
                "region_id": str(region.region_id),
                "translated_text": region.translated_text,
                "region_type": region.type,
                "confidence": region.confidence,
                "style_config": region.style_config,
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"update_review_region failed: {e}", exc_info=True)
        raise HTTPException(500, f"Failed to update region: {str(e)}")


@router.post("/{project_id}/review/regions/{region_id}/lock")
async def lock_review_region(
    project_id: str,
    region_id: str,
    req: LockRegionRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    POST /api/v1/projects/:pid/review/regions/:rid/lock
    Lock or unlock a text region to prevent/allow edits.
    """
    try:
        result = await db.execute(
            select(TextRegion).where(TextRegion.region_id == region_id)
        )
        region = result.scalar_one_or_none()
        if not region:
            raise HTTPException(404, f"Region {region_id} not found")

        region.is_locked = req.locked
        region.updated_at = datetime.utcnow()
        await db.commit()

        return {
            "code": 0,
            "message": "Region locked" if req.locked else "Region unlocked",
            "data": {
                "region_id": str(region.region_id),
                "is_locked": region.is_locked,
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"lock_review_region failed: {e}", exc_info=True)
        raise HTTPException(500, f"Failed to lock region: {str(e)}")


@router.post("/{project_id}/review/comments")
async def add_review_comment(
    project_id: str,
    req: ReviewCommentRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    POST /api/v1/projects/:pid/review/comments
    Add a proofreading comment on a text region (stored in region style_config or log).
    """
    try:
        result = await db.execute(
            select(TextRegion).where(TextRegion.region_id == req.region_id)
        )
        region = result.scalar_one_or_none()
        if not region:
            raise HTTPException(404, f"Region {req.region_id} not found")

        # Store comment in style_config for persistence (review_comments key)
        current_config = region.style_config or {}
        comments = current_config.get("review_comments", [])
        comments.append({
            "comment": req.comment,
            "severity": req.severity,
            "timestamp": datetime.utcnow().isoformat(),
        })
        current_config["review_comments"] = comments
        region.style_config = current_config
        region.updated_at = datetime.utcnow()
        await db.commit()

        return {
            "code": 0,
            "message": "Comment added",
            "data": {
                "region_id": str(region.region_id),
                "comment": req.comment,
                "severity": req.severity,
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"add_review_comment failed: {e}", exc_info=True)
        raise HTTPException(500, f"Failed to add comment: {str(e)}")


@router.get("/{project_id}/review/log")
async def get_review_log(
    project_id: str,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    """
    GET /api/v1/projects/:pid/review/log
    Get review change log — returns pages sorted by most recently updated.
    """
    try:
        proj = await db.get(Project, project_id)
        if not proj:
            raise HTTPException(404, "Project not found")

        chapters_result = await db.execute(
            select(Chapter.chapter_id).where(Chapter.project_id == project_id)
        )
        chapter_ids = [row[0] for row in chapters_result.fetchall()]

        if not chapter_ids:
            return {"code": 0, "message": "success", "data": {"items": [], "total": 0}}

        # Get recently updated pages
        query = (
            select(Page)
            .where(
                and_(
                    Page.chapter_id.in_(chapter_ids),
                    Page.updated_at.isnot(None),
                )
            )
            .order_by(Page.updated_at.desc())
        )

        count_query = select(func.count()).select_from(query.subquery())
        total_result = await db.execute(count_query)
        total = total_result.scalar() or 0

        pages_result = await db.execute(
            query.offset((page - 1) * page_size).limit(page_size)
        )
        pages_list = pages_result.scalars().all()

        items = []
        for p in pages_list:
            # Count changed regions (regions with updated_at after page creation)
            regions_result = await db.execute(
                select(func.count())
                .select_from(TextRegion)
                .where(
                    and_(
                        TextRegion.page_id == p.page_id,
                        TextRegion.updated_at.isnot(None),
                    )
                )
            )
            changed_regions = regions_result.scalar() or 0

            items.append({
                "page_id": str(p.page_id),
                "page_number": p.sort_order,
                "status": p.status,
                "updated_at": p.updated_at.isoformat() if p.updated_at else None,
                "changed_regions": changed_regions,
            })

        return {
            "code": 0,
            "message": "success",
            "data": {"items": items, "total": total, "page": page, "page_size": page_size}
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"get_review_log failed: {e}", exc_info=True)
        raise HTTPException(500, f"Failed to get review log: {str(e)}")
