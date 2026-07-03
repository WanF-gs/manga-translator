from __future__ import annotations
"""
Full pipeline orchestration tasks using Celery Chain/Chord.
Implements: detect → OCR → translate → inpaint → render
"""
import asyncio
import logging
import uuid
from typing import Dict, Any, Optional, List
from datetime import datetime, timezone

from common.tasks.celery_app import celery_app
from common.tasks.vocab_extractor import extract_vocabulary_from_page

logger = logging.getLogger(__name__)


@celery_app.task(bind=True, max_retries=1, default_retry_delay=60)
def run_pipeline_for_page(
    self,
    page_id: str,
    batch_id: str = "",
    user_id: str = "",
    operations: Optional[List[str]] = None,
    source_lang: str = "ja",
    target_lang: str = "zh-CN",
) -> Dict[str, Any]:
    """
    Run the full pipeline for a single page:
    detect → OCR → translate → inpaint → render
    
    Checks pause/cancel flags before each step.
    Retries once on failure, then skips and records error.
    """
    import sys, os
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    
    from common.tasks.progress_tracker import ProgressTracker, PageProgressTracker
    from common.core.database import async_session_factory
    from common.models.page import Page
    from common.models.text_region import TextRegion
    from sqlalchemy import select
    
    if operations is None:
        operations = ["detect", "ocr", "translate", "inpaint", "render"]
    
    tracker = ProgressTracker(batch_id) if batch_id else None
    page_tracker = PageProgressTracker(page_id)
    
    async def _run():
        async with async_session_factory() as db:
            # Get page
            result = await db.execute(select(Page).where(Page.page_id == page_id))
            page = result.scalar_one_or_none()
            if not page:
                if tracker:
                    tracker.update_page_progress(page_id, "detect", "failed")
                return {"status": "failed", "error": "Page not found"}
            
            pipeline_results = {}
            
            for step in operations:
                # Check cancel
                if tracker and tracker.is_cancelled():
                    return {"status": "cancelled", "page_id": page_id}
                
                # Check pause
                if tracker:
                    while tracker.is_paused():
                        await asyncio.sleep(1)
                        if tracker.is_cancelled():
                            return {"status": "cancelled", "page_id": page_id}
                
                page_tracker.set(step, "processing", 0)
                
                try:
                    if step == "detect":
                        result = await _do_detect(db, page, page_id, user_id, source_lang)
                    elif step == "ocr":
                        result = await _do_ocr(db, page, page_id, user_id, source_lang)
                    elif step == "translate":
                        result = await _do_translate(db, page, page_id, user_id, source_lang, target_lang)
                    elif step == "inpaint":
                        result = await _do_inpaint(db, page, page_id, user_id)
                    elif step == "render":
                        result = await _do_render(db, page, page_id, user_id)
                    else:
                        result = {"status": "skipped", "message": f"Unknown step: {step}"}
                    
                    pipeline_results[step] = result
                    
                    if result.get("status") == "error":
                        page_tracker.set(step, "failed", 100)
                        if tracker:
                            tracker.update_page_progress(page_id, step, "failed")
                        
                        # Retry this step exactly once
                        if step in ("detect", "ocr"):
                            logger.info(f"Retrying {step} for page {page_id}")
                            if step == "detect":
                                result = await _do_detect(db, page, page_id, user_id, source_lang)
                            elif step == "ocr":
                                result = await _do_ocr(db, page, page_id, user_id, source_lang)
                            pipeline_results[step] = result
                    else:
                        page_tracker.set(step, "completed", 100)
                        if tracker:
                            tracker.update_page_progress(page_id, step, "completed")
                    
                    # §3.0: After translate success, extract vocab for learning center
                    if step == "translate" and result.get("status") == "ok" and user_id:
                        await extract_vocabulary_from_page(db, page_id, user_id, source_lang)

                    # Update page status after each step
                    status_map = {
                        "detect": "detected",
                        "ocr": "ocr_done",
                        "translate": "translated",
                        "inpaint": "inpainted",
                        "render": "rendered",
                    }
                    if step in status_map:
                        page.status = status_map[step]
                        await db.flush()

                except Exception as e:
                    # First failure: retry once
                    logger.warning(f"Step {step} failed for page {page_id}: {e}, retrying...")
                    try:
                        if step == "detect":
                            result = await _do_detect(db, page, page_id, user_id, source_lang)
                        elif step == "ocr":
                            result = await _do_ocr(db, page, page_id, user_id, source_lang)
                        elif step == "translate":
                            result = await _do_translate(db, page, page_id, user_id, source_lang, target_lang)
                        elif step == "inpaint":
                            result = await _do_inpaint(db, page, page_id, user_id)
                        elif step == "render":
                            result = await _do_render(db, page, page_id, user_id)
                        else:
                            result = {"status": "error", "message": str(e)}

                        if result.get("status") == "error":
                            pipeline_results[step] = {"status": "skipped", "error": str(e), "retried": True}
                            page_tracker.set(step, "skipped", 100)
                            if tracker:
                                tracker.update_page_progress(page_id, step, "failed")
                        else:
                            pipeline_results[step] = result
                            page_tracker.set(step, "completed", 100)
                            if tracker:
                                tracker.update_page_progress(page_id, step, "completed")
                            # BugFix: 重试成功后同步更新 page.status
                            status_map = {
                                "detect": "detected", "ocr": "ocr_done",
                                "translate": "translated", "inpaint": "inpainted", "render": "rendered",
                            }
                            if step in status_map:
                                page.status = status_map[step]
                                await db.flush()

                            # §3.0: After retry translate success, extract vocab
                            if step == "translate" and user_id:
                                await extract_vocabulary_from_page(db, page_id, user_id, source_lang)
                    except Exception as e2:
                        logger.error(f"Step {step} failed after retry for page {page_id}: {e2}")
                        pipeline_results[step] = {"status": "skipped", "error": str(e2), "retried": True}
                        page_tracker.set(step, "skipped", 100)
                        if tracker:
                            tracker.update_page_progress(page_id, step, "failed")
            
            # Save results
            page.preprocessing_result = {
                "pipeline": operations,
                "results": pipeline_results,
                "batch_id": batch_id,
                "completed_at": datetime.now(timezone.utc).isoformat(),
            }
            
            # Determine final status
            errors = [k for k, v in pipeline_results.items() if v.get("status") in ("error", "skipped")]
            if not errors:
                page.status = "completed"
            elif len(errors) < len(operations):
                page.status = "completed"  # Partial completion is OK
            else:
                page.status = "failed"
            
            await db.commit()
            
            return {
                "status": page.status,
                "page_id": page_id,
                "operations_completed": [k for k, v in pipeline_results.items() if v.get("status") not in ("error", "skipped")],
                "operations_skipped": errors,
            }
    
    try:
        return asyncio.run(_run())
    except Exception as exc:
        logger.error(f"Pipeline failed for page {page_id}: {exc}", exc_info=True)
        if tracker:
            tracker.mark_failed(str(exc))
        raise self.retry(exc=exc)


