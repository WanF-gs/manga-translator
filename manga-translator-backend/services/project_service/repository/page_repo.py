from __future__ import annotations
"""
Page repository.
"""
from typing import Optional, List, Tuple

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from common.models.page import Page
from common.models.chapter import Chapter
from common.models.text_region import TextRegion


class PageRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def find_by_id(self, page_id: str) -> Optional[Page]:
        result = await self.db.execute(select(Page).where(Page.page_id == page_id))
        return result.scalar_one_or_none()

    async def find_chapter_by_id(self, chapter_id: str) -> Optional[Chapter]:
        result = await self.db.execute(
            select(Chapter).where(Chapter.chapter_id == chapter_id)
        )
        return result.scalar_one_or_none()

    async def get_max_sort_order(self, chapter_id: str) -> int:
        result = await self.db.execute(
            select(func.coalesce(func.max(Page.sort_order), 0))
            .where(Page.chapter_id == chapter_id)
        )
        return result.scalar() or 0

    async def list_pages(
        self,
        chapter_id: str,
        page: int = 1,
        page_size: int = 50,
        status: str = None,
    ) -> Tuple[List[Page], int]:
        conditions = [Page.chapter_id == chapter_id]
        if status:
            conditions.append(Page.status == status)

        count_query = select(func.count()).select_from(Page).where(*conditions)
        result = await self.db.execute(count_query)
        total = result.scalar()

        query = select(Page).where(*conditions).order_by(Page.sort_order)
        query = query.offset((page - 1) * page_size).limit(page_size)
        result = await self.db.execute(query)
        items = result.scalars().all()

        return items, total

    async def get_regions_by_page(self, page_id: str) -> List[TextRegion]:
        result = await self.db.execute(
            select(TextRegion)
            .where(TextRegion.page_id == page_id)
            .order_by(TextRegion.sort_order)
        )
        return result.scalars().all()

    async def find_region_by_id(self, region_id: str) -> Optional[TextRegion]:
        result = await self.db.execute(
            select(TextRegion).where(TextRegion.region_id == region_id)
        )
        return result.scalar_one_or_none()
