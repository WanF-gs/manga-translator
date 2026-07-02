from __future__ import annotations
"""开放平台 API Key 鉴权依赖。

外部开发者通过 `X-API-Key: msk_xxx` 头调用 /api/v1/external/* 端点。
本模块提供 `require_api_key(permission)` 依赖工厂：校验密钥有效性、过期、
权限范围，并累加调用计数（total_calls / monthly_calls / last_used_at）。

注意：密钥哈希算法与创建端点保持一致（sha256，见 user_service/api/api_keys.py）。
PRD 要求 bcrypt，属安全增强项，已在工程债中标注为 P2（切换需同步改创建端点，
且 bcrypt 无法按哈希直接查询，需改为 key_prefix 索引 + 逐一 verify）。
"""
import hashlib
from datetime import datetime, timezone
from typing import Any, Callable, Dict

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .database import get_db
from .exceptions import AuthenticationFailed, PermissionDenied
from ..models.v3_models import APIKey


def _extract_api_key(request: Request) -> str:
    """从请求中提取 API Key，支持 X-API-Key 头或 Authorization: Bearer msk_xxx。"""
    key = request.headers.get("X-API-Key") or request.headers.get("x-api-key")
    if not key:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer ") and auth[7:].startswith("msk_"):
            key = auth[7:]
    return (key or "").strip()


def require_api_key(permission: str) -> Callable:
    """依赖工厂：要求携带具备 `permission` 权限的有效 API Key。

    Args:
        permission: 该端点所需权限，取值 detect / ocr / translate。
    Returns:
        FastAPI 依赖，注入后返回 {"sub": user_id, "api_key_id": ..., "permissions": [...]}。
    """

    async def _dependency(
        request: Request,
        db: AsyncSession = Depends(get_db),
    ) -> Dict[str, Any]:
        raw_key = _extract_api_key(request)
        if not raw_key:
            raise AuthenticationFailed("缺少 API Key（请在 X-API-Key 头中携带）")

        key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
        api_key = (
            await db.execute(select(APIKey).where(APIKey.key_hash == key_hash))
        ).scalar_one_or_none()

        if not api_key:
            raise AuthenticationFailed("无效的 API Key")
        if not api_key.is_active:
            raise AuthenticationFailed("API Key 已被禁用")
        if api_key.expires_at is not None:
            expires_at = api_key.expires_at
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            if expires_at < datetime.now(timezone.utc):
                raise AuthenticationFailed("API Key 已过期")

        perms = api_key.permissions or []
        if permission not in perms:
            raise PermissionDenied(f"该 API Key 无 '{permission}' 权限")

        # 诚实累加真实调用计数（PRD §2.24 调用统计与计费的数据基础）
        api_key.total_calls = (api_key.total_calls or 0) + 1
        api_key.monthly_calls = (api_key.monthly_calls or 0) + 1
        api_key.last_used_at = datetime.now(timezone.utc)
        await db.flush()

        return {
            "sub": str(api_key.user_id),
            "api_key_id": str(api_key.api_key_id),
            "permissions": perms,
        }

    return _dependency