@celery_app.task(bind=True, max_retries=0)
def run_full_pipeline_batch(
    self,
    batch_id: str,
    page_ids: List[str],
    user_id: str = "",
    operations: Optional[List[str]] = None,
    source_lang: str = "ja",
    target_lang: str = "zh-CN",
) -> Dict[str, Any]:
    """
    Dispatch pipeline tasks for all pages in a batch using Celery Chord.
    The chord callback will be called when all pages are done.
    """
    import sys, os
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    
    from common.tasks.progress_tracker import ProgressTracker
    from celery import chord, group
    
    tracker = ProgressTracker(batch_id)
    
    # Disconnect chord callback first (if exists)
    tracker.initialize(len(page_ids), operations)
    
    # Check for existing pause/cancel
    if tracker.is_cancelled():
        return {"status": "cancelled", "batch_id": batch_id}
    
    # Create tasks for each page
    tasks = []
    for pid in page_ids:
        task = run_pipeline_for_page.s(
            page_id=pid,
            batch_id=batch_id,
            user_id=user_id,
            operations=operations,
            source_lang=source_lang,
            target_lang=target_lang,
        )
        tasks.append(task)
    
    # Use chord: all tasks complete → callback
    if tasks:
        callback = pipeline_batch_complete.s(
            batch_id=batch_id,
            user_id=user_id,
        )
        chord(tasks)(callback)
    
    return {
        "status": "started",
        "batch_id": batch_id,
        "total_pages": len(page_ids),
        "operations": operations,
    }


