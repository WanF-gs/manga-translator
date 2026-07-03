from __future__ import annotations
"""API Key Management API - External API platform (v3.0)."""
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, update
from typing import Optional
import secrets, hashlib, uuid, sys, os

_cur = os.path.dirname(os.path.abspath(__file__))
_svc = os.path.dirname(os.path.dirname(_cur))
if _svc not in sys.path:
    sys.path.insert(0, _svc)

from common.core.database import get_db
from common.core.dependencies import get_current_user
from common.core.response import success_response, paginated_response, created_response
from common.core.exceptions import ResourceNotFound
from common.models.v3_models import APIKey

router = APIRouter()

API_KEY_PREFIX = "msk_"

@router.get("")
async def list_api_keys(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """List user's API keys."""
    query = select(APIKey).where(APIKey.user_id == current_user["sub"]).order_by(APIKey.created_at.desc())
    count_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar()
    query = query.offset((page - 1) * page_size).limit(page_size)
    keys = (await db.execute(query)).scalars().all()
    return paginated_response(items=[_key_to_dict(k) for k in keys], page=page, page_size=page_size, total=total)

@router.post("")
async def create_api_key(
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Create a new API key. Returns the full key only once!"""
    raw_key = API_KEY_PREFIX + secrets.token_urlsafe(32)
    key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
    key_prefix = raw_key[:8]  # 匹配数据库 key_prefix VARCHAR(8)

    api_key = APIKey(
        user_id=current_user["sub"],
        key_hash=key_hash,
        key_prefix=key_prefix,
        name=body.get("name", "Default Key"),
        permissions=body.get("permissions", ["detect", "ocr", "translate"]),
        rate_limit=body.get("rate_limit", 60),
        expires_at=body.get("expires_at"),
    )
    db.add(api_key)
    await db.flush()

    result = _key_to_dict(api_key)
    result["api_key"] = raw_key  # Only returned once!
    return created_response(data=result, message="API Key created - save it now, it won't be shown again!")

@router.put("/{api_key_id}")
async def update_api_key(
    api_key_id: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Update API key name, permissions, or status."""
    key = (await db.execute(select(APIKey).where(APIKey.api_key_id == api_key_id, APIKey.user_id == current_user["sub"]))).scalar_one_or_none()
    if not key:
        raise ResourceNotFound("API Key", api_key_id)
    for field in ["name", "permissions", "rate_limit", "is_active"]:
        if field in body:
            setattr(key, field, body[field])
    await db.flush()
    return success_response(data=_key_to_dict(key))

@router.delete("/{api_key_id}")
async def delete_api_key(
    api_key_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    key = (await db.execute(select(APIKey).where(APIKey.api_key_id == api_key_id, APIKey.user_id == current_user["sub"]))).scalar_one_or_none()
    if not key:
        raise ResourceNotFound("API Key", api_key_id)
    await db.delete(key)
    return success_response(message="API Key deleted")

@router.get("/{api_key_id}/stats")
async def get_single_key_stats(
    api_key_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Get usage statistics for a single API key."""
    key = (await db.execute(
        select(APIKey).where(APIKey.api_key_id == api_key_id, APIKey.user_id == current_user["sub"])
    )).scalar_one_or_none()
    if not key:
        raise ResourceNotFound("API Key", api_key_id)
    return success_response(data={
        "api_key_id": str(key.api_key_id),
        "total_calls": key.total_calls or 0,
        "monthly_calls": key.monthly_calls or 0,
        "last_used_at": key.last_used_at.isoformat() if key.last_used_at else None,
    })

@router.get("/stats/usage")
async def get_usage_stats(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Get API usage statistics for the user."""
    keys = (await db.execute(select(APIKey).where(APIKey.user_id == current_user["sub"]))).scalars().all()
    total_calls = sum(k.total_calls or 0 for k in keys)
    monthly_calls = sum(k.monthly_calls or 0 for k in keys)
    active_keys = sum(1 for k in keys if k.is_active)
    return success_response(data={
        "total_keys": len(keys),
        "active_keys": active_keys,
        "total_calls": total_calls,
        "monthly_calls": monthly_calls,
        "keys": [_key_to_dict(k) for k in keys],
    })

def _key_to_dict(k: APIKey) -> dict:
    return {
        "api_key_id": str(k.api_key_id),
        "key_prefix": k.key_prefix,
        "name": k.name,
        "permissions": k.permissions or [],
        "rate_limit": k.rate_limit,
        "total_calls": k.total_calls,
        "monthly_calls": k.monthly_calls,
        "is_active": k.is_active,
        "expires_at": k.expires_at.isoformat() if k.expires_at else None,
        "last_used_at": k.last_used_at.isoformat() if k.last_used_at else None,
        "created_at": k.created_at.isoformat() if k.created_at else None,
    }
