from __future__ import annotations
"""
Chapter CRUD API routes.
"""
from typing import List

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from common.core.database import get_db
from common.core.response import success_response, created_response, error_response
from common.core.security import get_current_user

from ..service.chapter_service import ChapterService
from ..service.page_service import PageService

router = APIRouter()


class PageSortRequest(BaseModel):
    """Request for bulk page reordering."""
    page_ids: List[str] = Field(..., min_length=1, description="Ordered list of page IDs")


@router.post("/{project_id}/chapters")
async def create_chapter(
    project_id: str,
    request_data: dict,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Create a new chapter."""
    service = ChapterService(db)
    try:
        result = await service.create_chapter(project_id, current_user["sub"], request_data)
        return created_response(data=result, message="Chapter created")
    except Exception as e:
        return error_response(code=1001, message=str(e))


@router.put("/{chapter_id}")
async def update_chapter(
    chapter_id: str,
    request_data: dict,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Update a chapter."""
    service = ChapterService(db)
    try:
        result = await service.update_chapter(chapter_id, current_user["sub"], request_data)
        return success_response(data=result, message="Chapter updated")
    except Exception as e:
        return error_response(code=1001, message=str(e))


@router.delete("/{chapter_id}")
async def delete_chapter(
    chapter_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Delete a chapter."""
    service = ChapterService(db)
    try:
        await service.delete_chapter(chapter_id, current_user["sub"])
        return success_response(message="Chapter deleted")
    except Exception as e:
        return error_response(code=1002, message=str(e), status_code=404)


@router.put("/{chapter_id}/sort")
async def sort_chapter(
    chapter_id: str,
    request_data: dict,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Update chapter sort order."""
    service = ChapterService(db)
    try:
        result = await service.update_chapter(chapter_id, current_user["sub"], {"sort_order": request_data.get("sort_order")})
        return success_response(data=result, message="Sort order updated")
    except Exception as e:
        return error_response(code=1001, message=str(e))


@router.put("/{chapter_id}/pages/sort")
async def bulk_sort_pages(
    chapter_id: str,
    req: PageSortRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """PUT /api/v1/chapters/{cid}/pages/sort — Bulk reorder pages in a chapter."""
    service = PageService(db)
    try:
        result = await service.bulk_update_sort(chapter_id, req.page_ids)
        return success_response(data=result, message=f"Reordered {result['updated_count']} page(s)")
    except ValueError as e:
        return error_response(code=4001, message=str(e), status_code=404)
    except Exception as e:
        return error_response(code=5000, message=f"Sort failed: {str(e)}")
