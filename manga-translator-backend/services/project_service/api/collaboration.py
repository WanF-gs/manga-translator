from __future__ import annotations
"""Team Collaboration API - Locks, Members, Comments, Snapshots (v3.0)."""
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, update, delete
from typing import Optional
from datetime import datetime, timedelta
import uuid, sys, os

_cur = os.path.dirname(os.path.abspath(__file__))
_svc = os.path.dirname(os.path.dirname(_cur))
if _svc not in sys.path:
    sys.path.insert(0, _svc)

from common.core.database import get_db
from common.core.dependencies import get_current_user
from common.core.response import success_response, paginated_response, created_response
from common.core.exceptions import ResourceNotFound, PermissionDenied
from common.models.v3_models import CollaborationLock, Comment, ChangeLog, Snapshot
from common.models.project import ProjectMember

router = APIRouter()

# ── API-12: Member management aliases under /collaboration/ prefix ──
# Frontend collaboration.ts calls /collaboration/projects/{id}/members/*
# Backend members.py has the canonical routes at /projects/{id}/members/*
# These aliases delegate to the same DB operations for path alignment.

ROLE_PERMISSIONS = {
    "owner": ["manage_members", "edit", "translate", "review", "delete", "export", "view"],
    "editor": ["edit", "translate", "review", "export", "view"],
    "translator": ["translate", "view"],
    "reviewer": ["review", "view"],
    "viewer": ["view"],
}


