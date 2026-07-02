from __future__ import annotations
"""
Batch processing pipeline API.
POST /projects/{project_id}/batch-process — Start full pipeline
POST /projects/{project_id}/simple-translate — One-click simple mode
"""
import uuid
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from typing import List, Optional

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from common.core.database import get_db
from common.core.response import success_response, error_response
from common.core.security import get_current_user
from common.core.dependencies import get_current_user

from ..service.pipeline_service import PipelineService
from ..service.undo_service import UndoRedoService

router = APIRouter(tags=["Pipeline"])


# ===================== Request Models =====================

class BatchProcessRequest(BaseModel):
    operations: Optional[List[str]] = None  # detect, ocr, translate, inpaint, render
    chapters: Optional[List[str]] = None  # Specific chapter IDs, all if None
    target_lang: str = "zh-CN"
    source_lang: str = "ja"
    engine: str = "auto"


class BatchProcessResponse(BaseModel):
    batch_id: str
    status: str
    total_pages: int
    operations: List[str]
    message: str


class BatchStatusResponse(BaseModel):
    batch_id: str
    status: str  # pending, running, paused, completed, failed, cancelled
    total_pages: int
    completed_pages: int
    failed_pages: int
    current_step: str
    step_progress: float
    overall_progress: float
    errors: List[dict]
    started_at: Optional[str] = None
    updated_at: Optional[str] = None


class SimpleTranslateRequest(BaseModel):
    target_lang: str = "zh-CN"
    chapters: Optional[List[str]] = None


class SimpleTranslateResponse(BaseModel):
    batch_id: str
    status: str
    total_pages: int
    message: str


# ===================== Endpoints =====================

@router.post("/projects/{project_id}/batch-process", response_model=BatchProcessResponse)
async def start_batch_process(
    project_id: str,
    request: BatchProcessRequest,
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Start full pipeline for a project/chapter.
    
    Pipeline: detect → OCR → translate → inpaint → render
    
    - operations: Which steps to run (default: all)
    - chapters: Specific chapter IDs (default: all chapters)
    - target_lang: Target language for translation
    """
    service = PipelineService(db)
    try:
        result = await service.start_batch_process(
            project_id=project_id,
            user_id=current_user["sub"],
            operations=request.operations,
            chapters=request.chapters,
            target_lang=request.target_lang,
            source_lang=request.source_lang,
            engine=request.engine,
        )
        return BatchProcessResponse(**result)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/projects/{project_id}/batch-process/{batch_id}/status", response_model=BatchStatusResponse)
async def get_batch_status(
    project_id: str,
    batch_id: str,
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Get batch processing progress."""
    service = PipelineService(db)
    result = await service.get_batch_status(batch_id)
    if not result:
        raise HTTPException(status_code=404, detail="Batch not found")
    return BatchStatusResponse(**result)


@router.post("/projects/{project_id}/batch-process/{batch_id}/pause")
async def pause_batch(
    project_id: str,
    batch_id: str,
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Pause a running batch process."""
    service = PipelineService(db)
    success = await service.pause_batch(batch_id)
    if not success:
        raise HTTPException(status_code=404, detail="Batch not found or cannot be paused")
    return success_response(message="Batch paused")


@router.post("/projects/{project_id}/batch-process/{batch_id}/resume")
async def resume_batch(
    project_id: str,
    batch_id: str,
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Resume a paused batch process."""
    service = PipelineService(db)
    success = await service.resume_batch(batch_id)
    if not success:
        raise HTTPException(status_code=404, detail="Batch not found or cannot be resumed")
    return success_response(message="Batch resumed")


@router.post("/projects/{project_id}/batch-process/{batch_id}/cancel")
async def cancel_batch(
    project_id: str,
    batch_id: str,
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Cancel a batch process."""
    service = PipelineService(db)
    success = await service.cancel_batch(batch_id)
    if not success:
        raise HTTPException(status_code=404, detail="Batch not found or cannot be cancelled")
    return success_response(message="Batch cancelled")


@router.post("/projects/{project_id}/simple-translate", response_model=SimpleTranslateResponse)
async def simple_translate(
    project_id: str,
    request: SimpleTranslateRequest,
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    One-click simple mode translation.
    
    Automatically runs the full pipeline: detect → OCR → translate → inpaint → render
    No manual configuration needed.
    """
    service = PipelineService(db)
    try:
        result = await service.start_simple_translate(
            project_id=project_id,
            user_id=current_user["sub"],
            target_lang=request.target_lang,
            chapters=request.chapters,
        )
        return SimpleTranslateResponse(**result)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
