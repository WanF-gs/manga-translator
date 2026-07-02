from __future__ import annotations
"""阅读数据 API"""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from typing import Optional
from common.core.dependencies import get_db, get_current_user
from common.core.response import success_response, paginated_response
from ..service.reader_service import ReaderService
from ..service.dictionary_service import lookup_word, annotate_japanese
from ..repository.reader_repo import ReaderRepo

router = APIRouter(prefix="/reader", tags=["Reading Data"])


# ============================================================
# §2.7.3 假名/罗马音标注 & §2.7.4 单词即点即译
# ============================================================

@router.get("/dictionary/lookup", summary="单词即点即译 (§2.7.4)")
async def dictionary_lookup(
    word: str = Query(..., min_length=1, max_length=50, description="要查询的单词"),
    lang: str = Query("ja", description="语言: ja/en/ko"),
    current_user=Depends(get_current_user),
):
    """查询单词释义、词性、例句（内置词典 → Jisho → LLM 多级回退）。"""
    result = await lookup_word(word, lang)
    return success_response(data=result)


class AnnotateRequest(BaseModel):
    text: str = Field(..., max_length=2000)
    lang: str = "ja"


@router.post("/annotate", summary="振假名/罗马音标注 (§2.7.3)")
async def annotate_text(
    body: AnnotateRequest,
    current_user=Depends(get_current_user),
):
    """为日文文本生成振假名(furigana)与罗马音(romaji)逐词标注。"""
    if body.lang != "ja":
        return success_response(data={"text": body.text, "romaji": "", "tokens": []})
    return success_response(data=annotate_japanese(body.text))



class ReadingProgressUpdate(BaseModel):
    page_id: str
    chapter_id: str
    project_id: str
    scroll_position: float = 0.0
    zoom_level: float = 1.0


class ReadingSessionCreate(BaseModel):
    project_id: str
    chapter_id: str
    start_page_id: str


class ReadingSessionResponse(BaseModel):
    session_id: str
    project_id: str
    chapter_id: str
    current_page_id: str
    progress_percent: float
    total_pages: int
    read_pages: int
    created_at: str
    last_read_at: str


@router.post("/sessions", response_model=ReadingSessionResponse)
async def create_reading_session(
    request: ReadingSessionCreate,
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """创建阅读会话"""
    repo = ReaderRepo(db)
    service = ReaderService(repo)
    result = await service.create_session(
        user_id=current_user.id,
        project_id=request.project_id,
        chapter_id=request.chapter_id,
        start_page_id=request.start_page_id,
    )
    return result


@router.get("/sessions")
async def list_sessions(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    project_id: str = Query(None),
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """获取阅读会话列表"""
    repo = ReaderRepo(db)
    service = ReaderService(repo)
    items, total = await service.list_sessions(
        user_id=current_user.id,
        page=page,
        page_size=page_size,
        project_id=project_id,
    )
    return paginated_response(items, total, page, page_size)


@router.get("/sessions/{session_id}", response_model=ReadingSessionResponse)
async def get_session(
    session_id: str,
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """获取阅读会话详情"""
    repo = ReaderRepo(db)
    service = ReaderService(repo)
    result = await service.get_session(session_id, current_user.id)
    if not result:
        raise HTTPException(status_code=404, detail="阅读会话不存在")
    return result


@router.put("/progress")
@router.post("/progress")
async def update_progress(
    request: ReadingProgressUpdate,
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """更新阅读进度"""
    repo = ReaderRepo(db)
    service = ReaderService(repo)
    result = await service.update_progress(
        user_id=current_user.id,
        page_id=request.page_id,
        chapter_id=request.chapter_id,
        project_id=request.project_id,
        scroll_position=request.scroll_position,
        zoom_level=request.zoom_level,
    )
    return success_response(data=result)


@router.get("/progress/{project_id}")
async def get_progress(
    project_id: str,
    chapter_id: str = Query(None),
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """获取阅读进度"""
    repo = ReaderRepo(db)
    service = ReaderService(repo)
    result = await service.get_progress(
        user_id=current_user.id,
        project_id=project_id,
        chapter_id=chapter_id,
    )
    return success_response(data=result)


@router.get("/history")
async def get_reading_history(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """获取阅读历史"""
    repo = ReaderRepo(db)
    service = ReaderService(repo)
    items, total = await service.get_history(
        user_id=current_user.id,
        page=page,
        page_size=page_size,
    )
    return paginated_response(items, total, page, page_size)


@router.get("/stats/{project_id}")
async def get_reading_stats(
    project_id: str,
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """获取阅读统计"""
    repo = ReaderRepo(db)
    service = ReaderService(repo)
    result = await service.get_stats(current_user.id, project_id)
    return success_response(data=result)


@router.get("/{chapter_id}/pages")
async def get_chapter_pages(
    chapter_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(30, ge=1, le=100),
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """获取章节页面列表（阅读视图）"""
    repo = ReaderRepo(db)
    page_list, total = await repo.get_chapter_pages(chapter_id, page, page_size)
    return paginated_response(page_list, total, page, page_size)


@router.delete("/sessions/{session_id}")
async def delete_session(
    session_id: str,
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """删除阅读会话"""
    repo = ReaderRepo(db)
    service = ReaderService(repo)
    await service.delete_session(session_id, current_user.id)
    return success_response(message="阅读会话已删除")
