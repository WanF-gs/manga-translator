from __future__ import annotations
"""
FastAPI dependency injection helpers.
"""
from typing import Any, Dict

from sqlalchemy.ext.asyncio import AsyncSession

from .database import get_db
from .security import get_current_user, get_optional_user


class Dependencies:
    """Centralized dependency injection container."""

    @staticmethod
    async def get_db() -> AsyncSession:
        """Get async database session."""
        async for session in get_db():
            yield session

    @staticmethod
    async def get_current_user(user: Dict[str, Any] = None) -> Dict[str, Any]:
        """Get the current authenticated user."""
        return user  # resolved by FastAPI dependency system