@celery_app.task(bind=True, max_retries=1)
def pipeline_batch_complete(
    self,
    results: List[Dict],
    batch_id: str,
    user_id: str = "",
) -> Dict[str, Any]:
    """
    Callback when all pages in a batch are complete.
    Update progress tracker and send notification.
    """
    import sys, os
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    
    from common.tasks.progress_tracker import ProgressTracker
    
    tracker = ProgressTracker(batch_id)
    
    completed = sum(1 for r in results if isinstance(r, dict) and r.get("status") == "completed")
    failed = sum(1 for r in results if isinstance(r, dict) and r.get("status") in ("failed", "error"))
    skipped = len(results) - completed - failed
    
    if failed > 0 and completed == 0:
        tracker.mark_failed(f"All {len(results)} pages failed")
    else:
        tracker.mark_complete()
    
    # Send notification
    if user_id:
        try:
            from common.tasks.notification import send_notification
            
            status_text = "完成" if failed == 0 else f"部分完成 ({completed}/{len(results)})"
            send_notification.delay(
                user_id=user_id,
                type="batch_complete",
                title=f"批量处理{status_text}",
                content=f"共 {len(results)} 页，成功 {completed} 页，跳过 {skipped} 页，失败 {failed} 页",
                ref_type="batch",
                ref_id=batch_id,
            )
        except Exception as e:
            logger.warning(f"Failed to send batch complete notification: {e}")
    
    return {
        "status": "completed" if failed == 0 else "partial",
        "batch_id": batch_id,
        "total": len(results),
        "completed": completed,
        "failed": failed,
        "skipped": skipped,
    }


# ===================== Pipeline Step Implementations =====================

async def _do_detect(db, page, page_id: str, user_id: str, language: str = "ja") -> dict:
    """Text detection step."""
    from image_service.service.detect_service import DetectService
    service = DetectService(db)
    result = await service.detect(page_id, user_id, detect_all=True, language=language)
    regions_count = len(result.get("regions", []))
    return {"status": "ok" if regions_count > 0 else "warning", "regions_detected": regions_count}


async def _do_ocr(db, page, page_id: str, user_id: str, language: str = "ja") -> dict:
    """OCR step."""
    from image_service.service.ocr_service import OcrService
    service = OcrService(db)
    result = await service.recognize(page_id, user_id, region_ids=None, language=language)
    texts = [r.get("text", "") for r in result.get("results", []) if r.get("text")]
    return {"status": "ok", "texts_extracted": len(texts)}


async def _do_translate(db, page, page_id: str, user_id: str, source_lang: str, target_lang: str) -> dict:
    """Translation step."""
    from common.models.text_region import TextRegion
    from sqlalchemy import select
    from translation_service.service.translation_service import TranslationService
    
    # Get regions with text
    result = await db.execute(
        select(TextRegion).where(
            TextRegion.page_id == page_id,
            TextRegion.original_text.isnot(None),
            TextRegion.original_text != "",
        )
    )
    regions = list(result.scalars().all())
    
    if not regions:
        return {"status": "warning", "message": "No text to translate"}
    
    service = TranslationService(db)
    translate_result = await service.translate_page(
        page_id=page_id,
        target_lang=target_lang,
        engine="auto",
    )
    
    translated_count = len([r for r in translate_result.get("regions", []) if r.get("translated_text")])
    return {"status": "ok", "regions_translated": translated_count, "engine": translate_result.get("engine", "basic")}


