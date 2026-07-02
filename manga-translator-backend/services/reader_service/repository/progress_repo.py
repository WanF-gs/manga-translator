from __future__ import annotations
"""
Reading progress repository.
"""
import uuid
from datetime import datetime, timezone
from typing import Optional, List

from sqlalchemy import select, func, update, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.dialects.postgresql import insert

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from common.models.reading_progress import ReadingProgress


class ProgressRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def upsert_progress(
        self,
        user_id: str,
        project_id: str,
        chapter_id: str,
        page_id: str,
        scroll_position: float = 0.0,
        zoom_level: float = 1.0,
        read_duration: int = 0,
        is_completed: bool = False,
    ) -> ReadingProgress:
        """插入或更新阅读进度 (UPSERT)"""
        now = datetime.now(timezone.utc)

        stmt = insert(ReadingProgress).values(
            progress_id=uuid.uuid4(),
            user_id=uuid.UUID(user_id),
            project_id=uuid.UUID(project_id),
            chapter_id=uuid.UUID(chapter_id),
            page_id=uuid.UUID(page_id),
            scroll_position=scroll_position,
            zoom_level=zoom_level,
            read_duration=read_duration,
            is_completed=is_completed,
            last_read_at=now,
        ).on_conflict_do_update(
            constraint="reading_progress_user_id_page_id_key",
            set_={
                "scroll_position": scroll_position,
                "zoom_level": zoom_level,
                "read_duration": ReadingProgress.read_duration + read_duration,
                "is_completed": is_completed,
                "chapter_id": uuid.UUID(chapter_id),
                "project_id": uuid.UUID(project_id),
                "last_read_at": now,
            },
        )

        await self.db.execute(stmt)
        await self.db.commit()

        # Return the updated row
        result = await self.db.execute(
            select(ReadingProgress).where(
                ReadingProgress.user_id == uuid.UUID(user_id),
                ReadingProgress.page_id == uuid.UUID(page_id),
            )
        )
        return result.scalar_one_or_none()

    async def get_progress_by_page(
        self, user_id: str, page_id: str
    ) -> Optional[ReadingProgress]:
        result = await self.db.execute(
            select(ReadingProgress).where(
                ReadingProgress.user_id == uuid.UUID(user_id),
                ReadingProgress.page_id == uuid.UUID(page_id),
            )
        )
        return result.scalar_one_or_none()

    async def get_progress_by_chapter(
        self, user_id: str, chapter_id: str
    ) -> List[ReadingProgress]:
        result = await self.db.execute(
            select(ReadingProgress)
            .where(
                ReadingProgress.user_id == uuid.UUID(user_id),
                ReadingProgress.chapter_id == uuid.UUID(chapter_id),
            )
            .order_by(ReadingProgress.last_read_at.desc())
        )
        return list(result.scalars().all())

    async def get_progress_by_project(
        self, user_id: str, project_id: str
    ) -> List[ReadingProgress]:
        result = await self.db.execute(
            select(ReadingProgress)
            .where(
                ReadingProgress.user_id == uuid.UUID(user_id),
                ReadingProgress.project_id == uuid.UUID(project_id),
            )
            .order_by(ReadingProgress.last_read_at.desc())
        )
        return list(result.scalars().all())

    async def get_recent_history(
        self, user_id: str, limit: int = 20
    ) -> List[ReadingProgress]:
        result = await self.db.execute(
            select(ReadingProgress)
            .where(ReadingProgress.user_id == uuid.UUID(user_id))
            .order_by(ReadingProgress.last_read_at.desc())
            .limit(limit)
        )
        return list(result.scalars().all())

    async def get_completed_count(
        self, user_id: str, chapter_id: str
    ) -> int:
        result = await self.db.execute(
            select(func.count()).select_from(ReadingProgress).where(
                ReadingProgress.user_id == uuid.UUID(user_id),
                ReadingProgress.chapter_id == uuid.UUID(chapter_id),
                ReadingProgress.is_completed == True,
            )
        )
        return result.scalar() or 0

    async def delete_progress(self, user_id: str, page_id: str) -> bool:
        result = await self.db.execute(
            delete(ReadingProgress).where(
                ReadingProgress.user_id == uuid.UUID(user_id),
                ReadingProgress.page_id == uuid.UUID(page_id),
            )
        )
        await self.db.commit()
        return result.rowcount > 0
