from __future__ import annotations
"""
User profile and settings business logic.
"""
from typing import Dict, Any

from sqlalchemy.ext.asyncio import AsyncSession

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from ..repository.user_repo import UserRepository


class UserService:
    """User profile and settings service."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.user_repo = UserRepository(db)

    async def get_profile(self, user_id: str) -> Dict[str, Any]:
        """Get user profile."""
        user = await self.user_repo.find_by_id(user_id)
        if not user:
            raise ValueError("User not found")

        return {
            "user_id": str(user.user_id),
            "email": user.email,
            "phone": user.phone,
            "nickname": user.nickname,
            "avatar_url": user.avatar_url,
            "plan_type": user.plan_type,
            "premium_expires": user.premium_expires.isoformat() if user.premium_expires else None,
            "stats": {
                "project_count": 0,  # Would need cross-service query
                "completed_pages": 0,
                "vocabulary_count": 0,
            },
            "created_at": user.created_at.isoformat() if user.created_at else None,
        }

    async def update_profile(self, user_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Update user profile (nickname, avatar)."""
        user = await self.user_repo.find_by_id(user_id)
        if not user:
            raise ValueError("User not found")

        if "nickname" in data:
            user.nickname = data["nickname"]
        if "avatar_url" in data:
            user.avatar_url = data["avatar_url"]

        await self.db.flush()

        return {
            "user_id": str(user.user_id),
            "email": user.email,
            "nickname": user.nickname,
            "avatar_url": user.avatar_url,
            "plan_type": user.plan_type,
        }

    async def get_settings(self, user_id: str) -> Dict[str, Any]:
        """Get user settings."""
        user = await self.user_repo.find_by_id(user_id)
        if not user:
            raise ValueError("User not found")

        settings = user.settings or {}
        defaults = {
            "default_engine": "basic",
            "default_target_lang": "zh-CN",
            "default_export_format": "png",
            "default_export_quality": 90,
            "default_font_style": "",
            "auto_preprocess": True,
            "notification_email": True,
            "notification_browser": True,
        }
        return {**defaults, **settings}

    async def update_settings(self, user_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Update user settings (partial update)."""
        user = await self.user_repo.find_by_id(user_id)
        if not user:
            raise ValueError("User not found")

        current = user.settings or {}
        current.update(data)
        user.settings = current
        await self.db.flush()

        return await self.get_settings(user_id)

    async def reset_settings(self, user_id: str) -> Dict[str, Any]:
        """Reset user settings to defaults."""
        user = await self.user_repo.find_by_id(user_id)
        if not user:
            raise ValueError("User not found")

        user.settings = {}
        await self.db.flush()

        return await self.get_settings(user_id)
