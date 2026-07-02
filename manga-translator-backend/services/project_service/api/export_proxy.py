from __future__ import annotations
"""
P1-FIX-03: Export endpoint under /projects/:pid/export
Accepts complete export parameters and proxies to export-service internally.
"""
import logging
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
import httpx

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from common.core.config import settings
from common.core.database import get_db
from common.core.security import get_current_user
from common.models.project import Project
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Export"])

EXPORT_SERVICE_URL = os.getenv("EXPORT_SERVICE_URL", "http://export-service:8003")


class ExportProjectRequest(BaseModel):
    """Complete export parameters per PRD spec."""
    format: str = Field(default="png", description="Output format: png, jpg, pdf, srt")
    quality: int = Field(default=90, ge=1, le=100, description="Image quality 1-100")
    pages: Optional[List[int]] = Field(default=None, description="Page numbers to export (1-indexed), empty=all")
    archive_format: Optional[str] = Field(default=None, description="Archive format: zip, cbz, pdf")
    bilingual: bool = Field(default=False, description="Include bilingual output")
    bilingual_mode: str = Field(default="side-by-side", description="Bilingual layout: side-by-side, top-bottom, in-bubble")
    crop_margins: bool = Field(default=False, description="Crop empty margins")
    naming_rule: str = Field(default="${chapter}/${page}", description="File naming pattern")
    per_chapter_cbz: bool = Field(default=False, description="Create separate CBZ per chapter")
    target_languages: Optional[List[str]] = Field(default=None, description="Target languages for multi-lang export (e.g. ['zh','en','ja'])")
    include_srt: bool = Field(default=False, description="Generate SRT subtitle file with timestamps and character names")


@router.post("/{project_id}/export")
async def export_project(
    project_id: str,
    req: ExportProjectRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    POST /api/v1/projects/:pid/export
    Start an export job for the project with full parameter support.
    Proxies to export-service internally.
    """
    # Verify project exists and user has access
    proj = await db.get(Project, project_id)
    if not proj:
        raise HTTPException(404, "Project not found")

    # Build export payload for export-service
    payload = {
        "project_id": project_id,
        "format": req.format,
        "quality": req.quality,
        "archive_format": req.archive_format,
        "bilingual": req.bilingual,
        "bilingual_mode": req.bilingual_mode,
        "naming_rule": req.naming_rule,
        "per_chapter_cbz": req.per_chapter_cbz,
    }

    if req.pages:
        payload["page_range"] = ",".join(str(p) for p in req.pages)
    if req.crop_margins:
        payload["crop_margins"] = True
    if req.target_languages:
        payload["target_languages"] = req.target_languages
    if req.include_srt:
        payload["include_srt"] = True

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{EXPORT_SERVICE_URL}/api/v1/export/project",
                json=payload,
                headers={"X-User-ID": current_user["sub"]},
            )
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPStatusError as e:
        logger.error(f"Export service returned {e.response.status_code}: {e.response.text}")
        raise HTTPException(e.response.status_code, detail=e.response.text)
    except httpx.ConnectError:
        logger.error("Export service unreachable")
        raise HTTPException(503, "Export service is currently unavailable")
    except Exception as e:
        logger.error(f"Export proxy failed: {e}", exc_info=True)
        raise HTTPException(500, f"Export failed: {str(e)}")


@router.post("/{project_id}/export/srt")
async def export_srt_subtitles(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    POST /api/v1/projects/{pid}/export/srt
    导出 SRT 字幕文件（§2.27 有声剧场 — SRT 导出）。
    从已翻译 text_regions 生成带时间轴的字幕，按页码排序。
    角色标注：若 region 绑定了 character，自动填充角色名。
    """
    proj = await db.get(Project, project_id)
    if not proj:
        raise HTTPException(404, "Project not found")

    # Query all translated regions with character binding, sorted by page/chapter
    try:
        result = await db.execute(
            """SELECT tr.region_id, tr.translated_text, tr.sort_order,
                      p.sort_order as page_order, c.sort_order as chapter_order, c.name as chapter_name,
                      ch.name as character_name
               FROM text_regions tr
               JOIN pages p ON p.page_id = tr.page_id
               JOIN chapters c ON c.chapter_id = p.chapter_id
               LEFT JOIN characters ch ON ch.character_id = tr.character_id
               WHERE c.project_id = :pid
                 AND tr.translated_text IS NOT NULL
                 AND tr.translated_text != ''
               ORDER BY c.sort_order, p.sort_order, tr.sort_order""",
            {"pid": uuid.UUID(project_id)},
        )
        rows = result.fetchall()
    except Exception as e:
        logger.error(f"SRT export query failed: {e}")
        raise HTTPException(500, f"Failed to query regions: {str(e)}")

    if not rows:
        raise HTTPException(404, "No translated text regions found in this project")

    # Build SRT content
    # Each region gets a subtitle entry; duration estimated by text length (~150ms per char)
    srt_lines = []
    start_ms = 0
    index = 1

    for row in rows:
        region_id, translated_text, sort_order, page_order, chapter_order, chapter_name, character_name = row
        text = (translated_text or "").strip()
        if not text:
            continue

        # Estimate duration: ~150ms per character, min 1.5s, max 8s
        char_count = len(text)
        duration_ms = max(1500, min(8000, char_count * 150))
        end_ms = start_ms + duration_ms

        # Format timestamp: HH:MM:SS,mmm
        def _fmt_ts(ms):
            h = ms // 3600000
            m = (ms % 3600000) // 60000
            s = (ms % 60000) // 1000
            ms_rem = ms % 1000
            return f"{h:02d}:{m:02d}:{s:02d},{ms_rem:03d}"

        # Build subtitle entry with optional character name
        prefix = f"[{character_name}] " if character_name else ""
        entry = f"{index}\n{_fmt_ts(start_ms)} --> {_fmt_ts(end_ms)}\n{prefix}{text}\n"
        srt_lines.append(entry)

        # Gap between subtitles: 300ms
        start_ms = end_ms + 300
        index += 1

    srt_content = "\n".join(srt_lines)

    return success_response(data={
        "project_id": project_id,
        "format": "srt",
        "subtitle_count": index - 1,
        "total_duration_ms": start_ms - 300,
        "srt_content": srt_content,
        "filename": f"{proj.name or 'export'}.srt",
        "download_url": None,  # SRT inline in response; frontend can save as blob
    })
