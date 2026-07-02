from __future__ import annotations
"""
Project CRUD API routes.
"""
from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from common.core.database import get_db
from common.core.response import success_response, created_response, error_response, paginated_response
from common.core.security import get_current_user

from ..service.project_service import ProjectService
from ..service.chapter_service import ChapterService

router = APIRouter()


@router.get("")
async def list_projects(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: str = Query("active"),
    keyword: str = Query(None),
    is_favorite: bool = Query(None),
    sort_by: str = Query("updated_at"),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """List user's projects."""
    service = ProjectService(db)
    items, total = await service.list_projects(
        user_id=current_user["sub"],
        page=page,
        page_size=page_size,
        status=status,
        keyword=keyword,
        is_favorite=is_favorite,
        sort_by=sort_by,
    )
    return paginated_response(items=items, page=page, page_size=page_size, total=total)


@router.post("")
async def create_project(
    request_data: dict,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Create a new project."""
    service = ProjectService(db)
    try:
        result = await service.create_project(current_user["sub"], request_data)
        return created_response(data=result, message="Project created")
    except Exception as e:
        return error_response(code=1001, message=str(e))


@router.get("/{project_id}")
async def get_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Get project details with chapters."""
    service = ProjectService(db)
    try:
        result = await service.get_project(project_id, current_user["sub"])
        return success_response(data=result)
    except Exception as e:
        return error_response(code=1002, message=str(e), status_code=404)


@router.get("/{project_id}/chapters")
async def get_project_chapters(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Get chapters list for a project."""
    service = ChapterService(db)
    try:
        result = await service.get_chapters(project_id, current_user["sub"])
        return success_response(data=result)
    except Exception as e:
        return error_response(code=1002, message=str(e), status_code=404)


@router.post("/{project_id}/chapters")
async def create_project_chapter(
    project_id: str,
    request_data: dict,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """B2 FIX: Create a new chapter under a project via /api/v1/projects/{pid}/chapters."""
    service = ChapterService(db)
    try:
        result = await service.create_chapter(project_id, current_user["sub"], request_data)
        return created_response(data=result, message="Chapter created")
    except Exception as e:
        return error_response(code=1001, message=str(e))


@router.put("/{project_id}")
async def update_project(
    project_id: str,
    request_data: dict,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Update a project."""
    service = ProjectService(db)
    try:
        result = await service.update_project(project_id, current_user["sub"], request_data)
        return success_response(data=result, message="Project updated")
    except Exception as e:
        return error_response(code=1001, message=str(e))


@router.delete("/{project_id}")
async def delete_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Move project to trash."""
    service = ProjectService(db)
    try:
        result = await service.trash_project(project_id, current_user["sub"])
        return success_response(data=result, message="Project moved to trash")
    except Exception as e:
        return error_response(code=1002, message=str(e), status_code=404)
