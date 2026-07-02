from __future__ import annotations
"""
Bilingual export API.
POST /bilingual/preview — Preview bilingual composition
POST /bilingual/export — Export in bilingual mode
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from typing import Optional

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from common.core.dependencies import get_db, get_current_user
from common.core.response import success_response

from ..service.bilingual_composer import BilingualComposer

router = APIRouter(prefix="/bilingual", tags=["Bilingual Export"])


class BilingualPreviewRequest(BaseModel):
    original_url: str
    translated_url: str
    mode: str = "side-by-side"  # side-by-side, top-bottom, in-bubble
    gap: int = Field(default=10, ge=0, le=50)
    original_label: str = "原文"
    translated_label: str = "译文"


class BilingualExportRequest(BaseModel):
    page_id: str
    mode: str = "side-by-side"
    original_label: str = "原文"
    translated_label: str = "译文"


@router.post("/preview", summary="双语合成预览")
async def preview_bilingual(
    request: BilingualPreviewRequest,
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Preview bilingual composition for a single page.
    Returns the composed image as the response.
    """
    if request.mode not in BilingualComposer.MODES:
        raise HTTPException(status_code=400, detail=f"Invalid mode. Valid: {BilingualComposer.MODES}")

    composer = BilingualComposer()
    result = await composer.compose(
        mode=request.mode,
        original_url=request.original_url,
        translated_url=request.translated_url,
        original_label=request.original_label,
        translated_label=request.translated_label,
        gap=request.gap,
    )

    if result is None:
        raise HTTPException(status_code=500, detail="Failed to compose bilingual image")

    from fastapi.responses import Response
    return Response(content=result, media_type="image/png")


@router.post("/export", summary="双语导出")
async def export_bilingual(
    request: BilingualExportRequest,
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Export a page in bilingual mode.
    Creates an export task for the composed bilingual image.
    """
    from sqlalchemy import select
    from common.models.page import Page
    import uuid
    
    # Get page
    result = await db.execute(select(Page).where(Page.page_id == request.page_id))
    page = result.scalar_one_or_none()
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")

    original_url = page.original_url
    translated_url = page.processed_url

    if not translated_url:
        raise HTTPException(status_code=400, detail="Page has no translated version")

    composer = BilingualComposer()
    image_data = await composer.compose(
        mode=request.mode,
        original_url=original_url,
        translated_url=translated_url,
        original_label=request.original_label,
        translated_label=request.translated_label,
    )

    if image_data is None:
        raise HTTPException(status_code=500, detail="Failed to compose bilingual image")

    # Upload to MinIO
    try:
        from common.core.minio import minio_client
        from common.core.config import settings
        import io
        
        task_id = str(uuid.uuid4())
        object_name = f"bilingual/{current_user['sub']}/{request.page_id}/{task_id}.png"
        
        minio_client.put_object(
            bucket_name=settings.MINIO_BUCKET,
            object_name=object_name,
            data=io.BytesIO(image_data),
            length=len(image_data),
            content_type="image/png",
        )
        
        result_url = f"/storage/{settings.MINIO_BUCKET}/{object_name}"
        
        return success_response(data={
            "task_id": task_id,
            "mode": request.mode,
            "result_url": result_url,
            "page_id": request.page_id,
        }, message="Bilingual export completed")
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to upload: {str(e)}")