# ── §3.0 词汇自动收集：翻译后提取生词加入学习中心 ──
# (Moved to common.tasks.vocab_extractor for reuse across Celery and sync paths)

async def _do_inpaint(db, page, page_id: str, user_id: str) -> dict:
    """Inpainting step."""
    from image_service.service.inpaint_service import InpaintService
    service = InpaintService(db)
    result = await service.inpaint(
        page_id=page_id, user_id=user_id,
        region_ids=None, method="lama", background_preserve=True,
    )
    return {"status": "ok", "regions_inpainted": result.get("regions_processed", 0)}


async def _do_render(db, page, page_id: str, user_id: str) -> dict:
    """Rendering step."""
    from common.models.text_region import TextRegion
    from sqlalchemy import select
    from image_service.service.render_service import RenderService
    
    regions_result = await db.execute(
        select(TextRegion).where(TextRegion.page_id == page_id)
    )
    regions = list(regions_result.scalars().all())
    
    region_data = []
    for r in regions:
        if r.translated_text:
            region_data.append({
                "region_id": str(r.region_id),
                "translated_text": r.translated_text,
            })
    
    if not region_data:
        return {"status": "warning", "message": "No translated text to render"}
    
    service = RenderService(db)
    result = await service.render(
        page_id=page_id, user_id=user_id,
        regions=region_data, preserve_style=True, auto_resize=True,
    )
    return {"status": "ok", "regions_rendered": result.get("regions_rendered", 0)}


@celery_app.task(bind=True, max_retries=1, default_retry_delay=120)
def simple_translate_task(
    self,
    project_id: str,
    user_id: str = "",
    source_lang: Optional[str] = None,
    target_lang: str = "zh-CN",
) -> Dict[str, Any]:
    """
    One-click simple translate: upload → detect all → OCR all → translate all → inpaint all → render all → notify.
    """
    import sys, os
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    
    from common.core.database import async_session_factory
    from common.models.project import Project
    from common.models.chapter import Chapter
    from common.models.page import Page
    from sqlalchemy import select
    
    async def _do_simple():
        async with async_session_factory() as db:
            # Get project
            result = await db.execute(select(Project).where(Project.project_id == project_id))
            project = result.scalar_one_or_none()
            if not project:
                return {"status": "failed", "error": "Project not found"}
            
            # Read source_lang from project if not explicitly provided
            effective_source_lang = source_lang or project.source_lang or "ja"
            
            # Get all chapters
            ch_result = await db.execute(
                select(Chapter).where(Chapter.project_id == project_id).order_by(Chapter.sort_order)
            )
            chapters = list(ch_result.scalars().all())
            
            # Collect all pages
            all_page_ids = []
            for ch in chapters:
                p_result = await db.execute(
                    select(Page).where(Page.chapter_id == ch.chapter_id).order_by(Page.sort_order)
                )
                for p in p_result.scalars().all():
                    if p.status in ("pending", "uploaded"):
                        all_page_ids.append(str(p.page_id))
            
            if not all_page_ids:
                return {"status": "completed", "message": "No pages to process", "pages_processed": 0}
            
            # Create batch and dispatch
            batch_id = str(uuid.uuid4())
            run_full_pipeline_batch.delay(
                batch_id=batch_id,
                page_ids=all_page_ids,
                user_id=user_id,
                source_lang=effective_source_lang,
                target_lang=target_lang,
            )
            
            return {
                "status": "started",
                "batch_id": batch_id,
                "project_id": project_id,
                "source_lang": effective_source_lang,
                "target_lang": target_lang,
                "total_pages": len(all_page_ids),
            }
    
    try:
        return asyncio.run(_do_simple())
    except Exception as exc:
        logger.error(f"Simple translate failed: {exc}", exc_info=True)
        raise self.retry(exc=exc)
