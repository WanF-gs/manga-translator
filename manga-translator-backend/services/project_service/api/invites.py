from __future__ import annotations
"""
项目邀请链接 API — PRD §2.23 协作邀请
支持生成一次性/多次使用邀请链接，含过期时间和角色预设。
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func
from typing import Optional
from datetime import datetime, timedelta
import uuid, secrets, sys, os

_cur = os.path.dirname(os.path.abspath(__file__))
_svc = os.path.dirname(os.path.dirname(_cur))
if _svc not in sys.path:
    sys.path.insert(0, _svc)

from common.core.database import get_db
from common.core.dependencies import get_current_user
from common.core.response import success_response, created_response
from common.core.exceptions import ResourceNotFound, PermissionDenied

router = APIRouter()

# ============================================================
# Invite Model (in-memory for now; DDL migration available in 08_project_invites.sql)
# ============================================================

INVITE_ROLES = ["editor", "translator", "reviewer", "viewer"]


def _invite_code() -> str:
    return secrets.token_urlsafe(12)  # ~16 chars


@router.post("/projects/{project_id}/invites")
async def create_invite(
    project_id: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    POST /api/v1/projects/{pid}/invites
    生成项目邀请链接。
    body: { role?, max_uses?, expires_in_hours?, is_permanent? }
    """
    from common.models.project import Project

    proj = (await db.execute(
        select(Project).where(Project.project_id == uuid.UUID(project_id))
    )).scalar_one_or_none()
    if not proj:
        raise ResourceNotFound("Project", project_id)

    role = body.get("role", "viewer")
    if role not in INVITE_ROLES:
        raise HTTPException(400, f"Invalid role: {role}. Must be one of: {', '.join(INVITE_ROLES)}")

    max_uses = body.get("max_uses", 0)  # 0 = unlimited
    expires_hours = body.get("expires_in_hours", 72)
    is_permanent = body.get("is_permanent", False)
    expires_at = None if is_permanent else datetime.utcnow() + timedelta(hours=expires_hours)

    code = _invite_code()
    invite_id = uuid.uuid4()

    # Upsert via raw SQL (PostgreSQL JSONB column for flexibility)
    row = {
        "invite_id": invite_id,
        "project_id": uuid.UUID(project_id),
        "created_by": uuid.UUID(current_user["sub"]),
        "code": code,
        "role": role,
        "max_uses": max_uses,
        "use_count": 0,
        "is_active": True,
        "expires_at": expires_at,
        "created_at": datetime.utcnow(),
    }
    await db.execute(
        """INSERT INTO project_invites (invite_id, project_id, created_by, code, role, max_uses, use_count, is_active, expires_at, created_at)
           VALUES (:invite_id, :project_id, :created_by, :code, :role, :max_uses, :use_count, :is_active, :expires_at, :created_at)
           ON CONFLICT (invite_id) DO NOTHING""",
        row,
    )
    await db.commit()

    return created_response(data={
        "invite_id": str(invite_id),
        "project_id": project_id,
        "code": code,
        "role": role,
        "max_uses": max_uses,
        "expires_at": expires_at.isoformat() if expires_at else None,
        "invite_url": f"/api/v1/invites/{code}",
        "full_url": f"/invite/{code}",
    }, message="Invite link created")