@router.get("/projects/{project_id}/members")
async def list_collab_members(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """List project members (collaboration alias)."""
    try:
        from common.models.project import ProjectMember as PM
        HAS_PM = True
    except ImportError:
        HAS_PM = False

    members = []
    if HAS_PM:
        result = await db.execute(
            select(PM).where(PM.project_id == uuid.UUID(project_id))
        )
        db_members = result.scalars().all()
        members = [
            {
                "member_id": str(m.member_id),
                "user_id": str(m.user_id),
                "role": m.role,
                "permissions": ROLE_PERMISSIONS.get(m.role, []),
                "joined_at": m.created_at.isoformat() if m.created_at else None,
            }
            for m in db_members
        ]
    else:
        members = [{
            "member_id": "owner",
            "user_id": str(current_user["sub"]),
            "role": "owner",
            "permissions": ROLE_PERMISSIONS["owner"],
            "joined_at": None,
        }]

    return success_response(data={
        "project_id": project_id,
        "members": members,
        "total": len(members),
    })


@router.post("/projects/{project_id}/members")
async def add_collab_member(
    project_id: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Add a member to a project (collaboration alias)."""
    user_id_to_add = uuid.UUID(body["user_id"])
    role = body.get("role", "viewer")

    try:
        from common.models.project import ProjectMember as PM
    except ImportError:
        raise HTTPException(status_code=501, detail="Project member model not available. Please run database migration first.")

    existing = (await db.execute(
        select(PM).where(
            PM.project_id == uuid.UUID(project_id),
            PM.user_id == user_id_to_add,
        )
    )).scalar_one_or_none()
    if existing:
        return success_response(data={
            "member_id": str(existing.member_id),
            "user_id": str(existing.user_id),
            "role": existing.role,
        }, message="Member already exists, returning existing record")

    member = PM(
        project_id=uuid.UUID(project_id),
        user_id=user_id_to_add,
        role=role,
    )
    db.add(member)
    await db.flush()
    return created_response(data={
        "member_id": str(member.member_id),
        "user_id": str(member.user_id),
        "role": member.role,
        "permissions": ROLE_PERMISSIONS.get(member.role, []),
    }, message=f"Member added with role: {role}")


@router.put("/projects/{project_id}/members/{user_id}")
async def update_collab_member_role(
    project_id: str,
    user_id: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Update a member's role (collaboration alias)."""
    role = body.get("role", "viewer")
    try:
        from common.models.project import ProjectMember as PM
    except ImportError:
        raise HTTPException(status_code=501, detail="Project member model not available.")

    member = (await db.execute(
        select(PM).where(
            PM.project_id == uuid.UUID(project_id),
            PM.user_id == uuid.UUID(user_id),
        )
    )).scalar_one_or_none()
    if not member:
        raise ResourceNotFound("Member", f"user {user_id} in project {project_id}")

    member.role = role
    await db.flush()
    return success_response(data={
        "member_id": str(member.member_id),
        "user_id": str(member.user_id),
        "role": member.role,
        "permissions": ROLE_PERMISSIONS.get(member.role, []),
    }, message=f"Role updated to: {role}")


@router.delete("/projects/{project_id}/members/{user_id}")
async def remove_collab_member(
    project_id: str,
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Remove a member from a project (collaboration alias)."""
    try:
        from common.models.project import ProjectMember as PM
    except ImportError:
        raise HTTPException(status_code=501, detail="Project member model not available.")

    member = (await db.execute(
        select(PM).where(
            PM.project_id == uuid.UUID(project_id),
            PM.user_id == uuid.UUID(user_id),
        )
    )).scalar_one_or_none()
    if not member:
        raise ResourceNotFound("Member", f"user {user_id} in project {project_id}")

    await db.delete(member)
    return success_response(message=f"Member {user_id} removed from project")

# ── B7 FIX: Root GET endpoint ──
@router.get("")
async def collaboration_root(
    current_user: dict = Depends(get_current_user),
):
    """GET /api/v1/collaboration — Team collaboration index."""
    return success_response(data={
        "service": "team-collaboration",
        "endpoints": [
            "POST /api/v1/collaboration/locks/{page_id}",
            "GET /api/v1/collaboration/members/{project_id}",
            "POST /api/v1/collaboration/comments",
            "GET /api/v1/collaboration/snapshots/{project_id}",
        ],
        "version": "3.0",
    })

# ── Lock Management ──
@router.post("/locks/{page_id}")
async def acquire_lock(
    page_id: str,
    lock_type: str = Query("edit"),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Acquire a page editing lock (30 min expiry)."""
    existing = (await db.execute(select(CollaborationLock).where(CollaborationLock.page_id == page_id))).scalar_one_or_none()
    if existing and existing.expires_at and existing.expires_at > datetime.utcnow():
        if str(existing.user_id) != str(current_user["sub"]):
            return success_response(data={"locked": True, "locked_by": str(existing.user_id), "expires_at": existing.expires_at.isoformat()}, message="Page is locked by another user")
    
    if existing:
        await db.delete(existing)
    lock = CollaborationLock(
        page_id=uuid.UUID(page_id),
        user_id=current_user["sub"],
        lock_type=lock_type,
        locked_at=datetime.utcnow(),
        expires_at=datetime.utcnow() + timedelta(minutes=30),
    )
    db.add(lock)
    await db.flush()
    return created_response(data={"locked": True, "lock_id": str(lock.lock_id), "expires_at": lock.expires_at.isoformat()}, message="Lock acquired")


# ── API-9: POST /locks/{page_id}/acquire (frontend alias) ──
@router.post("/locks/{page_id}/acquire")
async def acquire_lock_alias(
    page_id: str,
    lock_type: str = Query("edit"),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Alias for POST /locks/{page_id} — matches frontend collaboration.ts."""
    return await acquire_lock(page_id=page_id, lock_type=lock_type, db=db, current_user=current_user)


@router.delete("/locks/{page_id}")
async def release_lock(
    page_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Release a page lock."""
    existing = (await db.execute(select(CollaborationLock).where(CollaborationLock.page_id == page_id))).scalar_one_or_none()
    if not existing:
        return success_response(message="No lock exists")
    if str(existing.user_id) != str(current_user["sub"]):
        raise PermissionDenied("Cannot release another user's lock")
    await db.delete(existing)
    return success_response(message="Lock released")


# ── API-10: POST /locks/{page_id}/release (frontend alias) ──
@router.post("/locks/{page_id}/release")
async def release_lock_alias(
    page_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Alias for DELETE /locks/{page_id} — matches frontend collaboration.ts (POST release)."""
    return await release_lock(page_id=page_id, db=db, current_user=current_user)

@router.get("/locks/{page_id}")
async def check_lock(
    page_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Check page lock status."""
    existing = (await db.execute(select(CollaborationLock).where(CollaborationLock.page_id == page_id))).scalar_one_or_none()
    if existing and existing.expires_at and existing.expires_at > datetime.utcnow():
        return success_response(data={"locked": True, "locked_by": str(existing.user_id), "lock_type": existing.lock_type, "expires_at": existing.expires_at.isoformat()})
    return success_response(data={"locked": False})

# ── Comments ──
@router.get("/comments/{page_id}")
async def list_comments(
    page_id: str,
    status: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """List comments on a page."""
    query = select(Comment).where(Comment.page_id == page_id)
    if status:
        query = query.where(Comment.status == status)
    query = query.order_by(Comment.created_at.desc())
    comments = (await db.execute(query)).scalars().all()
    return success_response(data={"comments": [_comment_to_dict(c) for c in comments]})

@router.post("/comments")
async def create_comment(
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Create a comment on a region or page."""
    comment = Comment(
        region_id=uuid.UUID(body["region_id"]) if body.get("region_id") else None,
        page_id=uuid.UUID(body["page_id"]),
        project_id=uuid.UUID(body["project_id"]),
        user_id=current_user["sub"],
        content=body["content"],
        mentioned_user_ids=body.get("mentioned_user_ids", []),
        parent_comment_id=uuid.UUID(body["parent_comment_id"]) if body.get("parent_comment_id") else None,
    )
    db.add(comment)
    await db.flush()
    return created_response(data=_comment_to_dict(comment))

@router.put("/comments/{comment_id}/resolve")
async def resolve_comment(
    comment_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Resolve a comment."""
    comment = (await db.execute(select(Comment).where(Comment.comment_id == comment_id))).scalar_one_or_none()
    if not comment:
        raise ResourceNotFound("Comment", comment_id)
    comment.status = "resolved"
    comment.resolved_by = current_user["sub"]
    comment.resolved_at = datetime.utcnow()
    await db.flush()
    return success_response(data=_comment_to_dict(comment), message="Comment resolved")

# ── Change Logs ──
@router.get("/logs")
async def list_change_logs(
    project_id: Optional[str] = Query(None),
    page_id: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """List change logs (query params)."""
    query = select(ChangeLog)
    if project_id:
        query = query.where(ChangeLog.project_id == project_id)
    if page_id:
        query = query.where(ChangeLog.page_id == page_id)
    query = query.order_by(ChangeLog.created_at.desc())

    count_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar()
    query = query.offset((page - 1) * page_size).limit(page_size)
    logs = (await db.execute(query)).scalars().all()
    return paginated_response(items=[_log_to_dict(l) for l in logs], page=page, page_size=page_size, total=total)


# ── API-11: GET /logs/{page_id} (frontend path-param alias) ──
@router.get("/logs/{page_id}")
async def list_change_logs_by_page(
    page_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """List change logs for a specific page (path param variant for frontend)."""
    return await list_change_logs(page_id=page_id, page=page, page_size=page_size, db=db, current_user=current_user)

@router.post("/logs")
async def record_change_log(
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Record a change log entry (called by other services)."""
    log = ChangeLog(
        project_id=uuid.UUID(body["project_id"]),
        page_id=uuid.UUID(body["page_id"]) if body.get("page_id") else None,
        region_id=uuid.UUID(body["region_id"]) if body.get("region_id") else None,
        user_id=current_user["sub"],
        action=body["action"],
        field_name=body.get("field_name"),
        old_value=body.get("old_value"),
        new_value=body.get("new_value"),
        metadata=body.get("metadata"),
    )
    db.add(log)
    await db.flush()
    return created_response(data=_log_to_dict(log))

# ── Snapshots ──
@router.get("/snapshots")
async def list_snapshots(
    project_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """List snapshots for a project."""
    snapshots = (await db.execute(
        select(Snapshot).where(Snapshot.project_id == project_id).order_by(Snapshot.created_at.desc())
    )).scalars().all()
    return success_response(data={"snapshots": [_snapshot_to_dict(s) for s in snapshots]})

@router.post("/snapshots")
async def create_snapshot(
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Create a version snapshot."""
    snapshot = Snapshot(
        project_id=uuid.UUID(body["project_id"]),
        user_id=current_user["sub"],
        name=body["name"],
        description=body.get("description"),
        snapshot_data=body["snapshot_data"],
    )
    db.add(snapshot)
    await db.flush()
    return created_response(data=_snapshot_to_dict(snapshot))

@router.delete("/snapshots/{snapshot_id}")
async def delete_snapshot(
    snapshot_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    snapshot = (await db.execute(select(Snapshot).where(Snapshot.snapshot_id == snapshot_id))).scalar_one_or_none()
    if not snapshot:
        raise ResourceNotFound("Snapshot", snapshot_id)
    await db.delete(snapshot)
    return success_response(message="Snapshot deleted")

# ── Helpers ──
def _comment_to_dict(c: Comment) -> dict:
    return {
        "comment_id": str(c.comment_id),
        "region_id": str(c.region_id) if c.region_id else None,
        "page_id": str(c.page_id),
        "project_id": str(c.project_id),
        "user_id": str(c.user_id),
        "content": c.content,
        "mentioned_user_ids": c.mentioned_user_ids or [],
        "status": c.status,
        "parent_comment_id": str(c.parent_comment_id) if c.parent_comment_id else None,
        "resolved_by": str(c.resolved_by) if c.resolved_by else None,
        "resolved_at": c.resolved_at.isoformat() if c.resolved_at else None,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
    }

def _log_to_dict(l: ChangeLog) -> dict:
    return {
        "log_id": str(l.log_id),
        "project_id": str(l.project_id) if l.project_id else None,
        "page_id": str(l.page_id) if l.page_id else None,
        "region_id": str(l.region_id) if l.region_id else None,
        "user_id": str(l.user_id),
        "action": l.action,
        "field_name": l.field_name,
        "old_value": l.old_value,
        "new_value": l.new_value,
        "metadata": l.metadata,
        "created_at": l.created_at.isoformat() if l.created_at else None,
    }

def _snapshot_to_dict(s: Snapshot) -> dict:
    return {
        "snapshot_id": str(s.snapshot_id),
        "project_id": str(s.project_id),
        "user_id": str(s.user_id),
        "name": s.name,
        "description": s.description,
        "snapshot_data": s.snapshot_data,
        "created_at": s.created_at.isoformat() if s.created_at else None,
    }
