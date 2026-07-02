from __future__ import annotations
"""导出 API"""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from typing import List, Optional
from common.core.dependencies import get_db, get_current_user
from common.core.response import success_response, paginated_response
from ..service.export_service import ExportService
from ..repository.export_repo import ExportRepo

router = APIRouter(prefix="/exports", tags=["Export"])


class ExportSingleRequest(BaseModel):
    page_id: str
    format: str = "png"  # png, jpg, webp, pdf
    quality: int = Field(default=90, ge=1, le=100)
    include_original: bool = False
    include_detected: bool = False
    bilingual: bool = False


class ExportChapterRequest(BaseModel):
    chapter_id: str
    format: str = "png"
    quality: int = Field(default=90, ge=1, le=100)
    archive_format: Optional[str] = None  # zip, cbz, pdf
    bilingual: bool = False
    bilingual_mode: str = "side-by-side"  # side-by-side, top-bottom, in-bubble
    naming_rule: str = "${page}"  # 自定义命名规则: ${project}_${chapter}_${page}
    page_range: Optional[str] = None  # "1-10" or "1,3,5"


class ExportProjectRequest(BaseModel):
    project_id: str
    format: str = "png"
    quality: int = Field(default=90, ge=1, le=100)
    archive_format: Optional[str] = None
    bilingual: bool = False
    bilingual_mode: str = "side-by-side"
    naming_rule: str = "${chapter}/${page}"
    per_chapter_cbz: bool = False  # 按章节分包 CBZ
    include_chapters: Optional[List[str]] = None


class ExportResponse(BaseModel):
    task_id: str
    status: str
    download_url: Optional[str] = None
    pages_exported: int = 0
    file_size: Optional[str] = None


