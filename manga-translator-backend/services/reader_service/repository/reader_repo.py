from __future__ import annotations
"""阅读数据仓库"""
from typing import Optional, List, Tuple
import uuid

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))

from common.models.project import Project
from common.models.chapter import Chapter
from common.models.page import Page
from common.models.text_region import TextRegion


class ReaderRepo:
    """阅读数据仓库 - 提供阅读所需的数据查询"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_project_detail(self, project_id: str, user_id: str) -> Optional[dict]:
        """获取项目阅读详情"""
        result = await self.db.execute(
            select(Project).where(
                Project.project_id == uuid.UUID(project_id),
                Project.user_id == uuid.UUID(user_id),
                Project.status == "active",
            )
        )
        project = result.scalar_one_or_none()
        if not project:
            return None

        # 获取章节列表
        chapters_result = await self.db.execute(
            select(Chapter)
            .where(Chapter.project_id == uuid.UUID(project_id))
            .order_by(Chapter.sort_order.asc())
        )
        chapters = list(chapters_result.scalars().all())

        chapter_list = []
        for ch in chapters:
            # 统计每章页面数
            page_count_result = await self.db.execute(
                select(func.count()).select_from(Page).where(
                    Page.chapter_id == ch.chapter_id
                )
            )
            page_count = page_count_result.scalar() or 0

            chapter_list.append({
                "chapter_id": str(ch.chapter_id),
                "name": ch.name,
                "sort_order": ch.sort_order,
                "page_count": page_count,
                "created_at": ch.created_at.isoformat() if ch.created_at else None,
            })

        return {
            "project_id": str(project.project_id),
            "name": project.name,
            "source_lang": project.source_lang,
            "cover_url": project.cover_url,
            "chapters": chapter_list,
        }

    async def get_chapter_pages(
        self, chapter_id: str, page: int = 1, page_size: int = 30
    ) -> Tuple[List[dict], int]:
        """获取章节的页面列表（阅读视图）"""
        # 总数
        count_result = await self.db.execute(
            select(func.count()).select_from(Page).where(
                Page.chapter_id == uuid.UUID(chapter_id)
            )
        )
        total = count_result.scalar() or 0

        # 页面列表
        result = await self.db.execute(
            select(Page)
            .where(Page.chapter_id == uuid.UUID(chapter_id))
            .order_by(Page.sort_order.asc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        pages = list(result.scalars().all())

        page_list = []
        for p in pages:
            page_list.append({
                "page_id": str(p.page_id),
                "original_url": p.original_url,
                "processed_url": p.processed_url,
                "thumbnail_url": p.thumbnail_url,
                "sort_order": p.sort_order,
                "status": p.status,
                "width": p.width,
                "height": p.height,
            })

        return page_list, total

    async def get_page_with_regions(self, page_id: str) -> Optional[dict]:
        """获取页面详情及文字区域（阅读视图带翻译）"""
        result = await self.db.execute(
            select(Page).where(Page.page_id == uuid.UUID(page_id))
        )
        page = result.scalar_one_or_none()
        if not page:
            return None

        # 获取文字区域
        regions_result = await self.db.execute(
            select(TextRegion)
            .where(TextRegion.page_id == uuid.UUID(page_id))
            .order_by(TextRegion.sort_order.asc())
        )
        regions = list(regions_result.scalars().all())

        region_list = []
        for r in regions:
            region_list.append({
                "region_id": str(r.region_id),
                "type": r.type,
                "boundary": r.boundary,
                "original_text": r.original_text,
                "translated_text": r.translated_text,
                "confidence": r.confidence,
                "is_locked": r.is_locked,
            })

        return {
            "page_id": str(page.page_id),
            "chapter_id": str(page.chapter_id),
            "original_url": page.original_url,
            "processed_url": page.processed_url,
            "width": page.width,
            "height": page.height,
            "status": page.status,
            "regions": region_list,
        }

    async def get_reading_progress(self, user_id: str, project_id: str) -> Optional[dict]:
        """获取用户阅读进度 - 从阅读历史表查询（MVP: 返回第一章第一页）"""
        # 查找项目的第一章
        chapters_result = await self.db.execute(
            select(Chapter)
            .where(Chapter.project_id == uuid.UUID(project_id))
            .order_by(Chapter.sort_order.asc())
            .limit(1)
        )
        first_chapter = chapters_result.scalar_one_or_none()

        if not first_chapter:
            return None

        # 查找第一章第一页
        pages_result = await self.db.execute(
            select(Page)
            .where(Page.chapter_id == first_chapter.chapter_id)
            .order_by(Page.sort_order.asc())
            .limit(1)
        )
        first_page = pages_result.scalar_one_or_none()

        if not first_page:
            return None

        return {
            "project_id": project_id,
            "chapter_id": str(first_chapter.chapter_id),
            "page_id": str(first_page.page_id) if first_page else None,
            "chapter_index": 0,
            "page_index": 0,
        }
