from __future__ import annotations
"""
图像修复（抹除原文） API

POST /pages/{page_id}/inpaint  — 启动背景修复任务
GET  /pages/{page_id}/inpaint/{task_id} — 查询修复状态
"""
from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel
from typing import List, Optional

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from common.core.database import get_db
from common.core.security import get_current_user
from common.core.response import success_response

from ..service.inpaint_service import InpaintService

router = APIRouter(prefix="/pages", tags=["Image Inpainting"])


class InpaintRequest(BaseModel):
    region_ids: Optional[List[str]] = None
    method: str = "lama"  # lama, sd_inpaint, telea
    background_preserve: bool = True


class InpaintResponse(BaseModel):
    task_id: str
    status: str
    result_url: Optional[str] = None


@router.post("/{page_id}/inpaint", response_model=InpaintResponse, summary="擦除原文")
async def inpaint_page(
    page_id: str,
    request: InpaintRequest = Body(default_factory=InpaintRequest),
    db=Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    对指定区域执行背景修复（inpainting），擦除原始文字。
    修复完成后自动计算SSIM擦除质量评分（§2.4.0）。
    """
    service = InpaintService(db)
    result = await service.inpaint(
        page_id=page_id,
        user_id=current_user["sub"],
        region_ids=request.region_ids,
        method=request.method,
        background_preserve=request.background_preserve,
    )
    if not result:
        raise HTTPException(status_code=404, detail="页面不存在")
    return success_response(data=result)


@router.get("/{page_id}/inpaint/{task_id}", summary="获取修复状态")
async def get_inpaint_status(
    page_id: str,
    task_id: str,
    db=Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """轮询背景修复任务的执行状态"""
    service = InpaintService(db)
    result = await service.get_status(page_id, task_id, current_user["sub"])
    if not result:
        raise HTTPException(status_code=404, detail="任务不存在")
    return success_response(data=result)


@router.get("/{page_id}/inpaint/quality", summary="获取擦除质量评分 [v3.0 §2.4.0]")
async def get_inpaint_quality(
    page_id: str,
    db=Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    获取页面擦除质量评分（SSIM + 分背景类型评估）。
    
    返回：
    - overall_score: 0-100 综合质量评分
    - per_region: 每个区域的 SSIM、背景类型、是否通过
    - failed_regions: 需要人工修复的区域列表
    - summary: 总数/通过/失败统计
    """
    from sqlalchemy import select
    from common.models.page import Page
    
    result = await db.execute(select(Page).where(Page.page_id == page_id))
    page = result.scalar_one_or_none()
    if not page:
        raise HTTPException(status_code=404, detail="页面不存在")
    
    quality_score = getattr(page, 'erase_quality_score', None)
    needs_repair = getattr(page, 'status', None) == 'needs_repair'
    
    return success_response(data={
        "page_id": page_id,
        "erase_quality_score": quality_score,
        "needs_repair": needs_repair,
        "threshold": 60,  # PRD: 低于60分提示用户复核
        "status": page.status if page else "unknown",
    })
