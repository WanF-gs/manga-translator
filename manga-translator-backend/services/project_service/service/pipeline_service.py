from __future__ import annotations
"""
Pipeline orchestration service for batch processing.
"""
import uuid
import logging
from typing import Dict, Any, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from common.core.config import settings
from common.models.project import Project
from common.models.chapter import Chapter
from common.models.page import Page

logger = logging.getLogger(__name__)

# Pipeline step definitions
PIPELINE_STEPS = ["detect", "ocr", "translate", "inpaint", "render"]


class PipelineService:
    """Orchestrates batch pipeline processing."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def start_batch_process(
        self,
        project_id: str,
        user_id: str,
        operations: Optional[List[str]] = None,
        chapters: Optional[List[str]] = None,
        target_lang: str = "zh-CN",
        source_lang: str = "ja",
        engine: str = "auto",
    ) -> Dict[str, Any]:
        """
        Start a batch pipeline process for a project.
        
        Returns:
            {batch_id, status, total_pages, operations, message}
        """
        # Validate project
        result = await self.db.execute(
            select(Project).where(Project.project_id == project_id)
        )
        project = result.scalar_one_or_none()
        if not project:
            raise ValueError(f"Project {project_id} not found")

        # Get chapters
        chapter_query = select(Chapter).where(Chapter.project_id == project_id)
        if chapters:
            chapter_query = chapter_query.where(Chapter.chapter_id.in_(chapters))
        chapter_query = chapter_query.order_by(Chapter.sort_order.asc())
        chapters_result = await self.db.execute(chapter_query)
        chapter_list = list(chapters_result.scalars().all())

        if not chapter_list:
            raise ValueError("No chapters found for this project")

        # Collect page IDs
        page_ids = []
        for ch in chapter_list:
            pages_result = await self.db.execute(
                select(Page)
                .where(Page.chapter_id == ch.chapter_id)
                .where(Page.status.in_(["pending", "uploaded", "detected"]))
                .order_by(Page.sort_order.asc())
            )
            for p in pages_result.scalars().all():
                page_ids.append(str(p.page_id))

        if not page_ids:
            raise ValueError("No pages to process in this project/chapters")

        # Validate operations
        if operations is None:
            operations = PIPELINE_STEPS
        else:
            ops = [op for op in operations if op in PIPELINE_STEPS]
            if not ops:
                raise ValueError(f"Invalid operations. Valid: {PIPELINE_STEPS}")
            operations = ops

        # Create batch ID
        batch_id = str(uuid.uuid4())

        # Dispatch Celery tasks
        from common.tasks.pipeline_tasks import run_full_pipeline_batch
        
        run_full_pipeline_batch.delay(
            batch_id=batch_id,
            page_ids=page_ids,
            user_id=user_id,
            operations=operations,
            source_lang=source_lang,
            target_lang=target_lang,
        )

        return {
            "batch_id": batch_id,
            "status": "started",
            "total_pages": len(page_ids),
            "operations": operations,
            "message": f"Batch processing started for {len(page_ids)} pages",
        }

    async def get_batch_status(self, batch_id: str) -> Optional[Dict[str, Any]]:
        """Get batch processing progress."""
        from common.tasks.progress_tracker import ProgressTracker
        
        tracker = ProgressTracker(batch_id)
        return tracker.get()

    async def pause_batch(self, batch_id: str) -> bool:
        """Pause a running batch."""
        from common.tasks.progress_tracker import ProgressTracker
        
        tracker = ProgressTracker(batch_id)
        return tracker.set_pause_flag()

    async def resume_batch(self, batch_id: str) -> bool:
        """Resume a paused batch."""
        from common.tasks.progress_tracker import ProgressTracker
        
        tracker = ProgressTracker(batch_id)
        return tracker.clear_pause_flag()

    async def cancel_batch(self, batch_id: str) -> bool:
        """Cancel a batch process."""
        from common.tasks.progress_tracker import ProgressTracker
        
        tracker = ProgressTracker(batch_id)
        tracker.cancel()
        return True

    async def start_simple_translate(
        self,
        project_id: str,
        user_id: str,
        target_lang: str = "zh-CN",
        chapters: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        One-click simple mode translation.
        
        Automatically runs: detect → OCR → translate → inpaint → render
        """
        # Validate project
        result = await self.db.execute(
            select(Project).where(Project.project_id == project_id)
        )
        project = result.scalar_one_or_none()
        if not project:
            raise ValueError(f"Project {project_id} not found")
        
        # Read source_lang from project (user set when creating project)
        source_lang = project.source_lang or "ja"

        # Get chapters
        chapter_query = select(Chapter).where(Chapter.project_id == project_id)
        if chapters:
            chapter_query = chapter_query.where(Chapter.chapter_id.in_(chapters))
        chapter_query = chapter_query.order_by(Chapter.sort_order.asc())
        chapters_result = await self.db.execute(chapter_query)
        chapter_list = list(chapters_result.scalars().all())

        if not chapter_list:
            raise ValueError("No chapters found")

        # Collect all pages (including those already partially processed)
        page_ids = []
        for ch in chapter_list:
            pages_result = await self.db.execute(
                select(Page)
                .where(Page.chapter_id == ch.chapter_id)
                .where(Page.status.notin_(["completed"]))
                .order_by(Page.sort_order.asc())
            )
            for p in pages_result.scalars().all():
                page_ids.append(str(p.page_id))

        if not page_ids:
            return {
                "batch_id": "",
                "status": "completed",
                "total_pages": 0,
                "message": "All pages already completed",
            }

        # Start full pipeline
        from common.tasks.pipeline_tasks import run_full_pipeline_batch
        
        batch_id = str(uuid.uuid4())
        run_full_pipeline_batch.delay(
            batch_id=batch_id,
            page_ids=page_ids,
            user_id=user_id,
            operations=PIPELINE_STEPS,
            source_lang=source_lang,
            target_lang=target_lang,
        )

        return {
            "batch_id": batch_id,
            "status": "started",
            "total_pages": len(page_ids),
            "message": f"One-click translation started for {len(page_ids)} pages",
        }
