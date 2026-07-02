from __future__ import annotations
"""
Chapter repository.
"""
from typing import Optional, List
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from common.models.chapter import Chapter


class ChapterRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def find_by_id(self, chapter_id: str) -> Optional[Chapter]:
        result = await self.db.execute(select(Chapter).where(Chapter.chapter_id == chapter_id))
        return result.scalar_one_or_none()

    async def find_by_project_id(self, project_id: str) -> List[Chapter]:
        result = await self.db.execute(
            select(Chapter)
            .where(Chapter.project_id == project_id)
            .order_by(Chapter.sort_order.asc())
        )
        return list(result.scalars().all())

    async def get_max_sort_order(self, project_id: str) -> int:
        result = await self.db.execute(
            select(func.coalesce(func.max(Chapter.sort_order), 0))
            .where(Chapter.project_id == project_id)
        )
        return result.scalar() or 0
