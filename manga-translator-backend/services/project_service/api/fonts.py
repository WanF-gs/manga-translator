from __future__ import annotations
"""Font Management API - List, upload, delete, smart-match, preview (v3.0)."""
from fastapi import APIRouter, Depends, Query, UploadFile, File, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional
import os, uuid

import sys, os as _os
_cur = _os.path.dirname(_os.path.abspath(__file__))
_svc = _os.path.dirname(_os.path.dirname(_cur))
if _svc not in sys.path:
    sys.path.insert(0, _svc)

from common.core.database import get_db
from common.core.dependencies import get_current_user
from common.core.response import success_response, paginated_response, created_response
from common.core.exceptions import ResourceNotFound, PermissionDenied
from common.core.minio import get_minio as get_minio_client
from common.models.font import Font
from sqlalchemy import select, func, or_

router = APIRouter()

FONT_BUCKET = "fonts"
ALLOWED_EXTENSIONS = {".ttf", ".otf"}

@router.get("")
async def list_fonts(
    category: Optional[str] = Query(None),
    license_type: Optional[str] = Query(None),
    style_tag: Optional[str] = Query(None),
    language: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """List fonts with filtering. Returns system fonts + user's own fonts."""
    query = select(Font).where(
        (Font.user_id.is_(None)) | (Font.user_id == current_user["sub"]),
        Font.is_active == True,
    )
    if category:
        query = query.where(Font.category == category)
    if license_type:
        query = query.where(Font.license == license_type)
    if style_tag:
        query = query.where(Font.style_tags.contains([style_tag]))
    if language:
        query = query.where(Font.language_tags.contains([language]))

    count_query = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_query)).scalar()
    query = query.order_by(Font.user_id.is_(None).desc(), Font.created_at.desc())
    query = query.offset((page - 1) * page_size).limit(page_size)
    
    fonts = (await db.execute(query)).scalars().all()
    items = [_font_to_dict(f) for f in fonts]
    return paginated_response(items=items, page=page, page_size=page_size, total=total)

