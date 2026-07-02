from __future__ import annotations
"""
画质增强 API — PRD §2.6 超分辨率、扫描件修复、智能上色、色彩增强
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from typing import Optional

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from common.core.database import get_db
from common.core.security import get_current_user
from common.core.response import success_response

from ..service.enhance_service import EnhanceService

router = APIRouter(prefix="/pages", tags=["Image Enhancement"])


class EnhanceRequest(BaseModel):
    super_resolution: Optional[str] = Field(default=None, description="超分目标: None/2k/4k")
    scan_repair: bool = Field(default=False, description="扫描件画质修复（去噪/去莫尔纹/修复折痕）")
    auto_colorize: bool = Field(default=False, description="黑白漫画智能上色")
    color_style: str = Field(default="modern_shonen", description="上色风格: modern_shonen/classic/pastel/retro")
    enhance_colors: bool = Field(default=False, description="色彩增强优化")
    contrast: float = Field(default=1.15, ge=0.5, le=2.0)
    saturation: float = Field(default=1.10, ge=0.0, le=3.0)
    sharpness: float = Field(default=1.05, ge=0.5, le=2.0)


@router.post("/{page_id}/enhance", summary="画质增强")
async def enhance_page(
    page_id: str,
    request: EnhanceRequest,
    db=Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    对页面进行画质增强处理。
    
    - **super_resolution**: 超分辨率重建 — `2k` (2560x1440) 或 `4k` (3840x2160)
    - **scan_repair**: 扫描件修复 — 去噪点、去莫尔纹、修复折痕、修复线条断裂
    - **auto_colorize**: 黑白漫画智能上色 — 基于风格参考色板
    - **enhance_colors**: 色彩增强 — 对比度/饱和度/锐度自动优化
    """
    service = EnhanceService(db)
    result = await service.enhance_page(
        page_id=page_id,
        user_id=current_user["sub"],
        super_resolution=request.super_resolution,
        scan_repair=request.scan_repair,
        auto_colorize=request.auto_colorize,
        color_style=request.color_style,
        enhance_colors=request.enhance_colors,
        contrast=request.contrast,
        saturation=request.saturation,
        sharpness=request.sharpness,
    )
    if not result:
        raise HTTPException(status_code=404, detail="页面不存在")
    return success_response(data=result)


@router.get("/{page_id}/enhance/{task_id}", summary="获取增强状态")
async def get_enhance_status(
    page_id: str,
    task_id: str,
    db=Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """轮询画质增强任务的执行状态"""
    service = EnhanceService(db)
    result = await service.get_status(page_id, task_id, current_user["sub"])
    if not result:
        raise HTTPException(status_code=404, detail="任务不存在")
    return success_response(data=result)
