from __future__ import annotations
"""
翻译异步任务 — 调用真实翻译引擎
"""
from typing import Dict, Any
import logging

from common.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def translate_page_task(
    self,
    page_id: str,
    target_lang: str,
    engine_type: str = "auto",
    user_id: str = "",
) -> Dict[str, Any]:
    """
    异步翻译单页所有文字区域，调用真实翻译引擎。
    """
    import asyncio
    import sys, os
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

    from common.core.database import async_session_factory
    from common.models.page import Page
    from common.models.text_region import TextRegion
    from sqlalchemy import select

    async def _do_translate():
        async with async_session_factory() as db:
            # 获取页面
            result = await db.execute(
                select(Page).where(Page.page_id == page_id)
            )
            page = result.scalar_one_or_none()
            if not page:
                return {"status": "failed", "error": "Page not found"}

            page.status = "processing"
            await db.flush()

            # 获取所有文字区域
            regions_result = await db.execute(
                select(TextRegion)
                .where(TextRegion.page_id == page_id)
                .order_by(TextRegion.sort_order.asc())
            )
            regions = list(regions_result.scalars().all())

            if not regions:
                page.status = "completed"
                await db.flush()
                return {"status": "completed", "regions_translated": 0}

            # 调用真实翻译引擎
            from translation_service.service.engine_router import EngineRouter

            router = EngineRouter()
            translated_count = 0

            for region in regions:
                if not region.original_text or region.is_locked:
                    continue

                try:
                    result = await router.route(
                        text=region.original_text,
                        source_lang="ja",
                        target_lang=target_lang,
                        region_type=region.type,
                        character_tone="neutral",
                        from_cache=False,
                    )
                    region.translated_text = result.get("text", "")
                    region.confidence = 0.85
                    translated_count += 1
                except Exception as e:
                    logger.warning(f"Failed to translate region {region.region_id}: {e}")
                    region.translated_text = f"[{target_lang}] {region.original_text}"
                    region.confidence = 0.0

            page.status = "completed"
            page.translation_result = {
                "engine": engine_type,
                "target_lang": target_lang,
                "regions_translated": translated_count,
                "total_regions": len(regions),
            }
            await db.commit()

            return {
                "status": "completed",
                "regions_translated": translated_count,
                "total_regions": len(regions),
            }

    try:
        return asyncio.run(_do_translate())
    except Exception as exc:
        logger.error(f"translate_page_task failed: {exc}", exc_info=True)
        raise self.retry(exc=exc)


@celery_app.task(bind=True, max_retries=2, default_retry_delay=120)
def batch_translate_project(
    self,
    project_id: str,
    target_lang: str,
    chapter_ids: list = None,
    user_id: str = "",
) -> Dict[str, Any]:
    """批量翻译整个项目"""
    import asyncio
    import sys, os
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

    from common.core.database import async_session_factory
    from common.models.chapter import Chapter
    from common.models.page import Page
    from sqlalchemy import select

    async def _do_batch():
        async with async_session_factory() as db:
            chapter_query = select(Chapter).where(Chapter.project_id == project_id)
            if chapter_ids:
                chapter_query = chapter_query.where(Chapter.chapter_id.in_(chapter_ids))
            chapter_query = chapter_query.order_by(Chapter.sort_order.asc())
            chapters_result = await db.execute(chapter_query)
            chapters = list(chapters_result.scalars().all())

            total_pages = 0
            page_ids = []

            for ch in chapters:
                pages_result = await db.execute(
                    select(Page)
                    .where(Page.chapter_id == ch.chapter_id)
                    .order_by(Page.sort_order.asc())
                )
                pages = list(pages_result.scalars().all())
                for p in pages:
                    page_ids.append(str(p.page_id))
                total_pages += len(pages)

            task_ids = []
            for pid in page_ids:
                task = translate_page_task.delay(
                    page_id=pid,
                    target_lang=target_lang,
                    engine_type="auto",
                    user_id=user_id,
                )
                task_ids.append(task.id)

            return {
                "status": "started",
                "project_id": project_id,
                "target_lang": target_lang,
                "total_pages": total_pages,
                "sub_tasks": task_ids,
            }

    try:
        return asyncio.run(_do_batch())
    except Exception as exc:
        raise self.retry(exc=exc)