@router.get("/projects/{project_id}/invites")
async def list_invites(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """GET /api/v1/projects/{pid}/invites — 列出项目的所有邀请链接。"""
    from common.models.project import Project

    proj = (await db.execute(
        select(Project).where(Project.project_id == uuid.UUID(project_id))
    )).scalar_one_or_none()
    if not proj:
        raise ResourceNotFound("Project", project_id)

    try:
        result = await db.execute(
            """SELECT invite_id, code, role, max_uses, use_count, is_active, expires_at, created_at
               FROM project_invites
               WHERE project_id = :pid
               ORDER BY created_at DESC""",
            {"pid": uuid.UUID(project_id)},
        )
        rows = result.fetchall()
    except Exception:
        rows = []

    items = []
    for r in rows:
        items.append({
            "invite_id": str(r[0]),
            "code": r[1],
            "role": r[2],
            "max_uses": r[3],
            "use_count": r[4],
            "is_active": r[5],
            "expires_at": r[6].isoformat() if r[6] else None,
            "created_at": r[7].isoformat() if r[7] else None,
        })

    return success_response(data={"invites": items, "total": len(items)})


@router.delete("/projects/{project_id}/invites/{invite_id}")
async def revoke_invite(
    project_id: str,
    invite_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """DELETE /api/v1/projects/{pid}/invites/{iid} — 撤销邀请链接。"""
    await db.execute(
        """UPDATE project_invites SET is_active = FALSE
           WHERE invite_id = :iid AND project_id = :pid""",
        {"iid": uuid.UUID(invite_id), "pid": uuid.UUID(project_id)},
    )
    await db.commit()
    return success_response(message="Invite revoked")


# ============================================================
# Public invite acceptance (no auth required — redirects to login if needed)
# ============================================================

@router.get("/invites/{code}")
async def get_invite_info(
    code: str,
    db: AsyncSession = Depends(get_db),
):
    """GET /api/v1/invites/{code} — 查看邀请信息（无需登录）。"""
    try:
        result = await db.execute(
            """SELECT i.invite_id, i.project_id, i.role, i.max_uses, i.use_count,
                      i.is_active, i.expires_at, p.name as project_name
               FROM project_invites i
               JOIN projects p ON p.project_id = i.project_id
               WHERE i.code = :code""",
            {"code": code},
        )
        row = result.fetchone()
    except Exception:
        row = None

    if not row:
        raise HTTPException(404, "Invite not found or expired")

    invite_id, project_id, role, max_uses, use_count, is_active, expires_at, project_name = row

    if not is_active:
        raise HTTPException(410, "This invite has been revoked")
    if expires_at and datetime.utcnow() > expires_at:
        raise HTTPException(410, "This invite has expired")
    if max_uses > 0 and use_count >= max_uses:
        raise HTTPException(410, "This invite has reached its usage limit")

    return success_response(data={
        "code": code,
        "project_id": str(project_id),
        "project_name": project_name,
        "role": role,
    })


@router.post("/invites/{code}/accept")
async def accept_invite(
    code: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    POST /api/v1/invites/{code}/accept — 接受邀请加入项目（需登录）。
    """
    try:
        result = await db.execute(
            """SELECT i.invite_id, i.project_id, i.role, i.max_uses, i.use_count,
                      i.is_active, i.expires_at, i.created_by
               FROM project_invites i
               WHERE i.code = :code""",
            {"code": code},
        )
        row = result.fetchone()
    except Exception:
        row = None

    if not row:
        raise HTTPException(404, "Invite not found")
    invite_id, project_id, role, max_uses, use_count, is_active, expires_at, created_by = row

    if not is_active:
        raise HTTPException(410, "This invite has been revoked")
    if expires_at and datetime.utcnow() > expires_at:
        raise HTTPException(410, "This invite has expired")
    if max_uses > 0 and use_count >= max_uses:
        raise HTTPException(410, "This invite has reached its usage limit")

    user_id = uuid.UUID(current_user["sub"])

    # Check if already a member
    from common.models.project import ProjectMember
    existing = (await db.execute(
        select(ProjectMember).where(and_(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == user_id,
        ))
    )).scalar_one_or_none()

    if existing:
        return success_response(data={
            "member_id": str(existing.member_id),
            "role": existing.role,
        }, message="You are already a member of this project")

    # Add as member
    member = ProjectMember(
        project_id=project_id,
        user_id=user_id,
        role=role,
        invited_by=str(created_by) if created_by else None,
    )
    db.add(member)

    # Increment use count
    await db.execute(
        "UPDATE project_invites SET use_count = use_count + 1 WHERE invite_id = :iid",
        {"iid": invite_id},
    )
    await db.flush()
    await db.commit()

    return created_response(data={
        "member_id": str(member.member_id),
        "project_id": str(project_id),
        "role": role,
    }, message=f"Successfully joined project as {role}")
