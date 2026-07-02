from __future__ import annotations
"""生词本 API"""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from typing import Optional, List
from common.core.dependencies import get_db, get_current_user
from common.core.response import success_response, paginated_response
from ..service.vocab_service import VocabService
from ..repository.vocab_repo import VocabRepo

router = APIRouter(prefix="/vocab", tags=["Vocabulary"])


class VocabCreate(BaseModel):
    word: str
    reading: Optional[str] = None
    meaning: str
    part_of_speech: Optional[str] = None
    language: str = "ja"
    source_page_id: Optional[str] = None
    source_project_id: Optional[str] = None
    notes: Optional[str] = None
    tags: List[str] = []


class VocabUpdate(BaseModel):
    meaning: Optional[str] = None
    reading: Optional[str] = None
    notes: Optional[str] = None
    tags: Optional[List[str]] = None
    mastered: Optional[bool] = None


class VocabResponse(BaseModel):
    vocab_id: str
    word: str
    reading: Optional[str]
    meaning: str
    part_of_speech: Optional[str]
    language: str
    mastered: bool
    review_count: int
    tags: List[str]
    created_at: str


@router.post("", response_model=VocabResponse)
async def create_vocab(
    request: VocabCreate,
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """添加生词"""
    repo = VocabRepo(db)
    service = VocabService(repo)
    result = await service.create(
        user_id=current_user.id,
        word=request.word,
        reading=request.reading,
        meaning=request.meaning,
        part_of_speech=request.part_of_speech,
        language=request.language,
        source_page_id=request.source_page_id,
        source_project_id=request.source_project_id,
        notes=request.notes,
        tags=request.tags,
    )
    return result


@router.get("")
async def list_vocab(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    language: str = Query(None),
    mastered: bool = Query(None),
    tag: str = Query(None),
    keyword: str = Query(None),
    sort_by: str = Query("created_at", description="created_at, word, review_count"),
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """获取生词列表"""
    repo = VocabRepo(db)
    service = VocabService(repo)
    items, total = await service.list_vocab(
        user_id=current_user.id,
        page=page,
        page_size=page_size,
        language=language,
        mastered=mastered,
        tag=tag,
        keyword=keyword,
        sort_by=sort_by,
    )
    return paginated_response(items, total, page, page_size)


@router.get("/{vocab_id}", response_model=VocabResponse)
async def get_vocab(
    vocab_id: str,
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """获取生词详情"""
    repo = VocabRepo(db)
    service = VocabService(repo)
    result = await service.get(vocab_id, current_user.id)
    if not result:
        raise HTTPException(status_code=404, detail="生词不存在")
    return result


@router.put("/{vocab_id}", response_model=VocabResponse)
async def update_vocab(
    vocab_id: str,
    request: VocabUpdate,
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """更新生词"""
    repo = VocabRepo(db)
    service = VocabService(repo)
    result = await service.update(vocab_id, current_user.id, request.dict(exclude_none=True))
    if not result:
        raise HTTPException(status_code=404, detail="生词不存在")
    return result


@router.delete("/{vocab_id}")
async def delete_vocab(
    vocab_id: str,
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """删除生词"""
    repo = VocabRepo(db)
    service = VocabService(repo)
    await service.delete(vocab_id, current_user.id)
    return success_response(message="生词已删除")


@router.post("/{vocab_id}/review")
async def review_vocab(
    vocab_id: str,
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """复习生词（增加复习计数）"""
    repo = VocabRepo(db)
    service = VocabService(repo)
    result = await service.review(vocab_id, current_user.id)
    return success_response(data=result)


@router.post("/{vocab_id}/master")
async def mark_mastered(
    vocab_id: str,
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """标记为已掌握"""
    repo = VocabRepo(db)
    service = VocabService(repo)
    result = await service.mark_mastered(vocab_id, current_user.id)
    return success_response(data=result, message="已标记为掌握")


@router.post("/{vocab_id}/unmaster")
async def unmark_mastered(
    vocab_id: str,
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """取消已掌握标记"""
    repo = VocabRepo(db)
    service = VocabService(repo)
    result = await service.unmark_mastered(vocab_id, current_user.id)
    return success_response(data=result, message="已取消掌握标记")


@router.post("/batch")
async def batch_add_vocab(
    request: List[VocabCreate],
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """批量添加生词"""
    repo = VocabRepo(db)
    service = VocabService(repo)
    results = await service.batch_create(current_user.id, [v.dict() for v in request])
    return success_response(data={"created": len(results)}, message=f"已添加 {len(results)} 个生词")


@router.get("/stats/summary")
async def get_vocab_stats(
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """获取生词统计"""
    repo = VocabRepo(db)
    service = VocabService(repo)
    result = await service.get_stats(current_user.id)
    return success_response(data=result)


# ── P2: Anki/CSV Export (§2.17) ──
@router.get("/export/anki")
async def export_anki(
    language: str = Query(None),
    only_mastered: bool = Query(False),
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Export vocabulary as Anki-compatible CSV (UTF-8 with BOM).
    Columns: Word, Reading, Meaning, PartOfSpeech, Tags, Notes
    Import into Anki: File → Import → CSV, map columns, card type "Basic (and reversed card)".
    """
    from fastapi.responses import StreamingResponse
    import csv, io

    repo = VocabRepo(db)
    service = VocabService(repo)
    items, _ = await service.list_vocab(
        user_id=current_user.id,
        page=1,
        page_size=10000,
        language=language,
        mastered=True if only_mastered else None,
    )

    output = io.StringIO()
    output.write('\ufeff')  # UTF-8 BOM for Excel/Anki compatibility
    writer = csv.writer(output)
    writer.writerow(['Word', 'Reading', 'Meaning', 'PartOfSpeech', 'Tags', 'Notes'])

    for v in items:
        word = v.get('word', '')
        reading = v.get('reading', '')
        meaning = v.get('meaning', '')
        pos = v.get('part_of_speech', '')
        tags = ' '.join(v.get('tags', []) or [])
        notes = v.get('notes', '') or ''

        # Generate back-formatted Anki card content with HTML
        back = f"{meaning}"
        if reading:
            back = f"{reading}<br>{meaning}"
        if pos:
            back += f"<br><i>({pos})</i>"

        writer.writerow([word, reading, meaning, pos, tags, notes])

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": "attachment; filename=manga_vocab_export.csv",
        }
    )
