from __future__ import annotations
"""
Project business logic.
"""
import uuid
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Tuple

from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from common.models.project import Project
from common.models.chapter import Chapter
from common.models.page import Page
from ..repository.project_repo import ProjectRepository
from ..repository.chapter_repo import ChapterRepository


class ProjectService:
    """Project CRUD service."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.repo = ProjectRepository(db)

    async def _batch_count_stats(
        self, project_ids: list
    ) -> Tuple[dict, dict, dict]:
        """Batch query chapter/page/completed counts per project."""
        if not project_ids:
            return {}, {}, {}

        # Count chapters per project
        ch_stmt = (
            select(Chapter.project_id, func.count(Chapter.chapter_id))
            .where(Chapter.project_id.in_(project_ids))
            .group_by(Chapter.project_id)
        )
        ch_result = await self.db.execute(ch_stmt)
        chapter_counts = {str(row[0]): row[1] for row in ch_result}

        # Count pages per project (through chapters join)
        pg_stmt = (
            select(Chapter.project_id, func.count(Page.page_id))
            .join(Page, Chapter.chapter_id == Page.chapter_id)
            .where(Chapter.project_id.in_(project_ids))
            .group_by(Chapter.project_id)
        )
        pg_result = await self.db.execute(pg_stmt)
        page_counts = {str(row[0]): row[1] for row in pg_result}

        # Count completed pages per project
        cp_stmt = (
            select(Chapter.project_id, func.count(Page.page_id))
            .join(Page, Chapter.chapter_id == Page.chapter_id)
            .where(
                Chapter.project_id.in_(project_ids),
                Page.status == "completed",
            )
            .group_by(Chapter.project_id)
        )
        cp_result = await self.db.execute(cp_stmt)
        completed_counts = {str(row[0]): row[1] for row in cp_result}

        return chapter_counts, page_counts, completed_counts

    async def list_projects(
        self,
        user_id: str,
        page: int = 1,
        page_size: int = 20,
        status: str = "active",
        keyword: str = None,
        is_favorite: bool = None,
        sort_by: str = "updated_at",
    ) -> Tuple[List[Dict[str, Any]], int]:
        """List projects with pagination and filtering."""
        projects, total = await self.repo.list_projects(
            user_id=user_id,
            page=page,
            page_size=page_size,
            status=status,
            keyword=keyword,
            is_favorite=is_favorite,
            sort_by=sort_by,
        )

        if not projects:
            return [], 0

        # Batch query stats for all projects on this page
        project_ids = [p.project_id for p in projects]
        chapter_counts, page_counts, completed_counts = await self._batch_count_stats(project_ids)

        items = []
        for p in projects:
            pid = str(p.project_id)
            pg_count = page_counts.get(pid, 0)
            comp_count = completed_counts.get(pid, 0)
            items.append({
                "project_id": pid,
                "name": p.name,
                "source_lang": p.source_lang,
                "cover_url": p.cover_url,
                "is_favorite": p.is_favorite,
                "status": p.status,
                "chapter_count": chapter_counts.get(pid, 0),
                "page_count": pg_count,
                "completed_count": comp_count,
                "completion_percentage": round(comp_count / pg_count * 100) if pg_count > 0 else 0,
                "created_at": p.created_at.isoformat() if p.created_at else None,
                "updated_at": p.updated_at.isoformat() if p.updated_at else None,
            })

        return items, total

    async def create_project(self, user_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a new project."""
        project = Project(
            project_id=uuid.uuid4(),
            user_id=user_id,
            name=data.get("name", "Untitled"),
            source_lang=data.get("source_lang", "ja"),
            default_target_lang=data.get("default_target_lang", "zh-CN"),
            is_favorite=False,
            status="active",
        )
        self.db.add(project)
        await self.db.flush()

        return {
            "project_id": str(project.project_id),
            "name": project.name,
            "source_lang": project.source_lang,
            "default_target_lang": project.default_target_lang,
            "user_id": str(project.user_id),
            "is_favorite": project.is_favorite,
            "status": project.status,
            "created_at": project.created_at.isoformat() if project.created_at else None,
        }

    async def get_project(self, project_id: str, user_id: str) -> Dict[str, Any]:
        """Get project details.""" 
        project = await self.repo.find_by_id(project_id, user_id)
        if not project:
            raise ValueError("Project not found")

        # Get chapters for this project
        chapter_repo = ChapterRepository(self.db)
        chapters = await chapter_repo.find_by_project_id(project_id)

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

        chapters_list = []
        for ch in chapters:
            chapters_list.append({
                "chapter_id": str(ch.chapter_id),
                "project_id": str(ch.project_id),
                "name": ch.name,
                "sort_order": ch.sort_order,
                "page_count": pg_counts.get(str(ch.chapter_id), 0),
                "status": getattr(ch, 'status', 'pending'),
                "created_at": ch.created_at.isoformat() if ch.created_at else None,
                "updated_at": ch.updated_at.isoformat() if ch.updated_at else None,
            })

        # Compute aggregate counts
        chapter_count = len(chapters_list)
        page_count = sum(pg_counts.values()) if pg_counts else 0

        # Count completed pages
        completed_count = 0
        if ch_ids:
            cp_stmt = (
                select(func.count(Page.page_id))
                .where(
                    Page.chapter_id.in_(ch_ids),
                    Page.status == "completed",
                )
            )
            cp_result = await self.db.execute(cp_stmt)
            completed_count = cp_result.scalar() or 0

        return {
            "project_id": str(project.project_id),
            "name": project.name,
            "source_lang": project.source_lang,
            "default_target_lang": project.default_target_lang,
            "cover_url": project.cover_url,
            "is_favorite": project.is_favorite,
            "status": project.status,
            "chapter_count": chapter_count,
            "page_count": page_count,
            "completed_count": completed_count,
            "completion_percentage": round(completed_count / page_count * 100) if page_count > 0 else 0,
            "chapters": chapters_list,
            "created_at": project.created_at.isoformat() if project.created_at else None,
            "updated_at": project.updated_at.isoformat() if project.updated_at else None,
        }

    async def update_project(self, project_id: str, user_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Update a project."""
        project = await self.repo.find_by_id(project_id, user_id)
        if not project:
            raise ValueError("Project not found")

        if "name" in data:
            project.name = data["name"]
        if "cover_url" in data:
            project.cover_url = data["cover_url"]
        if "is_favorite" in data:
            project.is_favorite = data["is_favorite"]

        await self.db.flush()

        return {
            "project_id": str(project.project_id),
            "name": project.name,
            "cover_url": project.cover_url,
            "is_favorite": project.is_favorite,
            "status": project.status,
        }

    async def trash_project(self, project_id: str, user_id: str) -> Dict[str, Any]:
        """Move project to trash."""
        project = await self.repo.find_by_id(project_id, user_id)
        if not project:
            raise ValueError("Project not found")

        project.status = "trashed"
        project.trashed_at = datetime.now(timezone.utc)
        await self.db.flush()

        auto_delete = project.trashed_at + timedelta(days=30)
        return {
            "trashed_at": project.trashed_at.isoformat(),
            "auto_delete_at": auto_delete.isoformat(),
        }

    async def restore_project(self, project_id: str, user_id: str) -> Dict[str, Any]:
        """Restore a trashed project."""
        project = await self.repo.find_by_id(project_id, user_id)
        if not project:
            raise ValueError("Project not found")
        if project.status != "trashed":
            raise ValueError("Project is not in trash")

        project.status = "active"
        project.trashed_at = None
        await self.db.flush()

        return {"project_id": str(project.project_id), "status": project.status}

    async def permanent_delete(self, project_id: str, user_id: str) -> None:
        """Permanently delete a project."""
        project = await self.repo.find_by_id(project_id, user_id)
        if not project:
            raise ValueError("Project not found")
        await self.db.delete(project)
        await self.db.flush()
