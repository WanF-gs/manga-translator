from __future__ import annotations
"""
文字区域检测 API

POST /pages/{page_id}/detect  — 启动文字区域检测任务
GET  /pages/{page_id}/detect/{task_id} — 查询检测任务状态
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from common.core.database import get_db
from common.core.security import get_current_user
from common.core.response import success_response

from ..service.detect_service import DetectService

router = APIRouter(prefix="/pages", tags=["Text Detection"])


class DetectResponse(BaseModel):
    task_id: str
    status: str
    regions: List[dict] = []
    image_url: Optional[str] = None


@router.post("/{page_id}/detect", response_model=DetectResponse, summary="检测文字区域")
async def detect_text_regions(
    page_id: str,
    detect_all: bool = False,
    language: str = "ja",
    db=Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    检测漫画页面中的文字区域（气泡/旁白/拟声词等）。

    - **page_id**: 页面唯一ID
    - **detect_all**: 是否检测所有类型的文字区域（默认仅检测气泡）
    - **language**: 源语言代码（ja/en/zh/ko）
    """
    service = DetectService(db)
    result = await service.detect(page_id, current_user["sub"], detect_all, language)
    if not result:
        raise HTTPException(status_code=404, detail="页面不存在")
    return success_response(data=result)


@router.get("/{page_id}/detect/{task_id}", summary="获取检测任务状态")
async def get_detect_status(
    page_id: str,
    task_id: str,
    db=Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """轮询文字检测任务的执行状态"""
    service = DetectService(db)
    result = await service.get_status(page_id, task_id, current_user["sub"])
    if not result:
        raise HTTPException(status_code=404, detail="任务不存在")
    return success_response(data=result)
