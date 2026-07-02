from __future__ import annotations
"""
Style presets API routes.
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from common.core.database import get_db
from common.core.response import success_response, created_response, error_response, paginated_response
from common.core.security import get_current_user, get_optional_user

from ..service.preset_service import PresetService

router = APIRouter()


@router.get("")
async def list_presets(
    scope: str = Query("system"),
    category: str = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_optional_user),
):
    """List style presets."""
    service = PresetService(db)
    user_id = current_user.get("sub") if current_user else None
    items = await service.list_presets(scope=scope, category=category, user_id=user_id)
    return success_response(data={"items": items})


@router.post("")
async def create_preset(
    request_data: dict,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Create a style preset."""
    service = PresetService(db)
    try:
        result = await service.create_preset(current_user["sub"], request_data)
        return created_response(data=result, message="Preset created")
    except Exception as e:
        return error_response(code=1001, message=str(e))


@router.put("/{preset_id}")
async def update_preset(
    preset_id: str,
    request_data: dict,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Update a style preset."""
    service = PresetService(db)
    try:
        result = await service.update_preset(preset_id, current_user["sub"], request_data)
        return success_response(data=result, message="Preset updated")
    except Exception as e:
        return error_response(code=1001, message=str(e))


@router.delete("/{preset_id}")
async def delete_preset(
    preset_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Delete a style preset."""
    service = PresetService(db)
    try:
        await service.delete_preset(preset_id, current_user["sub"])
        return success_response(message="Preset deleted")
    except Exception as e:
        return error_response(code=1002, message=str(e), status_code=404)


@router.post("/{preset_id}/apply")
async def apply_preset(
    preset_id: str,
    request_data: dict,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Apply a style preset to specified regions."""
    service = PresetService(db)
    try:
        result = await service.apply_preset(
            preset_id=preset_id,
            user_id=current_user["sub"],
            region_ids=request_data.get("region_ids", []),
        )
        return success_response(data=result, message="Preset applied")
    except Exception as e:
        return error_response(code=1001, message=str(e))
