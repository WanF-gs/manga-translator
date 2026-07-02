from __future__ import annotations
"""
User profile API routes.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from common.core.database import get_db
from common.core.response import success_response, error_response
from common.core.security import get_current_user
from common.schemas.auth import ProfileUpdateRequest, SettingsUpdateRequest

from ..service.user_service import UserService

router = APIRouter()


@router.get("/me", summary="获取当前用户资料（别名）")
async def get_my_profile(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """B8 FIX: Alias for /user/profile — returns current user's profile via /user/me."""
    user_service = UserService(db)
    try:
        profile = await user_service.get_profile(current_user["sub"])
        return success_response(data=profile)
    except Exception as e:
        return error_response(code=1002, message=str(e), status_code=404)


@router.get("/profile", summary="获取用户资料")
async def get_profile(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Get current user's profile."""
    user_service = UserService(db)
    try:
        profile = await user_service.get_profile(current_user["sub"])
        return success_response(data=profile)
    except Exception as e:
        return error_response(code=1002, message=str(e), status_code=404)


@router.put("/profile", summary="更新用户资料")
async def update_profile(
    request: ProfileUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Update user profile (nickname, avatar)."""
    user_service = UserService(db)
    try:
        # 过滤 None 字段用于部分更新
        update_data = {k: v for k, v in request.model_dump().items() if v is not None}
        profile = await user_service.update_profile(current_user["sub"], update_data)
        return success_response(data=profile, message="Profile updated")
    except Exception as e:
        return error_response(code=1001, message=str(e))


@router.get("/settings", summary="获取用户设置")
async def get_settings(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Get user settings."""
    user_service = UserService(db)
    try:
        settings = await user_service.get_settings(current_user["sub"])
        return success_response(data=settings)
    except Exception as e:
        return error_response(code=1002, message=str(e), status_code=404)


@router.put("/settings", summary="更新用户设置")
async def update_settings(
    request: SettingsUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Update user settings (partial update)."""
    user_service = UserService(db)
    try:
        settings = await user_service.update_settings(current_user["sub"], request.settings)
        return success_response(data=settings, message="Settings updated")
    except Exception as e:
        return error_response(code=1001, message=str(e))


@router.delete("/settings", summary="重置用户设置")
async def reset_settings(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Reset user settings to defaults."""
    user_service = UserService(db)
    try:
        settings = await user_service.reset_settings(current_user["sub"])
        return success_response(data=settings, message="Settings reset to defaults")
    except Exception as e:
        return error_response(code=1001, message=str(e))
