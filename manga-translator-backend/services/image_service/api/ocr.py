from __future__ import annotations
"""
OCR 文字识别 API

POST /pages/{page_id}/ocr  — 启动 OCR 识别任务
GET  /pages/{page_id}/ocr/{task_id} — 查询 OCR 识别状态
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

from ..service.ocr_service import OcrService

router = APIRouter(prefix="/pages", tags=["OCR Recognition"])


class OcrRequest(BaseModel):
    region_ids: Optional[List[str]] = None
    language: str = "ja"


class TextBlock(BaseModel):
    region_id: str
    text: str
    confidence: float
    font_size: Optional[int] = None
    font_style: Optional[str] = None
    color: Optional[str] = None


class OcrResponse(BaseModel):
    task_id: str
    status: str
    results: List[TextBlock] = []


@router.post("/{page_id}/ocr", response_model=OcrResponse, summary="OCR 识别文字")
async def recognize_text(
    page_id: str,
    request: OcrRequest = Body(default_factory=OcrRequest),
    db=Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    对已检测出的文字区域执行 OCR 识别，提取原始文字内容。

    - **region_ids**: 可选，指定要识别的区域ID列表；不传则识别全部
    - **language**: 源语言代码，影响 OCR 引擎选择
    """
    service = OcrService(db)
    result = await service.recognize(
        page_id=page_id,
        user_id=current_user["sub"],
        region_ids=request.region_ids,
        language=request.language,
    )
    if not result:
        raise HTTPException(status_code=404, detail="页面不存在")
    return success_response(data=result)


@router.get("/{page_id}/ocr/{task_id}", summary="获取OCR任务状态")
async def get_ocr_status(
    page_id: str,
    task_id: str,
    db=Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """轮询 OCR 识别任务的执行状态"""
    service = OcrService(db)
    result = await service.get_status(page_id, task_id, current_user["sub"])
    if not result:
        raise HTTPException(status_code=404, detail="任务不存在")
    return success_response(data=result)
