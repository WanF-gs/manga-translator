from __future__ import annotations
"""
条漫长图拼接导出 API

POST /long-image/stitch — 拼接多页为一张竖版长图
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from common.core.dependencies import get_db, get_current_user
from common.core.response import success_response
from common.core.config import settings

from ..service.long_image_stitcher import stitch_pages_to_long_image

router = APIRouter(prefix="/long-image", tags=["Long Image Stitching"])


class StitchRequest(BaseModel):
    chapter_id: Optional[str] = None
    page_ids: Optional[List[str]] = None
    gap: int = Field(default=2, ge=0, le=20, description="页面间隔像素")
    gap_color: str = Field(default="#333333", description="间隔线颜色 (hex)")
    align: str = Field(default="center", description="对齐方式: center/left/right")


@router.post("/stitch", summary="拼接长图")
async def stitch_long_image(
    request: StitchRequest,
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    将多页图像纵向拼接为一张竖版长图。
    支持按章节或指定页面列表拼接。
    """
    from sqlalchemy import select
    from common.models.page import Page
    from common.models.chapter import Chapter

    image_urls = []

    if request.chapter_id:
        # 按章节拼接
        try:
            chapter_uuid = uuid.UUID(request.chapter_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid chapter_id format")

        pages_result = await db.execute(
            select(Page)
            .where(Page.chapter_id == chapter_uuid)
            .order_by(Page.sort_order.asc())
        )
        pages = list(pages_result.scalars().all())
        image_urls = [(p.processed_url or p.original_url) for p in pages]
    elif request.page_ids:
        # 按指定页面列表拼接
        for pid in request.page_ids:
            try:
                page_uuid = uuid.UUID(pid)
            except ValueError:
                continue
            page_result = await db.execute(
                select(Page).where(Page.page_id == page_uuid)
            )
            page = page_result.scalar_one_or_none()
            if page:
                image_urls.append(page.processed_url or page.original_url)
    else:
        raise HTTPException(status_code=400, detail="chapter_id or page_ids is required")

    if len(image_urls) < 2:
        raise HTTPException(status_code=400, detail="Need at least 2 pages to stitch")

    # 执行拼接
    result_bytes = await stitch_pages_to_long_image(
        image_urls=image_urls,
        gap=request.gap,
        gap_color=request.gap_color,
        align=request.align,
    )

    if result_bytes is None:
        raise HTTPException(status_code=500, detail="Failed to stitch images")

    # 上传结果
    task_id = str(uuid.uuid4())
    try:
        from common.core.minio import minio_client
        import io as io_module

        object_name = f"long_images/{current_user.get('sub', 'anon')}/{task_id}.png"
        minio_client.put_object(
            bucket_name=settings.MINIO_BUCKET,
            object_name=object_name,
            data=io_module.BytesIO(result_bytes),
            length=len(result_bytes),
            content_type="image/png",
        )
        result_url = f"/storage/{settings.MINIO_BUCKET}/{object_name}"
    except Exception as e:
        # Fallback: return base64
        import base64
        result_url = None
        result_base64 = base64.b64encode(result_bytes).decode("utf-8")
        return success_response(data={
            "task_id": task_id,
            "result_base64": result_base64,
            "page_count": len(image_urls),
            "message": "Long image stitched (base64 fallback)",
        })

    return success_response(data={
        "task_id": task_id,
        "result_url": result_url,
        "page_count": len(image_urls),
        "message": "Long image stitched successfully",
    })
