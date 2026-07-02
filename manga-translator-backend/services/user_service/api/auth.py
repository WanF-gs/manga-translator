from __future__ import annotations
"""
Authentication API routes.
"""
from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from common.core.database import get_db
from common.core.response import success_response, created_response, error_response
from common.core.security import get_current_user
from common.schemas.auth import RegisterRequest, LoginRequest, RefreshRequest

from ..service.auth_service import AuthService

router = APIRouter()


@router.post("/register", summary="用户注册")
async def register(request: RegisterRequest, db: AsyncSession = Depends(get_db)):
    """Register a new user."""
    auth_service = AuthService(db)
    try:
        result = await auth_service.register(request.model_dump())
        return created_response(data=result, message="Registration successful")
    except Exception as e:
        return error_response(code=1001, message=str(e))


@router.post("/login", summary="用户登录")
async def login(request: LoginRequest, req: Request, db: AsyncSession = Depends(get_db)):
    """Login user."""
    auth_service = AuthService(db)
    try:
        result = await auth_service.login(
            request.model_dump(),
            ip_address=req.client.host if req.client else "",
            user_agent=req.headers.get("User-Agent", ""),
        )
        return success_response(data=result, message="Login successful")
    except Exception as e:
        return error_response(code=2001, message=str(e), status_code=401)


@router.post("/refresh", summary="刷新Access Token")
async def refresh(request: RefreshRequest, db: AsyncSession = Depends(get_db)):
    """Refresh access token."""
    auth_service = AuthService(db)
    try:
        result = await auth_service.refresh_token(request.refresh_token)
        return success_response(data=result, message="Token refreshed")
    except Exception as e:
        return error_response(code=2002, message=str(e), status_code=401)


@router.post("/logout", summary="用户登出")
async def logout(
    req: Request,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Logout current user - revoke refresh token."""
    auth_service = AuthService(db)
    await auth_service.logout(current_user.get("sub", ""))
    return success_response(message="Logged out successfully")
