from __future__ import annotations
"""
Project repository.
"""
from typing import Optional, List, Tuple

from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from common.models.project import Project


class ProjectRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def find_by_id(self, project_id: str, user_id: str = None) -> Optional[Project]:
        query = select(Project).where(Project.project_id == project_id)
        if user_id:
            query = query.where(Project.user_id == user_id)
        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    async def list_projects(
        self,
        user_id: str,
        page: int = 1,
        page_size: int = 20,
        status: str = "active",
        keyword: str = None,
        is_favorite: bool = None,
        sort_by: str = "updated_at",
    ) -> Tuple[List[Project], int]:
        conditions = [Project.user_id == user_id]
        if status:
            conditions.append(Project.status == status)
        if keyword:
            conditions.append(Project.name.ilike(f"%{keyword}%"))
        if is_favorite is not None:
            conditions.append(Project.is_favorite == is_favorite)

        # Count
        count_query = select(func.count()).select_from(Project).where(and_(*conditions))
        result = await self.db.execute(count_query)
        total = result.scalar()

        # Query
        query = select(Project).where(and_(*conditions))
        order_col = getattr(Project, sort_by, Project.updated_at)
        query = query.order_by(order_col.desc())
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self.db.execute(query)
        items = result.scalars().all()

        return items, total
