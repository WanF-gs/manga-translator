from __future__ import annotations
"""
文字渲染（译文回填） API

POST /pages/{page_id}/render  — 启动文字渲染任务
GET  /pages/{page_id}/render/{task_id} — 查询渲染状态
"""
from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from common.core.database import get_db
from common.core.security import get_current_user
from common.core.response import success_response

from ..service.render_service import RenderService

router = APIRouter(prefix="/pages", tags=["Text Rendering"])


class RegionRender(BaseModel):
    region_id: str
    translated_text: str
    font_id: Optional[str] = None
    font_size: Optional[int] = None
    font_family: Optional[str] = None
    font_color: Optional[str] = None
    alignment: Optional[str] = "left"  # left, center, right
    line_spacing: Optional[float] = 1.2


class RenderRequest(BaseModel):
    regions: Optional[List[RegionRender]] = None
    preserve_style: bool = True
    auto_resize: bool = True


class RenderResponse(BaseModel):
    task_id: str
    status: str
    result_url: Optional[str] = None
    warnings: List[str] = []


@router.post("/{page_id}/render", response_model=RenderResponse, summary="渲染译文")
async def render_text(
    page_id: str,
    request: RenderRequest = Body(default_factory=RenderRequest),
    db=Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    将翻译后的文字渲染回图像上（在修复后的空白区域填入译文）。

    - **regions**: 每个区域指定 `region_id` + `translated_text` + 可选样式
    - **preserve_style**: 保留原文字样式（字号/颜色/对齐）
    - **auto_resize**: 译文过长时自动缩小字号
    """
    import logging
    logger = logging.getLogger(__name__)
    try:
        # Convert Pydantic models to dicts for the service
        regions_data = None
        if request.regions:
            regions_data = [r.model_dump() if hasattr(r, 'model_dump') else dict(r) for r in request.regions]
        service = RenderService(db)
        result = await service.render(
            page_id=page_id,
            user_id=current_user["sub"],
            regions=regions_data,
            preserve_style=request.preserve_style,
            auto_resize=request.auto_resize,
        )
        if not result:
            raise HTTPException(status_code=404, detail="页面不存在")
        return success_response(data=result)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Render failed for page {page_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{page_id}/render/{task_id}", summary="获取渲染状态")
async def get_render_status(
    page_id: str,
    task_id: str,
    db=Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """轮询文字渲染任务的执行状态"""
    service = RenderService(db)
    result = await service.get_status(page_id, task_id, current_user["sub"])
    if not result:
        raise HTTPException(status_code=404, detail="任务不存在")
    return success_response(data=result)
