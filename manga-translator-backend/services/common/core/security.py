from __future__ import annotations
"""
Security utilities: JWT token creation/verification, password hashing.
"""
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from fastapi import Depends, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from passlib.context import CryptContext

from .config import settings
from .exceptions import AuthenticationFailed, TokenExpired, TokenInvalid

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security_scheme = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    """Hash a password using bcrypt."""
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against its hash."""
    return pwd_context.verify(plain_password, hashed_password)


def create_access_token(
    subject: str,
    plan_type: str = "free",
    expires_delta: Optional[timedelta] = None,
) -> str:
    """Create a JWT access token."""
    if expires_delta is None:
        expires_delta = timedelta(seconds=settings.JWT_ACCESS_TOKEN_EXPIRE)

    now = datetime.now(timezone.utc)
    payload: Dict[str, Any] = {
        "sub": subject,
        "plan": plan_type,
        "exp": now + expires_delta,
        "iat": now,
        "jti": str(uuid.uuid4()),
        "type": "access",
    }
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def create_refresh_token(
    subject: str,
    expires_delta: Optional[timedelta] = None,
) -> str:
    """Create a JWT refresh token."""
    if expires_delta is None:
        expires_delta = timedelta(seconds=settings.JWT_REFRESH_TOKEN_EXPIRE)

    now = datetime.now(timezone.utc)
    payload: Dict[str, Any] = {
        "sub": subject,
        "exp": now + expires_delta,
        "iat": now,
        "jti": str(uuid.uuid4()),
        "type": "refresh",
    }
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> Dict[str, Any]:
    """Decode and validate a JWT token."""
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
        )
        return payload
    except JWTError as e:
        error_msg = str(e).lower()
        if "expired" in error_msg:
            raise TokenExpired()
        raise TokenInvalid()


def get_token_payload(token: str, token_type: str = "access") -> Dict[str, Any]:
    """Decode and validate a JWT token of a specific type."""
    payload = decode_token(token)
    if payload.get("type") != token_type:
        raise TokenInvalid()
    return payload


async def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_scheme),
) -> Dict[str, Any]:
    """FastAPI dependency: get the current authenticated user from JWT.

    Supports two authentication paths:
    1. Direct JWT via Authorization header (standalone / direct API calls)
    2. Gateway-injected X-User-ID via request.state (proxied through gateway)
       The ASGI AuthenticationMiddleware sets scope["state"]["user_id"] when it
       trusts the gateway header, so we fall back to that here.
    """
    if credentials is not None:
        token = credentials.credentials
        payload = decode_token(token)
        if payload.get("type") != "access":
            raise TokenInvalid()
        return payload

    # Fallback: gateway-injected user info from AuthenticationMiddleware
    user_id = getattr(request.state, "user_id", None)
    if user_id:
        return {
            "sub": user_id,
            "plan": getattr(request.state, "plan_type", "free"),
            "type": "access",
        }

    raise AuthenticationFailed("Missing authentication token")


async def get_optional_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_scheme),
) -> Optional[Dict[str, Any]]:
    """FastAPI dependency: get the current user if authenticated, None otherwise."""
    if credentials is not None:
        try:
            token = credentials.credentials
            payload = decode_token(token)
            if payload.get("type") != "access":
                return None
            return payload
        except Exception:
            return None

    # Fallback: gateway-injected user info
    user_id = getattr(request.state, "user_id", None)
    if user_id:
        return {
            "sub": user_id,
            "plan": getattr(request.state, "plan_type", "free"),
            "type": "access",
        }

    return None
