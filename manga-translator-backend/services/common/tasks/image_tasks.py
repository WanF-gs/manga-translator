from __future__ import annotations
"""
图像处理异步任务 — 调用 image_service 的真实方法
"""
from typing import Dict, Any, Optional, List
import logging

from common.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(bind=True, max_retries=3, default_retry_delay=30)
def process_page_image(
    self,
    page_id: str,
    operations: Optional[List[str]] = None,
    user_id: str = "",
) -> Dict[str, Any]:
    """
    异步处理页面图像全流程。
    operations 支持: detect, ocr, inpaint, render, enhance
    """
    import asyncio
    import sys
    import os
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

    from common.core.database import async_session_factory
    from common.models.page import Page
    from sqlalchemy import select

    if operations is None:
        operations = ["detect", "ocr", "inpaint", "render", "enhance"]

    async def _process():
        async with async_session_factory() as db:
            result = await db.execute(
                select(Page).where(Page.page_id == page_id)
            )
            page = result.scalar_one_or_none()
            if not page:
                return {"status": "failed", "error": "Page not found"}

            pipeline_results = {}
            for op in operations:
                try:
                    if op == "detect":
                        result = await _real_detect(db, page, page_id, user_id)
                    elif op == "ocr":
                        result = await _real_ocr(db, page, page_id, user_id)
                    elif op == "inpaint":
                        result = await _real_inpaint(db, page, page_id, user_id)
                    elif op == "render":
                        result = await _real_render(db, page, page_id, user_id)
                    elif op == "enhance":
                        result = await _real_enhance(db, page, page_id, user_id)
                    else:
                        result = {"status": "skipped", "message": f"Unknown operation: {op}"}
                    pipeline_results[op] = result
                except Exception as e:
                    logger.error(f"Pipeline error [{op}]: {e}", exc_info=True)
                    pipeline_results[op] = {"status": "error", "message": str(e)}

            # BugFix: 根据实际执行结果判定最终状态
            errors = [k for k, v in pipeline_results.items() if v.get("status") in ("error", "skipped")]
            if not errors:
                page.status = "completed"
            elif len(errors) < len(operations):
                page.status = "completed"  # 部分成功也算完成
            else:
                page.status = "failed"

            page.preprocessing_result = {
                "pipeline": operations,
                "results": pipeline_results,
            }
            await db.commit()

            return {
                "status": page.status,
                "page_id": page_id,
                "operations_completed": [
                    k for k, v in pipeline_results.items()
                    if v.get("status") not in ("error", "skipped")
                ],
            }

    try:
        return asyncio.run(_process())
    except Exception as exc:
        logger.error(f"process_page_image failed: {exc}", exc_info=True)
        raise self.retry(exc=exc)


async def _real_detect(db, page, page_id: str, user_id: str) -> dict:
    """真实文字检测"""
    from image_service.service.detect_service import DetectService
    service = DetectService(db)
    result = await service.detect(page_id, user_id, detect_all=True, language="ja")
    return {"status": "ok", "regions_detected": len(result.get("regions", []))}


async def _real_ocr(db, page, page_id: str, user_id: str) -> dict:
    """真实OCR"""
    from image_service.service.ocr_service import OcrService
    service = OcrService(db)
    result = await service.recognize(page_id, user_id, region_ids=None, language="ja")
    return {"status": "ok", "texts_extracted": len(result.get("results", []))}


async def _real_inpaint(db, page, page_id: str, user_id: str) -> dict:
    """真实背景修复"""
    from image_service.service.inpaint_service import InpaintService
    service = InpaintService(db)
    result = await service.inpaint(
        page_id=page_id, user_id=user_id,
        region_ids=None, method="lama", background_preserve=True,
    )
    return {"status": "ok", "regions_inpainted": result.get("regions_processed", 0)}


async def _real_render(db, page, page_id: str, user_id: str) -> dict:
    """真实文字渲染"""
    from common.models.text_region import TextRegion
    from sqlalchemy import select

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

    from image_service.service.render_service import RenderService
    service = RenderService(db)
    result = await service.render(
        page_id=page_id, user_id=user_id,
        regions=region_data, preserve_style=True, auto_resize=True,
    )
    return {"status": "ok", "regions_rendered": result.get("regions_rendered", 0)}


async def _real_enhance(db, page, page_id: str, user_id: str) -> dict:
    """真实画质增强"""
    from image_service.service.enhance_service import EnhanceService
    service = EnhanceService(db)
    result = await service.enhance(
        page_id=page_id, user_id=user_id, method="auto", level=2,
    )
    return {"status": "ok", "applied_filters": result.get("applied_filters", [])}


@celery_app.task(bind=True, max_retries=2, default_retry_delay=60)
def batch_process_images(
    self,
    page_ids: List[str],
    operations: Optional[List[str]] = None,
    user_id: str = "",
) -> Dict[str, Any]:
    """批量处理多页图像"""
    task_ids = []
    for pid in page_ids:
        task = process_page_image.delay(
            page_id=pid,
            operations=operations,
            user_id=user_id,
        )
        task_ids.append(task.id)

    return {
        "status": "started",
        "total_pages": len(page_ids),
        "operations": operations or ["detect", "ocr", "inpaint", "render", "enhance"],
        "sub_tasks": task_ids,
    }


@celery_app.task(bind=True, max_retries=2, default_retry_delay=30)
def generate_thumbnail(
    self,
    page_id: str,
    width: int = 300,
    user_id: str = "",
) -> Dict[str, Any]:
    """生成缩略图（真实实现）"""
    import asyncio
    import sys, os
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

    from common.core.database import async_session_factory
    from common.models.page import Page
    from sqlalchemy import select
    import httpx
    from PIL import Image
    import io

    async def _gen():
        async with async_session_factory() as db:
            result = await db.execute(
                select(Page).where(Page.page_id == page_id)
            )
            page = result.scalar_one_or_none()
            if not page:
                return {"status": "failed", "error": "Page not found"}

            try:
                # 下载原图
                async with httpx.AsyncClient(timeout=30.0) as client:
                    resp = await client.get(page.original_url)
                    resp.raise_for_status()
                    img = Image.open(io.BytesIO(resp.content))

                # 生成缩略图
                ratio = width / img.width
                new_h = int(img.height * ratio)
                thumb = img.resize((width, new_h), Image.LANCZOS)

                buf = io.BytesIO()
                thumb.convert("RGB").save(buf, format="JPEG", quality=80)
                buf.seek(0)

                # 上传 MinIO
                from common.core.minio import minio_client
                from common.core.config import settings
                object_name = f"thumbnails/{page_id}_{width}.jpg"
                minio_client.put_object(
                    bucket_name=settings.MINIO_BUCKET,
                    object_name=object_name,
                    data=buf,
                    length=buf.getbuffer().nbytes,
                    content_type="image/jpeg",
                )

                page.thumbnail_url = f"/storage/{settings.MINIO_BUCKET}/{object_name}"
                await db.commit()

                return {"status": "completed", "page_id": page_id,
                         "thumbnail_url": page.thumbnail_url}
            except Exception as e:
                logger.error(f"Thumbnail generation failed: {e}")
                # BugFix: 失败时不写入假URL，返回失败状态
                await db.rollback()
                return {"status": "failed", "page_id": page_id, "error": str(e)}

    try:
        return asyncio.run(_gen())
    except Exception as exc:
        raise self.retry(exc=exc)
