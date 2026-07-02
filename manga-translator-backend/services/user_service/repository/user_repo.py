from __future__ import annotations
"""
User repository - database queries for users and sessions.
"""
from typing import Optional

from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from common.models.user import User
from common.models.user_session import UserSession


class UserRepository:
    """User and session database operations."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def find_by_id(self, user_id: str) -> Optional[User]:
        """Find user by ID."""
        result = await self.db.execute(
            select(User).where(User.user_id == user_id)
        )
        return result.scalar_one_or_none()

    async def find_by_email(self, email: str) -> Optional[User]:
        """Find user by email."""
        if not email:
            return None
        result = await self.db.execute(
            select(User).where(User.email == email)
        )
        return result.scalar_one_or_none()

    async def find_by_phone(self, phone: str) -> Optional[User]:
        """Find user by phone."""
        if not phone:
            return None
        result = await self.db.execute(
            select(User).where(User.phone == phone)
        )
        return result.scalar_one_or_none()

    async def find_by_email_or_phone(self, email: str = None, phone: str = None) -> Optional[User]:
        """Find user by email or phone."""
        user = await self.find_by_email(email)
        if user:
            return user
        return await self.find_by_phone(phone)

    async def find_session_by_token_hash(self, token_hash: str) -> Optional[UserSession]:
        """Find session by refresh token hash."""
        result = await self.db.execute(
            select(UserSession).where(UserSession.refresh_token_hash == token_hash)
        )
        return result.scalar_one_or_none()

    async def delete_sessions_by_user_id(self, user_id: str) -> None:
        """Delete all sessions for a user."""
        await self.db.execute(
            delete(UserSession).where(UserSession.user_id == user_id)
        )
