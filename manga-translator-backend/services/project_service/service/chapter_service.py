from __future__ import annotations
"""
Chapter business logic.
"""
import uuid
from typing import Dict, Any

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from common.models.chapter import Chapter
from common.models.page import Page
from ..repository.project_repo import ProjectRepository
from ..repository.chapter_repo import ChapterRepository


class ChapterService:
    """Chapter CRUD service."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.project_repo = ProjectRepository(db)
        self.chapter_repo = ChapterRepository(db)

    async def create_chapter(self, project_id: str, user_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a new chapter."""
        project = await self.project_repo.find_by_id(project_id, user_id)
        if not project:
            raise ValueError("Project not found")

        # Get next sort order
        max_order = await self.chapter_repo.get_max_sort_order(project_id)

        chapter = Chapter(
            chapter_id=uuid.uuid4(),
            project_id=project_id,
            name=data.get("name", "New Chapter"),
            sort_order=max_order + 1,
        )
        self.db.add(chapter)
        await self.db.flush()

        return {
            "chapter_id": str(chapter.chapter_id),
            "project_id": str(chapter.project_id),
            "name": chapter.name,
            "sort_order": chapter.sort_order,
            "created_at": chapter.created_at.isoformat() if chapter.created_at else None,
        }

    async def update_chapter(self, chapter_id: str, user_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Update a chapter."""
        chapter = await self.chapter_repo.find_by_id(chapter_id)
        if not chapter:
            raise ValueError("Chapter not found")

        if "name" in data:
            chapter.name = data["name"]
        if "sort_order" in data:
            chapter.sort_order = data["sort_order"]

        await self.db.flush()

        return {
            "chapter_id": str(chapter.chapter_id),
            "name": chapter.name,
            "sort_order": chapter.sort_order,
        }

    async def get_chapters(self, project_id: str, user_id: str) -> list:
        """Get all chapters for a project."""
        project = await self.project_repo.find_by_id(project_id, user_id)
        if not project:
            raise ValueError("Project not found")
        chapters = await self.chapter_repo.find_by_project_id(project_id)

        # Batch query page counts per chapter
        ch_ids = [ch.chapter_id for ch in chapters]
        pg_counts = {}
        if ch_ids:
            pg_stmt = (
                select(Page.chapter_id, func.count(Page.page_id))
                .where(Page.chapter_id.in_(ch_ids))
                .group_by(Page.chapter_id)
            )
            pg_result = await self.db.execute(pg_stmt)
            pg_counts = {str(row[0]): row[1] for row in pg_result}

        return [
            {
                "chapter_id": str(ch.chapter_id),
                "project_id": str(ch.project_id),
                "name": ch.name,
                "sort_order": ch.sort_order,
                "page_count": pg_counts.get(str(ch.chapter_id), 0),
                "status": getattr(ch, 'status', 'pending'),
                "created_at": ch.created_at.isoformat() if ch.created_at else None,
                "updated_at": ch.updated_at.isoformat() if ch.updated_at else None,
            }
            for ch in chapters
        ]

    async def delete_chapter(self, chapter_id: str, user_id: str) -> None:
        """Delete a chapter."""
        chapter = await self.chapter_repo.find_by_id(chapter_id)
        if not chapter:
            raise ValueError("Chapter not found")
        await self.db.delete(chapter)
        await self.db.flush()
