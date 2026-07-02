from __future__ import annotations
"""
Term repository.
"""
from typing import Optional, List, Tuple

from sqlalchemy import select, func, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from common.models.term_entry import TermEntry


class TermRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def find_by_id(self, term_id: str, user_id: str) -> Optional[TermEntry]:
        result = await self.db.execute(
            select(TermEntry).where(
                and_(TermEntry.term_id == term_id, TermEntry.user_id == user_id)
            )
        )
        return result.scalar_one_or_none()

    async def list_terms(
        self,
        user_id: str,
        page: int = 1,
        page_size: int = 20,
        scope: str = None,
        category: str = None,
        keyword: str = None,
        project_id: str = None,
    ) -> Tuple[List[TermEntry], int]:
        conditions = [TermEntry.user_id == user_id]
        if scope:
            conditions.append(TermEntry.scope == scope)
        if category:
            conditions.append(TermEntry.category == category)
        if keyword:
            conditions.append(TermEntry.source_text.ilike(f"%{keyword}%"))
        if project_id:
            conditions.append(
                or_(TermEntry.project_id == project_id, TermEntry.project_id.is_(None))
            )

        count_query = select(func.count()).select_from(TermEntry).where(and_(*conditions))
        result = await self.db.execute(count_query)
        total = result.scalar()

        query = select(TermEntry).where(and_(*conditions)).order_by(TermEntry.created_at.desc())
        query = query.offset((page - 1) * page_size).limit(page_size)
        result = await self.db.execute(query)
        items = result.scalars().all()

        return items, total

    async def get_terms_for_project(self, project_id: str = None) -> List[TermEntry]:
        """Get all terms for a project (account-level + project-specific)."""
        conditions = []
        if project_id:
            conditions.append(
                or_(TermEntry.project_id == project_id, TermEntry.project_id.is_(None))
            )
        query = select(TermEntry)
        if conditions:
            query = query.where(and_(*conditions))
        result = await self.db.execute(query)
        return result.scalars().all()
