from __future__ import annotations
"""
Trash/Recycle Bin API routes.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from common.core.database import get_db
from common.core.response import success_response, error_response
from common.core.security import get_current_user

from ..service.project_service import ProjectService

router = APIRouter()


@router.get("")
async def list_trash(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """List trashed projects."""
    service = ProjectService(db)
    items, total = await service.list_projects(
        user_id=current_user["sub"],
        page=1,
        page_size=100,
        status="trashed",
    )
    return success_response(data={"items": items})


@router.post("/{project_id}/restore")
async def restore_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Restore a trashed project."""
    service = ProjectService(db)
    try:
        result = await service.restore_project(project_id, current_user["sub"])
        return success_response(data=result, message="Project restored")
    except Exception as e:
        return error_response(code=1002, message=str(e), status_code=404)


@router.delete("/{project_id}/permanent")
async def permanent_delete(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Permanently delete a project."""
    service = ProjectService(db)
    try:
        await service.permanent_delete(project_id, current_user["sub"])
        return success_response(message="Project permanently deleted")
    except Exception as e:
        return error_response(code=1002, message=str(e), status_code=404)
