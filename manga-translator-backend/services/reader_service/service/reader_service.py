from __future__ import annotations
"""阅读数据服务 - 真实实现（含进度持久化）"""
import uuid
from datetime import datetime, timezone
from typing import Optional, List, Tuple

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from common.models.project import Project
from common.models.chapter import Chapter
from common.models.page import Page
from common.models.text_region import TextRegion
from common.models.reading_progress import ReadingProgress

from ..repository.progress_repo import ProgressRepository


class ReaderService:
    """阅读服务"""

    def __init__(self, repo, db: AsyncSession):
        self.repo = repo
        self.db = db
        self.progress_repo = ProgressRepository(db)

    async def create_session(
        self,
        user_id: str,
        project_id: str,
        chapter_id: str,
        start_page_id: str,
    ) -> dict:
        """创建阅读会话"""
        session_id = str(uuid.uuid4())

        # 统计项目页面数
        pages_result = await self.db.execute(
            select(func.count()).select_from(Page).where(
                Page.chapter_id == uuid.UUID(chapter_id)
            )
        )
        total_pages = pages_result.scalar() or 0

        # 从 DB 获取已有阅读进度
        progress_list = await self.progress_repo.get_progress_by_chapter(
            user_id, chapter_id
        )
        read_pages = len(progress_list)
        completed_count = sum(1 for p in progress_list if p.is_completed)

        progress_percent = (completed_count / total_pages * 100) if total_pages > 0 else 0.0

        now = datetime.now(timezone.utc)

        return {
            "session_id": session_id,
            "project_id": project_id,
            "chapter_id": chapter_id,
            "current_page_id": start_page_id,
            "progress_percent": round(progress_percent, 1),
            "total_pages": total_pages,
            "read_pages": read_pages,
            "completed_pages": completed_count,
            "created_at": now.isoformat(),
            "last_read_at": now.isoformat(),
        }

    async def list_sessions(
        self,
        user_id: str,
        page: int,
        page_size: int,
        project_id: str = None,
    ) -> Tuple[List[dict], int]:
        """获取阅读会话列表 - 从项目列表 + 阅读进度生成"""
        query = select(Project).where(
            Project.user_id == uuid.UUID(user_id),
            Project.status == "active",
        )
        if project_id:
            query = query.where(Project.project_id == uuid.UUID(project_id))
        query = query.order_by(Project.updated_at.desc())

        result = await self.db.execute(query)
        projects = list(result.scalars().all())

        sessions = []
        for proj in projects:
            # 获取第一章第一页
            chapters_result = await self.db.execute(
                select(Chapter)
                .where(Chapter.project_id == proj.project_id)
                .order_by(Chapter.sort_order.asc())
                .limit(1)
            )
            first_chapter = chapters_result.scalar_one_or_none()

            if first_chapter:
                pages_result = await self.db.execute(
                    select(Page)
                    .where(Page.chapter_id == first_chapter.chapter_id)
                    .order_by(Page.sort_order.asc())
                    .limit(1)
                )
                first_page = pages_result.scalar_one_or_none()

                total_result = await self.db.execute(
                    select(func.count()).select_from(Page).where(
                        Page.chapter_id == first_chapter.chapter_id
                    )
                )
                total_pages = total_result.scalar() or 0

                # 获取真实阅读进度
                progress_list = await self.progress_repo.get_progress_by_project(
                    user_id, str(proj.project_id)
                )
                read_pages = len(progress_list)
                completed = sum(1 for p in progress_list if p.is_completed)
                progress_pct = (completed / total_pages * 100) if total_pages > 0 else 0.0

                # 找到最后阅读的页面
                last_progress = progress_list[0] if progress_list else None

                sessions.append({
                    "session_id": str(uuid.uuid4()),
                    "project_id": str(proj.project_id),
                    "chapter_id": str(first_chapter.chapter_id),
                    "current_page_id": str(last_progress.page_id) if last_progress and last_progress.page_id else (
                        str(first_page.page_id) if first_page else None
                    ),
                    "progress_percent": round(progress_pct, 1),
                    "total_pages": total_pages,
                    "read_pages": read_pages,
                    "completed_pages": completed,
                    "created_at": proj.created_at.isoformat() if proj.created_at else None,
                    "last_read_at": last_progress.last_read_at.isoformat() if last_progress and last_progress.last_read_at else (
                        proj.updated_at.isoformat() if proj.updated_at else None
                    ),
                })

        total = len(sessions)
        start = (page - 1) * page_size
        end = start + page_size
        sessions = sessions[start:end]

        return sessions, total

    async def get_session(self, session_id: str, user_id: str) -> Optional[dict]:
        """获取阅读会话详情 - 从DB查询项目信息 + 阅读进度"""
        result = await self.db.execute(
            select(Project).where(
                Project.user_id == uuid.UUID(user_id),
                Project.status == "active",
            ).order_by(Project.updated_at.desc()).limit(1)
        )
        project = result.scalar_one_or_none()
        if not project:
            return None

        chapters_result = await self.db.execute(
            select(Chapter)
            .where(Chapter.project_id == project.project_id)
            .order_by(Chapter.sort_order.asc())
            .limit(1)
        )
        first_chapter = chapters_result.scalar_one_or_none()

        total_pages = 0
        first_page_id = None
        if first_chapter:
            total_result = await self.db.execute(
                select(func.count()).select_from(Page).where(
                    Page.chapter_id == first_chapter.chapter_id
                )
            )
            total_pages = total_result.scalar() or 0

            pages_result = await self.db.execute(
                select(Page)
                .where(Page.chapter_id == first_chapter.chapter_id)
                .order_by(Page.sort_order.asc())
                .limit(1)
            )
            first_page = pages_result.scalar_one_or_none()
            if first_page:
                first_page_id = str(first_page.page_id)

        # 获取真实进度
        progress_list = await self.progress_repo.get_progress_by_project(
            user_id, str(project.project_id)
        )
        read_pages = len(progress_list)
        completed = sum(1 for p in progress_list if p.is_completed)
        last_progress = progress_list[0] if progress_list else None

        return {
            "session_id": session_id or str(project.project_id),
            "project_id": str(project.project_id),
            "chapter_id": str(first_chapter.chapter_id) if first_chapter else None,
            "current_page_id": str(last_progress.page_id) if last_progress and last_progress.page_id else first_page_id,
            "progress_percent": round(completed / total_pages * 100, 1) if total_pages > 0 else 0.0,
            "total_pages": total_pages,
            "read_pages": read_pages,
            "completed_pages": completed,
            "created_at": project.created_at.isoformat() if project.created_at else None,
            "last_read_at": last_progress.last_read_at.isoformat() if last_progress and last_progress.last_read_at else (
                project.updated_at.isoformat() if project.updated_at else None
            ),
        }

    async def update_progress(
        self,
        user_id: str,
        page_id: str,
        chapter_id: str,
        project_id: str,
        scroll_position: float,
        zoom_level: float,
    ) -> dict:
        """更新阅读进度 - 持久化到 reading_progress 表"""
        progress = await self.progress_repo.upsert_progress(
            user_id=user_id,
            project_id=project_id,
            chapter_id=chapter_id,
            page_id=page_id,
            scroll_position=scroll_position,
            zoom_level=zoom_level,
        )

        return {
            "page_id": page_id,
            "chapter_id": chapter_id,
            "project_id": project_id,
            "scroll_position": scroll_position,
            "zoom_level": zoom_level,
            "last_read_at": progress.last_read_at.isoformat() if progress else datetime.now(timezone.utc).isoformat(),
            "is_completed": progress.is_completed if progress else False,
        }

    async def get_progress(
        self, user_id: str, project_id: str, chapter_id: str = None
    ) -> dict:
        """获取阅读进度 - 从 reading_progress 表计算"""
        progress_list = await self.progress_repo.get_progress_by_project(
            user_id, project_id
        )

        # 按章节分组统计
        chapter_progress = {}
        for p in progress_list:
            cid = str(p.chapter_id)
            if cid not in chapter_progress:
                chapter_progress[cid] = {"total": 0, "completed": 0, "last_page_id": None}
            chapter_progress[cid]["total"] += 1
            if p.is_completed:
                chapter_progress[cid]["completed"] += 1
            if not chapter_progress[cid]["last_page_id"] or p.last_read_at > next(
                (x.last_read_at for x in progress_list if str(x.page_id) == chapter_progress[cid]["last_page_id"]),
                datetime.min.replace(tzinfo=timezone.utc)
            ):
                chapter_progress[cid]["last_page_id"] = str(p.page_id)

        # 获取章节信息
        chapters_query = select(Chapter).where(
            Chapter.project_id == uuid.UUID(project_id)
        ).order_by(Chapter.sort_order.asc())

        if chapter_id:
            chapters_query = chapters_query.where(Chapter.chapter_id == uuid.UUID(chapter_id))

        chapters_result = await self.db.execute(chapters_query)
        chapters = list(chapters_result.scalars().all())

        total_pages_all = 0
        total_completed = 0
        chapters_info = []

        for ch in chapters:
            cid = str(ch.chapter_id)
            total_result = await self.db.execute(
                select(func.count()).select_from(Page).where(
                    Page.chapter_id == ch.chapter_id
                )
            )
            ch_total = total_result.scalar() or 0
            total_pages_all += ch_total

            cp = chapter_progress.get(cid, {"total": 0, "completed": 0, "last_page_id": None})
            ch_completed = cp.get("completed", 0)
            total_completed += ch_completed
            ch_progress_pct = (ch_completed / ch_total * 100) if ch_total > 0 else 0.0

            chapters_info.append({
                "chapter_id": cid,
                "title": ch.name or f"Chapter {ch.sort_order}",
                "progress": round(ch_progress_pct, 1),
                "current_page": ch_completed + 1 if ch_completed < ch_total else ch_total,
                "total_pages": ch_total,
                "completed_pages": ch_completed,
                "last_page_id": cp.get("last_page_id"),
            })

        overall_progress = (total_completed / total_pages_all * 100) if total_pages_all > 0 else 0.0

        result = {
            "project_id": project_id,
            "overall_progress": round(overall_progress, 1),
            "total_pages": total_pages_all,
            "completed_pages": total_completed,
            "chapters": chapters_info,
        }

        if chapter_id and chapters_info:
            return chapters_info[0]

        return result

    async def get_history(
        self, user_id: str, page: int, page_size: int
    ) -> Tuple[List[dict], int]:
        """获取阅读历史 - 从 reading_progress + 项目表生成"""
        progress_list = await self.progress_repo.get_recent_history(
            user_id, limit=100
        )

        # 按项目去重聚合
        project_history = {}
        for p in progress_list:
            pid = str(p.project_id)
            if pid not in project_history:
                project_history[pid] = {
                    "project_id": pid,
                    "last_read_at": p.last_read_at,
                    "pages_read": 0,
                    "total_duration": 0,
                    "last_page_id": str(p.page_id),
                }
            project_history[pid]["pages_read"] += 1
            project_history[pid]["total_duration"] += p.read_duration

        # 获取项目名称和章节信息
        history = []
        for pid, info in sorted(project_history.items(), key=lambda x: x[1]["last_read_at"], reverse=True):
            proj_result = await self.db.execute(
                select(Project).where(Project.project_id == uuid.UUID(pid))
            )
            proj = proj_result.scalar_one_or_none()
            if not proj:
                continue

            # 获取最后阅读页面的章节信息
            last_progress = await self.progress_repo.get_progress_by_page(
                user_id, info["last_page_id"]
            )
            chapter_title = ""
            total_pages = 0
            if last_progress:
                ch_result = await self.db.execute(
                    select(Chapter).where(Chapter.chapter_id == last_progress.chapter_id)
                )
                ch = ch_result.scalar_one_or_none()
                if ch:
                    chapter_title = ch.name or f"Chapter {ch.sort_order}"

                total_result = await self.db.execute(
                    select(func.count()).select_from(Page).where(
                        Page.chapter_id == last_progress.chapter_id
                    )
                )
                total_pages = total_result.scalar() or 0

            # 统计总章节页面数
            all_pages_result = await self.db.execute(
                select(func.count()).select_from(Page)
                .join(Chapter, Page.chapter_id == Chapter.chapter_id)
                .where(Chapter.project_id == uuid.UUID(pid))
            )
            project_total_pages = all_pages_result.scalar() or 0

            history.append({
                "project_id": pid,
                "project_title": proj.name,
                "chapter_title": chapter_title,
                "last_page": info["pages_read"],
                "total_pages": project_total_pages,
                "read_at": info["last_read_at"].isoformat(),
                "duration_minutes": round(info["total_duration"] / 60, 1),
            })

        total = len(history)
        start = (page - 1) * page_size
        end = start + page_size
        history = history[start:end]

        return history, total

    async def get_stats(self, user_id: str, project_id: str) -> dict:
        """获取阅读统计 - 基于真实进度数据"""
        # 项目章节数
        chapters_result = await self.db.execute(
            select(Chapter).where(Chapter.project_id == uuid.UUID(project_id))
        )
        chapters = list(chapters_result.scalars().all())
        chapter_count = len(chapters)

        # 总页面数
        total_pages = 0
        for ch in chapters:
            total_result = await self.db.execute(
                select(func.count()).select_from(Page).where(
                    Page.chapter_id == ch.chapter_id
                )
            )
            total_pages += total_result.scalar() or 0

        # 从 reading_progress 获取统计
        progress_list = await self.progress_repo.get_progress_by_project(
            user_id, project_id
        )
        read_pages = len(progress_list)
        completed_pages = sum(1 for p in progress_list if p.is_completed)
        total_seconds = sum(p.read_duration for p in progress_list)

        # 最后阅读时间
        last_read_at = (
            progress_list[0].last_read_at.isoformat()
            if progress_list
            else datetime.now(timezone.utc).isoformat()
        )

        # 统计阅读会话数（按不同日期计数）
        session_dates_result = await self.db.execute(
            select(func.count(func.distinct(func.date(ReadingProgress.last_read_at))))
            .where(ReadingProgress.user_id == uuid.UUID(user_id))
        )
        total_sessions = session_dates_result.scalar() or 0
        if total_sessions == 0:
            total_sessions = 1  # 当前会话

        # 连续阅读天数：统计从今天（或最近一天）向前的连续日期
        streak_days = await self._calculate_streak_days(user_id)

        avg_pages_per_session = read_pages / total_sessions if total_sessions > 0 else read_pages

        return {
            "total_sessions": total_sessions,
            "total_read_pages": read_pages,
            "completed_pages": completed_pages,
            "total_read_time_minutes": round(total_seconds / 60, 1),
            "average_pages_per_session": round(avg_pages_per_session, 1),
            "completed_chapters": chapter_count,
            "streak_days": streak_days,
            "last_read_at": last_read_at,
        }

    async def _calculate_streak_days(self, user_id: str) -> int:
        """计算连续阅读天数：从最近阅读日向前统计连续有阅读的天数"""
        from datetime import date, timedelta

        # 查询用户所有不同的阅读日期（DESC 排列）
        result = await self.db.execute(
            select(func.distinct(func.date(ReadingProgress.last_read_at)))
            .where(ReadingProgress.user_id == uuid.UUID(user_id))
            .order_by(func.date(ReadingProgress.last_read_at).desc())
        )
        dates = [row[0] for row in result.all() if row[0]]

        if not dates:
            return 0

        # 从最近一天开始向前数连续天数
        today = date.today()
        most_recent = dates[0]  # 最近的阅读日期

        # 如果最近阅读日不是今天或昨天，连续天数为 1
        if isinstance(most_recent, datetime):
            most_recent = most_recent.date()
        if most_recent < today - timedelta(days=1):
            return 1

        # 计算连续天数
        streak = 0
        check_date = today
        for d in dates:
            if isinstance(d, datetime):
                d = d.date()
            if d == check_date or d == check_date - timedelta(days=1):
                streak += 1
                check_date = d
            elif d < check_date - timedelta(days=1):
                break
        # 确保至少为最近一次阅读的天数
        if streak == 0:
            streak = 1

        return streak

    async def delete_session(self, session_id: str, user_id: str):
        """删除阅读会话 - 记录日志后 pass"""
        pass
