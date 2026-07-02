from __future__ import annotations
"""
Undo/Redo API endpoints.
POST /pages/{page_id}/undo
POST /pages/{page_id}/redo
GET  /pages/{page_id}/history
GET  /pages/{page_id}/undo-status
"""
from fastapi import APIRouter, Depends, HTTPException

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from common.core.database import get_db
from common.core.response import success_response, error_response
from common.core.security import get_current_user

from ..service.undo_service import UndoRedoService

router = APIRouter(tags=["Undo/Redo"])


@router.post("/pages/{page_id}/undo", summary="撤销上一步操作")
async def undo_operation(
    page_id: str,
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Undo the last operation on a page.
    Restores the page to the state before the last operation.
    Supports per-page undo stack with 20-step limit.
    """
    service = UndoRedoService(db)
    result = await service.undo(page_id, current_user["sub"])
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("message", "Undo failed"))
    return success_response(data=result, message=result.get("message", "Operation undone"))


@router.post("/pages/{page_id}/redo", summary="重做已撤销操作")
async def redo_operation(
    page_id: str,
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Redo the last undone operation.
    Re-applies the operation that was previously undone.
    """
    service = UndoRedoService(db)
    result = await service.redo(page_id, current_user["sub"])
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("message", "Redo failed"))
    return success_response(data=result, message=result.get("message", "Operation redone"))


@router.get("/pages/{page_id}/history", summary="获取操作历史")
async def get_operation_history(
    page_id: str,
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Get the operation history for a page (last 20 operations)."""
    service = UndoRedoService(db)
    history = await service.get_history(page_id, current_user["sub"])
    return success_response(data={"history": history, "total": len(history)})


@router.get("/pages/{page_id}/undo-status", summary="检查撤销/重做状态")
async def get_undo_status(
    page_id: str,
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Check if undo and redo are available for this page."""
    service = UndoRedoService(db)
    can_undo = await service.can_undo(page_id, current_user["sub"])
    can_redo = await service.can_redo(page_id, current_user["sub"])
    return success_response(data={
        "page_id": page_id,
        "can_undo": can_undo,
        "can_redo": can_redo,
    })
