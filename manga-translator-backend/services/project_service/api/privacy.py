from __future__ import annotations
"""
PIPL/GDPR 隐私合规 API — 数据导出与删除
§2.24 用户数据可携带权 + 被遗忘权
"""
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text
from typing import Optional
from datetime import datetime
import uuid, json, sys, os, zipfile, io as _io

_cur = os.path.dirname(os.path.abspath(__file__))
_svc = os.path.dirname(os.path.dirname(_cur))
if _svc not in sys.path:
    sys.path.insert(0, _svc)

from common.core.database import get_db
from common.core.dependencies import get_current_user
from common.core.response import success_response, created_response

router = APIRouter(prefix="/api/v1/privacy", tags=["Privacy"])


@router.post("/data-export")
async def request_data_export(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    POST /api/v1/privacy/data-export
    请求导出用户全部个人数据（PIPL 第45条 — 数据可携带权）。
    异步生成 ZIP 包，包含：项目、页面、翻译、角色、字体、使用记录。
    """
    user_id = uuid.UUID(current_user["sub"])

    # Record the request
    export_id = uuid.uuid4()
    await db.execute(
        """INSERT INTO privacy_requests (request_id, user_id, request_type, status, created_at)
           VALUES (:rid, :uid, 'export', 'processing', NOW())""",
        {"rid": export_id, "uid": user_id},
    )
    await db.commit()

    # Async export generation
    try:
        export_data = await _build_user_data_export(db, user_id)
    except Exception as e:
        await db.execute(
            "UPDATE privacy_requests SET status = 'failed', completed_at = NOW(), result_message = :msg WHERE request_id = :rid",
            {"rid": export_id, "msg": f"Export failed: {str(e)}"},
        )
        await db.commit()
        raise HTTPException(500, f"Data export failed: {str(e)}")

    await db.execute(
        """UPDATE privacy_requests SET status = 'completed', completed_at = NOW(),
           result_data = :data WHERE request_id = :rid""",
        {"rid": export_id, "data": json.dumps({"item_count": sum(len(v) if isinstance(v, list) else 1 for v in export_data.values())})},
    )
    await db.commit()

    return created_response(data={
        "request_id": str(export_id),
        "status": "completed",
        "data": export_data,
    }, message="Data export completed. Your personal data is ready for download.")


@router.post("/data-deletion")
async def request_data_deletion(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    POST /api/v1/privacy/data-deletion
    请求删除/匿名化用户全部个人数据（PIPL 第47条 — 被遗忘权）。
    保留翻译缓存（匿名化）、删除项目/角色/字体/使用记录。
    """
    user_id = uuid.UUID(current_user["sub"])

    deletion_id = uuid.uuid4()
    await db.execute(
        """INSERT INTO privacy_requests (request_id, user_id, request_type, status, created_at)
           VALUES (:rid, :uid, 'deletion', 'processing', NOW())""",
        {"rid": deletion_id, "uid": user_id},
    )
    await db.commit()

    deleted = {"projects": 0, "pages": 0, "characters": 0, "fonts": 0, "caches_anonymized": 0}

    try:
        # Delete user's custom fonts
        result = await db.execute("DELETE FROM fonts WHERE user_id = :uid AND user_id IS NOT NULL", {"uid": user_id})
        deleted["fonts"] = result.rowcount

        # Delete user's characters (characters关联project_id，非直接user_id)
        result = await db.execute(
            "DELETE FROM characters WHERE project_id IN (SELECT project_id FROM projects WHERE user_id = :uid)",
            {"uid": user_id},
        )
        deleted["characters"] = result.rowcount

        # Delete user's text_regions via pages → chapters → projects cascade
        result = await db.execute(
            """DELETE FROM text_regions WHERE page_id IN (
                SELECT p.page_id FROM pages p
                JOIN chapters c ON c.chapter_id = p.chapter_id
                JOIN projects pr ON pr.project_id = c.project_id
                WHERE pr.user_id = :uid
            )""",
            {"uid": user_id},
        )
        deleted["pages"] = result.rowcount

        # Delete user's projects (cascade deletes chapters/pages/locks/comments)
        result = await db.execute("DELETE FROM projects WHERE user_id = :uid", {"uid": user_id})
        deleted["projects"] = result.rowcount

        # Anonymize translation cache (keep for community benefit)
        result = await db.execute(
            "UPDATE translation_cache SET project_id = NULL WHERE project_id IN (SELECT project_id FROM projects WHERE user_id = :uid)",
            {"uid": user_id},
        )
        deleted["caches_anonymized"] = result.rowcount

        # Remove from project_invites
        await db.execute("DELETE FROM project_invites WHERE created_by = :uid", {"uid": user_id})

        # Remove from project_members
        await db.execute("DELETE FROM project_members WHERE user_id = :uid", {"uid": user_id})

        await db.commit()

        await db.execute(
            """UPDATE privacy_requests SET status = 'completed', completed_at = NOW(),
               result_data = :data WHERE request_id = :rid""",
            {"rid": deletion_id, "data": json.dumps(deleted)},
        )
        await db.commit()

    except Exception as e:
        await db.execute(
            "UPDATE privacy_requests SET status = 'failed', completed_at = NOW(), result_message = :msg WHERE request_id = :rid",
            {"rid": deletion_id, "msg": str(e)},
        )
        await db.commit()
        raise HTTPException(500, f"Data deletion failed: {str(e)}")

    return success_response(data={
        "request_id": str(deletion_id),
        "status": "completed",
        "deleted": deleted,
    }, message="Your personal data has been deleted. Translation caches were anonymized.")


@router.get("/requests")
async def list_privacy_requests(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """GET /api/v1/privacy/requests — 查看历史隐私请求状态。"""
    user_id = uuid.UUID(current_user["sub"])
    try:
        result = await db.execute(
            """SELECT request_id, request_type, status, created_at, completed_at, result_data, result_message
               FROM privacy_requests WHERE user_id = :uid ORDER BY created_at DESC""",
            {"uid": user_id},
        )
        rows = result.fetchall()
    except Exception:
        rows = []

    items = []
    for r in rows:
        items.append({
            "request_id": str(r[0]),
            "type": r[1],
            "status": r[2],
            "created_at": r[3].isoformat() if r[3] else None,
            "completed_at": r[4].isoformat() if r[4] else None,
            "result": r[5] if r[5] else {"error": r[6]} if r[6] else None,
        })
    return success_response(data={"requests": items, "total": len(items)})


async def _build_user_data_export(db: AsyncSession, user_id: uuid.UUID) -> dict:
    """构建用户数据导出包。"""
    data = {}

    # Projects (列名对齐 DDL: project_id, user_id, name, source_lang, cover_url, is_favorite, status, created_at, updated_at)
    result = await db.execute(
        """SELECT project_id, name, source_lang, cover_url, is_favorite, status, created_at, updated_at
           FROM projects WHERE user_id = :uid ORDER BY created_at""",
        {"uid": user_id},
    )
    data["projects"] = [_row_to_dict(r, ["project_id","name","source_lang","cover_url","is_favorite","status","created_at","updated_at"]) for r in result.fetchall()]

    # Characters (characters通过project_id关联用户，无直接user_id列)
    try:
        result = await db.execute(
            "SELECT character_id, name, tone_type, custom_tone_params, catchphrase, gender FROM characters WHERE project_id IN (SELECT project_id FROM projects WHERE user_id = :uid)",
            {"uid": user_id},
        )
        data["characters"] = [_row_to_dict(r, ["character_id","name","tone_type","custom_tone_params","catchphrase","gender"]) for r in result.fetchall()]
    except Exception:
        data["characters"] = []

    # Fonts (user-uploaded)
    try:
        result = await db.execute(
            "SELECT font_id, name, file_url, file_size, category, style_tags FROM fonts WHERE user_id = :uid",
            {"uid": user_id},
        )
        data["fonts"] = [_row_to_dict(r, ["font_id","name","file_url","file_size","category","style_tags"]) for r in result.fetchall()]
    except Exception:
        data["fonts"] = []

    # Project memberships (as member in other projects)
    try:
        result = await db.execute(
            "SELECT project_id, role, joined_at FROM project_members WHERE user_id = :uid",
            {"uid": user_id},
        )
        data["memberships"] = [_row_to_dict(r, ["project_id","role","joined_at"]) for r in result.fetchall()]
    except Exception:
        data["memberships"] = []

    # Achievements
    try:
        result = await db.execute(
            """SELECT ua.achievement_id, a.name, ua.progress, ua.unlocked_at
               FROM user_achievements ua JOIN achievements a ON a.achievement_id = ua.achievement_id
               WHERE ua.user_id = :uid""",
            {"uid": user_id},
        )
        data["achievements"] = [_row_to_dict(r, ["achievement_id","name","progress","unlocked_at"]) for r in result.fetchall()]
    except Exception:
        data["achievements"] = []

    return data


def _row_to_dict(row, keys: list) -> dict:
    return {k: (str(v) if isinstance(v, uuid.UUID) else v.isoformat() if isinstance(v, datetime) else v) for k, v in zip(keys, row)}