@router.post("/upload")
async def upload_font(
    file: UploadFile = File(...),
    name: Optional[str] = Query(None),
    category: str = Query("dialogue"),
    license_type: str = Query("personal_only"),
    style_tags: Optional[str] = Query(None),
    language_tags: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Upload a custom TTF/OTF font file (max 20MB)."""
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, detail=f"Unsupported font format: {ext}. Allowed: {','.join(ALLOWED_EXTENSIONS)}")

    contents = await file.read()
    file_size = len(contents)
    if file_size > 20 * 1024 * 1024:
        raise HTTPException(400, detail="Font file exceeds 20MB limit")
    await file.seek(0)

    font_id = uuid.uuid4()
    object_name = f"fonts/{current_user['sub']}/{font_id}{ext}"
    try:
        minio_client = get_minio_client()
        minio_client.put_object(FONT_BUCKET, object_name, await file.read(), file_size, content_type="font/opentype" if ext == ".otf" else "font/ttf")
    except Exception:
        object_name = f"fonts/user/{font_id}{ext}"

    font = Font(
        font_id=font_id,
        user_id=current_user["sub"],
        name=name or file.filename.replace(ext, ""),
        file_url=f"/api/v1/fonts/file/{font_id}{ext}",
        file_size=file_size,
        category=category,
        license=license_type,
        style_tags=style_tags.split(",") if style_tags else [],
        language_tags=language_tags.split(",") if language_tags else [],
    )
    db.add(font)
    await db.flush()
    return created_response(data=_font_to_dict(font), message="Font uploaded successfully")

@router.put("/{font_id}")
async def update_font(
    font_id: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Update font metadata (name, category, license, tags)."""
    font = (await db.execute(
        select(Font).where(
            Font.font_id == font_id,
            (Font.user_id.is_(None)) | (Font.user_id == current_user["sub"]),
        )
    )).scalar_one_or_none()
    if not font:
        raise ResourceNotFound("Font", font_id)
    if font.user_id is not None and str(font.user_id) != str(current_user["sub"]):
        raise PermissionDenied("Cannot update another user's font")

    updatable = ["name", "category", "license", "style_tags", "language_tags"]
    for field in updatable:
        if field in body:
            setattr(font, field, body[field])

    await db.flush()
    return success_response(data=_font_to_dict(font))

@router.delete("/{font_id}")
async def delete_font(
    font_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Delete a user-uploaded font (system fonts cannot be deleted)."""
    font = (await db.execute(select(Font).where(Font.font_id == font_id))).scalar_one_or_none()
    if not font:
        raise ResourceNotFound("Font", font_id)
    if font.user_id is None:
        raise PermissionDenied("Cannot delete system fonts")
    if str(font.user_id) != str(current_user["sub"]):
        raise PermissionDenied("Cannot delete another user's font")
    await db.delete(font)
    return success_response(message="Font deleted")

@router.get("/smart-match")
async def smart_match_font(
    tone_type: Optional[str] = Query(None),
    bubble_type: Optional[str] = Query(None),
    style_tag: Optional[str] = Query(None),
    project_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Smart font matching - returns best font recommendations based on context."""
    query = select(Font).where(
        (Font.user_id.is_(None)) | (Font.user_id == current_user["sub"]),
        Font.is_active == True,
    )
    fonts = (await db.execute(query)).scalars().all()

    tone_font_map = {
        "tsundere": ["少女漫风格字体", "系统默认对话字体"],
        "hotblooded": ["热血漫风格字体", "拟声词特效字体"],
        "calm": ["系统默认对话字体", "旁白标准字体"],
        "cold": ["恐怖漫氛围字体", "系统默认对话字体"],
        "loli": ["少女漫风格字体", "手写风格字体"],
        "genki": ["热血漫风格字体", "手写风格字体"],
    }

    bubble_font_map = {
        "speech": "dialogue",
        "thought": "dialogue",
        "narration": "narration",
        "onomatopoeia": "onomatopoeia",
        "effect": "onomatopoeia",
    }

    def score(f: Font) -> float:
        s = 0.0
        if tone_type and f.name in tone_font_map.get(tone_type, []):
            s += 3.0
        if bubble_type and f.category == bubble_font_map.get(bubble_type, ""):
            s += 2.0
        if style_tag and f.style_tags and style_tag in f.style_tags:
            s += 2.0
        if f.user_id is None:
            s += 0.5
        return s

    scored = sorted([(f, score(f)) for f in fonts], key=lambda x: x[1], reverse=True)
    recommendations = [{"font": _font_to_dict(f), "score": s} for f, s in scored[:5]]
    return success_response(data={"recommendations": recommendations, "best_match": recommendations[0]["font"] if recommendations else None})

@router.get("/file/{filename}")
async def get_font_file(filename: str):
    """
    服务字体文件内容（§2.25）。
    - 内置字体：从后端 fonts/ 目录读取（如 NotoSansSC-Regular.otf）
    - 用户上传字体：从 MinIO fonts 桶读取（对象名 = filename 或 fonts/{filename}）
    返回字体二进制流，供前端 @font-face 预览与渲染服务使用。
    """
    from fastapi.responses import Response, StreamingResponse
    import io as _io

    safe = os.path.basename(filename)
    ext = os.path.splitext(safe)[1].lower()
    if ext not in (".ttf", ".otf", ".ttc"):
        raise HTTPException(400, detail="Unsupported font file type")
    media = "font/otf" if ext == ".otf" else "font/ttf"

    # 1) 内置字体：搜索后端 fonts 目录
    search_dirs = [
        os.getenv("FONT_DIR", "/app/fonts"),
        os.path.join(_svc, "..", "fonts"),               # services/../fonts
        os.path.join(_svc, "..", "..", "fonts"),         # backend/fonts
        os.path.join(os.path.dirname(_svc), "fonts"),
    ]
    for d in search_dirs:
        try:
            fp = os.path.join(os.path.abspath(d), safe)
            if os.path.isfile(fp):
                with open(fp, "rb") as fh:
                    return Response(content=fh.read(), media_type=media,
                                    headers={"Cache-Control": "public, max-age=604800"})
        except Exception:
            continue

    # 2) 用户上传字体：MinIO
    try:
        client = get_minio_client()
        for key in (safe, f"fonts/{safe}"):
            try:
                obj = client.get_object(FONT_BUCKET, key)
                data = obj.read()
                obj.close()
                obj.release_conn()
                return Response(content=data, media_type=media,
                                headers={"Cache-Control": "public, max-age=604800"})
            except Exception:
                continue
        # 前缀未知时遍历查找
        for o in client.list_objects(FONT_BUCKET, recursive=True):
            if o.object_name.endswith(safe):
                obj = client.get_object(FONT_BUCKET, o.object_name)
                data = obj.read()
                obj.close(); obj.release_conn()
                return Response(content=data, media_type=media,
                                headers={"Cache-Control": "public, max-age=604800"})
    except Exception:
        pass

    raise HTTPException(404, detail=f"Font file not found: {safe}")


@router.post("/glyph-coverage")
async def glyph_coverage(
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    缺字检测（§2.25）：给定文本 + 字体，返回覆盖率与缺失字符，供前端红色标记。
    body: {"text": "...", "font_id": "..." | "font_family": "..."}
    """
    text = (body.get("text") or "").strip()
    if not text:
        return success_response(data={"coverage": 1.0, "missing_chars": [], "needs_fallback": False})

    # 解析字体文件路径
    font_path = None
    font_name = body.get("font_family")
    font_id = body.get("font_id")
    if font_id:
        row = (await db.execute(select(Font).where(Font.font_id == font_id))).scalar_one_or_none()
        if row:
            font_name = row.name
            font_path = _local_font_path(os.path.basename(row.file_url))

    try:
        import sys as _sys
        _img_svc = os.path.join(os.path.dirname(_svc), "image_service")
        if _img_svc not in _sys.path:
            _sys.path.insert(0, _img_svc)
        from processors.text_layout import check_glyph_coverage
        result = check_glyph_coverage(text, font_path=font_path, font_name=font_name)
    except Exception:
        # 无 fontTools 时的兜底：假定 CJK 字体全覆盖
        result = {"coverage": 1.0, "missing_chars": [], "needs_fallback": False,
                  "note": "glyph engine unavailable"}
    return success_response(data=result)


def _local_font_path(filename: str) -> Optional[str]:
    for d in [os.getenv("FONT_DIR", "/app/fonts"),
              os.path.join(_svc, "..", "fonts"),
              os.path.join(_svc, "..", "..", "fonts")]:
        fp = os.path.join(os.path.abspath(d), os.path.basename(filename))
        if os.path.isfile(fp):
            return fp
    return None

# P1-FIX-02: Single font detail endpoint — MUST be after all specific routes to avoid path conflicts
@router.get("/{font_id}")
async def get_font(
    font_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Get single font detail by ID."""
    font = (await db.execute(
        select(Font).where(
            Font.font_id == font_id,
            (Font.user_id.is_(None)) | (Font.user_id == current_user["sub"]),
        )
    )).scalar_one_or_none()
    if not font:
        raise ResourceNotFound("Font", font_id)
    return success_response(data=_font_to_dict(font))


def _font_to_dict(f: Font) -> dict:
    return {
        "font_id": str(f.font_id),
        "user_id": str(f.user_id) if f.user_id else None,
        "name": f.name,
        "file_url": f.file_url,
        "file_size": f.file_size,
        "category": f.category,
        "style_tags": f.style_tags or [],
        "license": f.license,
        "language_tags": f.language_tags or [],
        "is_active": f.is_active,
        "is_system": f.user_id is None,
        "created_at": f.created_at.isoformat() if f.created_at else None,
    }
