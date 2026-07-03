from __future__ import annotations
"""
Authentication business logic.
"""
import hashlib
import uuid
from datetime import datetime, timedelta, timezone
from typing import Dict, Any

from sqlalchemy.ext.asyncio import AsyncSession

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from common.core.security import (
    hash_password,
    verify_password,
    create_access_token,
    create_refresh_token,
)
from common.models.user import User
from common.models.user_session import UserSession

from ..repository.user_repo import UserRepository


class AuthService:
    """Authentication service."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.user_repo = UserRepository(db)

    async def _ensure_plan_validity(self, user: User) -> None:
        """如果专业版已过期，自动降级为免费版。"""
        if user.plan_type == "premium" and user.premium_expires:
            now = datetime.now(timezone.utc)
            if user.premium_expires.tzinfo is None:
                now = datetime.utcnow()
            if user.premium_expires < now:
                user.plan_type = "free"
                user.premium_expires = None
                await self.db.flush()

    async def register(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Register a new user."""
        email = data.get("email")
        phone = data.get("phone")
        password = data.get("password", "")
        nickname = data.get("nickname", "User")

        if not email and not phone:
            raise ValueError("Email or phone is required")
        if not password or len(password) < 6:
            raise ValueError("Password must be at least 6 characters")

        # Check uniqueness
        existing = await self.user_repo.find_by_email_or_phone(email, phone)
        if existing:
            raise ValueError("Email or phone already registered")

        # Create user
        user = User(
            user_id=uuid.uuid4(),
            email=email,
            phone=phone,
            password_hash=hash_password(password),
            nickname=nickname,
            plan_type="free",
        )
        self.db.add(user)
        await self.db.flush()

        # Generate tokens
        access_token = create_access_token(str(user.user_id), user.plan_type)
        refresh_token = create_refresh_token(str(user.user_id))

        # Create session
        session = UserSession(
            session_id=uuid.uuid4(),
            user_id=user.user_id,
            refresh_token_hash=hashlib.sha256(refresh_token.encode()).hexdigest(),
            expires_at=datetime.now(timezone.utc) + timedelta(seconds=604800),
        )
        self.db.add(session)
        await self.db.flush()

        return {
            "user": {
                "user_id": str(user.user_id),
                "email": user.email,
                "nickname": user.nickname,
                "plan_type": user.plan_type,
                "created_at": user.created_at.isoformat() if user.created_at else None,
            },
            "tokens": {
                "access_token": access_token,
                "refresh_token": refresh_token,
                "expires_in": 7200,
            },
        }

    async def login(self, data: Dict[str, Any], ip_address: str = "", user_agent: str = "") -> Dict[str, Any]:
        """Login a user."""
        account = data.get("account", "")
        password = data.get("password", "")

        # Find user by email or phone
        user = await self.user_repo.find_by_email_or_phone(account, account)
        if not user:
            raise ValueError("Invalid credentials")

        # Verify password
        if not verify_password(password, user.password_hash):
            raise ValueError("Invalid credentials")

        # 自动处理专业版过期降级
        await self._ensure_plan_validity(user)

        # Generate tokens
        access_token = create_access_token(str(user.user_id), user.plan_type)
        refresh_token = create_refresh_token(str(user.user_id))

        # Create session
        session = UserSession(
            session_id=uuid.uuid4(),
            user_id=user.user_id,
            refresh_token_hash=hashlib.sha256(refresh_token.encode()).hexdigest(),
            device_info=user_agent,
            ip_address=ip_address,
            expires_at=datetime.now(timezone.utc) + timedelta(seconds=604800),
        )
        self.db.add(session)
        await self.db.flush()

        return {
            "user": {
                "user_id": str(user.user_id),
                "email": user.email,
                "nickname": user.nickname,
                "plan_type": user.plan_type,
            },
            "tokens": {
                "access_token": access_token,
                "refresh_token": refresh_token,
                "expires_in": 7200,
            },
        }

    async def refresh_token(self, refresh_token: str) -> Dict[str, Any]:
        """Refresh access token using a valid refresh token."""
        if not refresh_token:
            raise ValueError("Refresh token is required")

        # Find session by hashed refresh token
        token_hash = hashlib.sha256(refresh_token.encode()).hexdigest()
        session = await self.user_repo.find_session_by_token_hash(token_hash)
        if not session:
            raise ValueError("Invalid refresh token")

        # Check expiry
        if session.expires_at and session.expires_at < datetime.now(timezone.utc):
            raise ValueError("Refresh token expired")

        # Get user
        user = await self.user_repo.find_by_id(str(session.user_id))
        if not user:
            raise ValueError("User not found")

        # 自动处理专业版过期降级
        await self._ensure_plan_validity(user)

        # Token rotation: delete old session, create new
        await self.db.delete(session)

        new_access_token = create_access_token(str(user.user_id), user.plan_type)
        new_refresh_token = create_refresh_token(str(user.user_id))

        new_session = UserSession(
            session_id=uuid.uuid4(),
            user_id=user.user_id,
            refresh_token_hash=hashlib.sha256(new_refresh_token.encode()).hexdigest(),
            expires_at=datetime.now(timezone.utc) + timedelta(seconds=604800),
        )
        self.db.add(new_session)
        await self.db.flush()

        return {
            "access_token": new_access_token,
            "refresh_token": new_refresh_token,
            "expires_in": 7200,
        }

    async def logout(self, user_id: str) -> None:
        """Logout user - revoke all sessions."""
        await self.user_repo.delete_sessions_by_user_id(user_id)
