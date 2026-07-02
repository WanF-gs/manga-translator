from __future__ import annotations
"""Translation Memory API"""
from fastapi import APIRouter, Depends, Query
from common.core.response import success_response, paginated_response
from common.core.dependencies import get_db, get_current_user
from ..service.memory_service import MemoryService
from ..repository.memory_repo import MemoryRepository as MemoryRepo

router = APIRouter(prefix="/memory", tags=["Translation Memory"])


@router.get("")
async def list_memory(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    keyword: str = Query(None, description="搜索关键词"),
    source_lang: str = Query(None),
    target_lang: str = Query(None),
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """获取翻译记忆列表"""
    service = MemoryService(db)
    items, total = await service.list_memory(
        user_id=current_user["sub"],
        page=page,
        page_size=page_size,
        keyword=keyword,
        source_lang=source_lang,
        target_lang=target_lang,
    )
    return paginated_response(items, total, page, page_size)


@router.delete("/{memory_id}")
async def delete_memory(
    memory_id: str,
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """删除翻译记忆条目"""
    service = MemoryService(db)
    await service.delete_memory(memory_id, current_user["sub"])
    return success_response(message="翻译记忆已删除")


@router.delete("/clear")
async def clear_memory(
    source_lang: str = Query(None),
    target_lang: str = Query(None),
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """清空翻译记忆"""
    service = MemoryService(db)
    count = await service.clear_memory(
        user_id=current_user["sub"],
        source_lang=source_lang,
        target_lang=target_lang,
    )
    return success_response(data={"deleted": count}, message=f"已清空 {count} 条翻译记忆")
