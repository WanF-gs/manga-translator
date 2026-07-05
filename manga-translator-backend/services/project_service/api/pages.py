from __future__ import annotations
"""
Page management API routes.
"""
import logging
from typing import List

from fastapi import APIRouter, Depends, File, Query, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from common.core.database import get_db
from common.core.response import success_response, created_response, error_response, paginated_response
from common.core.security import get_current_user, get_optional_user

from ..service.page_service import PageService

router = APIRouter()
logger = logging.getLogger(__name__)

# Separate router for upload endpoints only — mounted at /api/v1 prefix
# to support /chapters/{cid}/pages/upload paths without polluting
# the root /api/v1 namespace with /{page_id} catch-all routes.
upload_router = APIRouter()


# B5 FIX: Root GET endpoint for /api/v1/pages
@router.get("")
async def pages_root(current_user: dict = Depends(get_current_user)):
    """GET /api/v1/pages — Pages management index."""
    return {
        "service": "pages-management",
        "endpoints": [
            "GET /api/v1/chapters/{chapter_id}/pages",
            "POST /api/v1/pages/chapters/{chapter_id}/pages/upload",
            "POST /api/v1/pages/chapters/{chapter_id}/pages/upload-archive",
            "GET /api/v1/pages/{page_id}",
            "PUT /api/v1/pages/{page_id}/regions",
            "PUT /api/v1/pages/{page_id}/sort",
            "PUT /api/v1/pages/{page_id}/status",
            "DELETE /api/v1/pages/{page_id}",
            "POST /api/v1/pages/{page_id}/retry",
            "GET /api/v1/pages/{page_id}/image",
        ],
        "version": "3.0",
    }


# File size limit for page uploads (50MB per image)
MAX_TOTAL_UPLOAD_SIZE = 500 * 1024 * 1024  # 500MB total
MAX_PER_FILE_SIZE = 50 * 1024 * 1024       # 50MB per file
ALLOWED_CONTENT_TYPES = {
    "image/png", "image/jpeg", "image/webp",
    "image/bmp", "image/tiff", "image/gif",
}