@router.post("/single", response_model=ExportResponse)
async def export_single(
    request: ExportSingleRequest,
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """导出单页"""
    repo = ExportRepo(db)
    service = ExportService(repo, db)
    try:
        result = await service.export_single(
            user_id=current_user["sub"],
            page_id=request.page_id,
            format=request.format,
            quality=request.quality,
            include_original=request.include_original,
            include_detected=request.include_detected,
            bilingual=request.bilingual,
        )
        return success_response(data=result)
    except Exception as e:
        from common.core.response import error_response
        return error_response(code=5000, message=f"Export failed: {str(e)}", status_code=500)


@router.post("/chapter", response_model=ExportResponse)
async def export_chapter(
    request: ExportChapterRequest,
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """导出章节（支持 CBZ/PDF/ZIP 打包 & 双语对照 & 自定义命名）"""
    repo = ExportRepo(db)
    service = ExportService(repo, db)
    try:
        result = await service.export_chapter(
            user_id=current_user["sub"],
            chapter_id=request.chapter_id,
            format=request.format,
            quality=request.quality,
            archive_format=request.archive_format,
            bilingual=request.bilingual,
            bilingual_mode=request.bilingual_mode,
            page_range=request.page_range,
            naming_rule=request.naming_rule,
        )
        return success_response(data=result)
    except Exception as e:
        from common.core.response import error_response
        return error_response(code=5000, message=f"Export failed: {str(e)}", status_code=500)


@router.post("/project", response_model=ExportResponse)
async def export_project(
    request: ExportProjectRequest,
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """导出项目（全部章节，支持按章节分包 CBZ 和自定义命名）"""
    repo = ExportRepo(db)
    service = ExportService(repo, db)
    try:
        result = await service.export_project(
            user_id=current_user["sub"],
            project_id=request.project_id,
            format=request.format,
            quality=request.quality,
            archive_format=request.archive_format,
            bilingual=request.bilingual,
            bilingual_mode=request.bilingual_mode,
            include_chapters=request.include_chapters,
            naming_rule=request.naming_rule,
            per_chapter_cbz=request.per_chapter_cbz,
        )
        return success_response(data=result)
    except Exception as e:
        from common.core.response import error_response
        return error_response(code=5000, message=f"Export failed: {str(e)}", status_code=500)


@router.get("/{task_id}/status")
async def get_export_status(
    task_id: str,
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """获取导出任务状态"""
    repo = ExportRepo(db)
    service = ExportService(repo, db)
    result = await service.get_export_status(task_id, current_user["sub"])
    if not result:
        raise HTTPException(status_code=404, detail="导出任务不存在")
    return success_response(data=result)


@router.get("/{task_id}/download")
async def get_download_url(
    task_id: str,
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """获取下载链接"""
    repo = ExportRepo(db)
    service = ExportService(repo, db)
    url = await service.get_download_url(task_id, current_user["sub"])
    if not url:
        raise HTTPException(status_code=404, detail="导出任务不存在或尚未完成")
    return success_response(data={"download_url": url})


# ── PRD-compliant /export/* alias router ──
# Mirrors the /exports/* routes under /export/* (singular) per PRD spec.
# The gateway proxies both /export/* and /exports/* to this service.
export_router = APIRouter(prefix="/export", tags=["Export-PRD"])


@export_router.post("/single", response_model=ExportResponse)
async def export_single_prd(
    request: ExportSingleRequest,
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """导出单页（PRD规范路径）"""
    repo = ExportRepo(db)
    service = ExportService(repo, db)
    try:
        result = await service.export_single(
            user_id=current_user["sub"],
            page_id=request.page_id,
            format=request.format,
            quality=request.quality,
            include_original=request.include_original,
            include_detected=request.include_detected,
            bilingual=request.bilingual,
        )
        return result
    except Exception as e:
        from common.core.response import error_response
        return error_response(code=5000, message=f"Export failed: {str(e)}", status_code=500)


@export_router.post("/batch", response_model=ExportResponse)
async def export_batch_prd(
    request: ExportChapterRequest,
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """批量导出（PRD规范路径：章节级批量导出）"""
    repo = ExportRepo(db)
    service = ExportService(repo, db)
    try:
        result = await service.export_chapter(
            user_id=current_user["sub"],
            chapter_id=request.chapter_id,
            format=request.format,
            quality=request.quality,
            archive_format=request.archive_format,
            bilingual=request.bilingual,
            bilingual_mode=request.bilingual_mode,
            page_range=request.page_range,
            naming_rule=request.naming_rule,
        )
        return result
    except Exception as e:
        from common.core.response import error_response
        return error_response(code=5000, message=f"Export failed: {str(e)}", status_code=500)


@export_router.get("/tasks")
async def get_export_tasks_prd(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: str = Query(None),
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """GET /api/v1/export/tasks — PRD规范路径：导出任务列表"""
    repo = ExportRepo(db)
    service = ExportService(repo, db)
    items, total = await service.list_tasks(
        user_id=current_user["sub"],
        page=page,
        page_size=page_size,
        status=status,
    )
    return paginated_response(items=items, page=page, page_size=page_size, total=total)


@export_router.get("/{task_id}/status")
async def get_export_status_prd(
    task_id: str,
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """获取导出任务状态（PRD规范路径）"""
    repo = ExportRepo(db)
    service = ExportService(repo, db)
    result = await service.get_export_status(task_id, current_user["sub"])
    if not result:
        raise HTTPException(status_code=404, detail="导出任务不存在")
    return result


@export_router.get("/download/{task_id}")
async def get_download_url_prd(
    task_id: str,
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """获取下载链接（PRD规范路径：/export/download/:tid）"""
    repo = ExportRepo(db)
    service = ExportService(repo, db)
    url = await service.get_download_url(task_id, current_user["sub"])
    if not url:
        raise HTTPException(status_code=404, detail="导出任务不存在或尚未完成")
    return success_response(data={"download_url": url})


@export_router.post("/project", response_model=ExportResponse)
async def export_project_prd(
    request: ExportProjectRequest,
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """导出项目（PRD规范路径：/export/project）"""
    repo = ExportRepo(db)
    service = ExportService(repo, db)
    try:
        result = await service.export_project(
            user_id=current_user["sub"],
            project_id=request.project_id,
            format=request.format,
            quality=request.quality,
            archive_format=request.archive_format,
            bilingual=request.bilingual,
            bilingual_mode=request.bilingual_mode,
            include_chapters=request.include_chapters,
            naming_rule=request.naming_rule,
            per_chapter_cbz=request.per_chapter_cbz,
        )
        return result
    except Exception as e:
        from common.core.response import error_response
        return error_response(code=5000, message=f"Export failed: {str(e)}", status_code=500)


# ── RESTful 别名：/pages/{id}/export 与 /chapters/{id}/export ──
pages_export_router = APIRouter(prefix="/pages", tags=["Export-Pages"])
chapters_export_router = APIRouter(prefix="/chapters", tags=["Export-Chapters"])


@pages_export_router.post("/{page_id}/export", response_model=ExportResponse)
async def export_page_rest(
    page_id: str,
    format: str = Query("png"),
    quality: int = Query(90, ge=1, le=100),
    bilingual: bool = Query(False),
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """POST /api/v1/pages/{page_id}/export — 单页导出 REST 别名"""
    repo = ExportRepo(db)
    service = ExportService(repo, db)
    try:
        return await service.export_single(
            user_id=current_user["sub"],
            page_id=page_id,
            format=format,
            quality=quality,
            include_original=False,
            include_detected=False,
            bilingual=bilingual,
        )
    except Exception as e:
        from common.core.response import error_response
        return error_response(code=5000, message=f"Export failed: {str(e)}", status_code=500)


@chapters_export_router.post("/{chapter_id}/export", response_model=ExportResponse)
async def export_chapter_rest(
    chapter_id: str,
    format: str = Query("png"),
    quality: int = Query(90, ge=1, le=100),
    bilingual: bool = Query(False),
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """POST /api/v1/chapters/{chapter_id}/export — 章节导出 REST 别名"""
    repo = ExportRepo(db)
    service = ExportService(repo, db)
    try:
        return await service.export_chapter(
            user_id=current_user["sub"],
            chapter_id=chapter_id,
            format=format,
            quality=quality,
            bilingual=bilingual,
        )
    except Exception as e:
        from common.core.response import error_response
        return error_response(code=5000, message=f"Export failed: {str(e)}", status_code=500)