@upload_router.post("/chapters/{chapter_id}/pages/upload")
async def upload_pages(
    chapter_id: str,
    files: List[UploadFile] = File(None, description="Image files to upload (PNG/JPG/WebP/BMP)"),
    file: UploadFile = File(None, description="Single file upload alias (backward compat)"),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    Upload pages to a chapter. Real implementation with file storage.
    
    - Accepts one or more image files
    - Validates file type and size
    - Stores files via FileService (local storage / MinIO)
    - Creates Page records in database
    
    Returns created page list with URLs and metadata.
    """
    # Backward compat: if caller sends "file" (singular), treat as single-element list
    if not files and file and file.filename:
        files = [file]

    if not files:
        return error_response(code=4001, message="No files provided")

    # Validate files before processing
    total_size = 0
    validated_files = []
    for upload_file in files:
        if not upload_file.filename:
            continue

        # Check content type
        content_type = upload_file.content_type or ""
        ext = os.path.splitext(upload_file.filename)[1].lower()
        valid_exts = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff", ".tif", ".gif"}
        if content_type not in ALLOWED_CONTENT_TYPES and ext not in valid_exts:
            return error_response(
                code=4003,
                message=f"Unsupported file type: {upload_file.filename} ({content_type or ext})",
                status_code=415,
            )

        validated_files.append(upload_file)

    if not validated_files:
        return error_response(code=4001, message="No valid files to upload")

    # Read file contents
    files_data = []
    for upload_file in validated_files:
        content = await upload_file.read()
        file_size = len(content)

        if file_size > MAX_PER_FILE_SIZE:
            return error_response(
                code=4001,
                message=f"File too large: {upload_file.filename} ({file_size / (1024*1024):.1f}MB > 50MB)",
                status_code=413,
            )

        if file_size == 0:
            continue

        total_size += file_size
        if total_size > MAX_TOTAL_UPLOAD_SIZE:
            return error_response(
                code=4001,
                message=f"Total upload size exceeds {MAX_TOTAL_UPLOAD_SIZE / (1024*1024):.0f}MB limit",
                status_code=413,
            )

        files_data.append({
            "filename": upload_file.filename,
            "content": content,
            "size": file_size,
        })

    if not files_data:
        return error_response(code=4001, message="All files were empty")

    service = PageService(db)
    try:
        result = await service.upload_pages(chapter_id, current_user["sub"], files_data)
        return created_response(data=result, message=f"Uploaded {result['total_uploaded']} page(s)")
    except ValueError as e:
        return error_response(code=4001, message=str(e), status_code=404)
    except Exception as e:
        return error_response(code=5000, message=f"Upload failed: {str(e)}")


@router.get("/chapters/{chapter_id}/pages")
async def list_pages(
    chapter_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(9999, ge=1, le=10000),
    status: str = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """List pages in a chapter."""
    service = PageService(db)
    try:
        items, total = await service.list_pages(chapter_id, page, page_size, status)
        return paginated_response(items=items, page=page, page_size=page_size, total=total)
    except Exception as e:
        return error_response(code=1002, message=str(e), status_code=404)


# P0-FIX-02: Alias for GET /api/v1/chapters/{chapter_id}/pages
# The main router is mounted at /api/v1/pages, so /chapters/{cid}/pages resolves to
# /api/v1/pages/chapters/{cid}/pages. This alias on upload_router (mounted at /api/v1)
# provides the correct path /api/v1/chapters/{cid}/pages.
@upload_router.get("/chapters/{chapter_id}/pages")
async def list_pages_v2(
    chapter_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(9999, ge=1, le=10000),
    status: str = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """GET /api/v1/chapters/{cid}/pages — List pages in a chapter."""
    return await list_pages(chapter_id, page, page_size, status, db, current_user)


@router.get("/{page_id}")
async def get_page(
    page_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Get page detail with text regions."""
    service = PageService(db)
    try:
        result = await service.get_page_detail(page_id)
        return success_response(data=result)
    except Exception as e:
        return error_response(code=1002, message=str(e), status_code=404)


@router.put("/{page_id}/regions")
async def update_regions(
    page_id: str,
    request_data: dict,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Update text regions on a page."""
    service = PageService(db)
    try:
        result = await service.update_regions(page_id, request_data)
        return success_response(data=result, message="Regions updated")
    except Exception as e:
        logger.exception(f"update_regions FAILED for page {page_id}: {type(e).__name__}: {e}")
        return error_response(code=1001, message=str(e))


@router.delete("/{page_id}")
async def delete_page(
    page_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Delete a page."""
    service = PageService(db)
    try:
        await service.delete_page(page_id)
        return success_response(message="Page deleted")
    except Exception as e:
        return error_response(code=1002, message=str(e), status_code=404)


@router.put("/{page_id}/sort")
async def sort_page(
    page_id: str,
    request_data: dict,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Update page sort order."""
    service = PageService(db)
    try:
        result = await service.update_page(page_id, {"sort_order": request_data.get("sort_order")})
        return success_response(data=result, message="Sort order updated")
    except Exception as e:
        return error_response(code=1001, message=str(e))


@router.put("/{page_id}/status")
async def update_page_status(
    page_id: str,
    request_data: dict,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Update page processing status."""
    service = PageService(db)
    try:
        result = await service.update_page(page_id, {"status": request_data.get("status")})
        return success_response(data=result, message="Status updated")
    except Exception as e:
        return error_response(code=1001, message=str(e))


@router.post("/{page_id}/retry")
async def retry_page(
    page_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Retry failed page processing."""
    service = PageService(db)
    try:
        result = await service.update_page(page_id, {"status": "pending"})
        return success_response(data=result, message="Page queued for retry")
    except Exception as e:
        return error_response(code=1001, message=str(e))


@upload_router.post("/chapters/{chapter_id}/pages/upload-archive")
async def upload_archive(
    chapter_id: str,
    file: UploadFile = File(..., description="Archive file to upload (ZIP/CBZ/RAR/7Z/PDF)"),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    上传压缩包/PDF 并自动拆分为独立页面。
    支持格式: ZIP, CBZ, RAR, CBR, 7Z, CB7, PDF
    PDF 将使用 PyMuPDF 逐页渲染为图片。
    RAR/7Z 将解压并提取其中的图片文件。
    所有图片按文件名自然排序生成页面。
    """
    MAX_ARCHIVE_SIZE = 500 * 1024 * 1024  # 500MB
    ALLOWED_ARCHIVE_EXT = {".zip", ".cbz", ".rar", ".cbr", ".7z", ".cb7", ".pdf"}

    if not file or not file.filename:
        return error_response(code=4001, message="No file provided")

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_ARCHIVE_EXT:
        return error_response(
            code=4003,
            message=f"Unsupported archive format: {ext}. Supported: {', '.join(ALLOWED_ARCHIVE_EXT)}",
            status_code=415,
        )

    # Read file content
    content = await file.read()
    file_size = len(content)

    if file_size > MAX_ARCHIVE_SIZE:
        return error_response(
            code=4001,
            message=f"Archive too large: {file_size / (1024*1024):.1f}MB > 500MB",
            status_code=413,
        )

    if file_size == 0:
        return error_response(code=4001, message="File is empty")

    service = PageService(db)
    try:
        result = await service.upload_archive(
            chapter_id=chapter_id,
            user_id=current_user["sub"],
            file_content=content,
            file_name=file.filename,
            file_size=file_size,
        )
        return created_response(
            data=result,
            message=f"Archive parsed: {result['total_uploaded']} page(s) created"
        )
    except ValueError as e:
        return error_response(code=4001, message=str(e), status_code=404)
    except Exception as e:
        return error_response(code=5000, message=f"Archive upload failed: {str(e)}")


@router.get("/{page_id}/image")
async def get_page_image(
    page_id: str,
    zoom: float = Query(1.0, ge=0.1, le=3.0, description="Render zoom level (1.0=reasonable size, 2.0=full HD quality)"),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_optional_user),
):
    """
    获取页面图片（支持本地磁盘 / MinIO / PDF 按需渲染）。
    
    此端点无需认证，因为浏览器 <img> 标签不发送 Authorization header。
    对于普通图片页面，从存储直接返回；
    对于 PDF 页面，按需渲染指定页为 PNG 并返回；
    对于 MinIO 存储的图片，通过 HTTP 代理流式返回。
    
    Query params:
        zoom: 缩放倍率 (默认 1.0，范围 0.1-3.0)
              1.0 = 适合浏览器编辑的合理尺寸 (~1200px宽)
              2.0 = 高清原图级别 (~2400px宽)
              0.3 = 缩略图级别
    """
    from fastapi.responses import Response, StreamingResponse
    from ..service.file_service import FileService
    import httpx

    service = PageService(db)
    try:
        page_detail = await service.get_page_detail(page_id)
        if not page_detail:
            return error_response(code=1002, message="Page not found", status_code=404)

        original_url = page_detail.get("original_url", "")

        # Case 1: Local storage path (/storage/...) — 包含已渲染的 PDF 页面
        if original_url.startswith("/storage/"):
            from common.core.config import settings
            storage_base = getattr(settings, "UPLOAD_DIR", "/mnt/c/Users/WanFi/Desktop/大三实训/demo_04/data/uploads")
            file_path = os.path.join(storage_base, "uploads", original_url.replace("/storage/", "", 1).lstrip("/"))
            if os.path.isfile(file_path):
                with open(file_path, "rb") as f:
                    return Response(content=f.read(), media_type="image/png")

        # Case 2: PDF 按需渲染（original_url 不可用时的降级）
        pp_result = page_detail.get("preprocessing_result")
        if pp_result and pp_result.get("source_pdf"):
            pdf_path = pp_result["source_pdf"]
            pdf_page_index = pp_result["pdf_page_index"]

            if os.path.isfile(pdf_path):
                user_identifier = current_user["sub"] if current_user else "anonymous"
                file_service = FileService()
                png_bytes, width, height = file_service.render_single_pdf_page(
                    pdf_path, pdf_page_index, user_identifier, zoom=zoom
                )
                return Response(content=png_bytes, media_type="image/png",
                              headers={"X-Page-Width": str(width), "X-Page-Height": str(height),
                                       "Cache-Control": "public, max-age=300"})

        # Case 3: Local file was expected but missing
        if original_url.startswith("/storage/"):
            return error_response(code=5000, message="Image file not found on disk", status_code=404)

        # Case 3.5: /uploads/ path (image service rendered files)
        if original_url.startswith("/uploads/"):
            upload_base = os.getenv("UPLOAD_DIR", "/mnt/c/Users/WanFi/Desktop/大三实训/demo_04/data/uploads")
            file_path = os.path.join(upload_base, original_url.lstrip("/"))
            if os.path.isfile(file_path):
                with open(file_path, "rb") as f:
                    return Response(content=f.read(), media_type="image/png")

        # Case 4: MinIO / remote URL (http:// or https://)
        if original_url.startswith("http://") or original_url.startswith("https://"):
            try:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    resp = await client.get(original_url)
                    resp.raise_for_status()
                    content_type = resp.headers.get("content-type", "image/png")
                    return Response(
                        content=resp.content,
                        media_type=content_type,
                        headers={"Cache-Control": "public, max-age=3600"},
                    )
            except Exception as e:
                logger = logging.getLogger(__name__)
                logger.warning(f"Failed to proxy MinIO image {original_url}: {e}")
                return error_response(code=5000, message="Remote image not accessible", status_code=404)

        # Case 5: Self-referencing /api/v1/pages/{id}/image (legacy PDF pages)
        if original_url.startswith("/api/v1/pages/"):
            return error_response(code=5000, message="Recursive image reference", status_code=500)

        # Case 6: Unknown URL format
        return error_response(code=5000, message=f"Cannot serve image: unsupported URL format", status_code=500)

    except Exception as e:
        logger = logging.getLogger(__name__)
        logger.error(f"get_page_image failed for {page_id}: {e}", exc_info=True)
        return error_response(code=5000, message=f"Failed to retrieve page image: {str(e)}")

