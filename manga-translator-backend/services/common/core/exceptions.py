from __future__ import annotations
"""
Application exception hierarchy.
"""
from typing import Any, Dict, List, Optional


class AppException(Exception):
    """Base application exception."""

    def __init__(
        self,
        code: int,
        message: str,
        status_code: int = 400,
        errors: Optional[List[Dict[str, str]]] = None,
    ):
        self.code = code
        self.message = message
        self.status_code = status_code
        self.errors = errors or []
        super().__init__(message)


class ResourceNotFound(AppException):
    """Resource not found (404)."""

    def __init__(self, resource: str, resource_id: str):
        super().__init__(
            code=1002,
            message=f"{resource} not found: {resource_id}",
            status_code=404,
        )


class PermissionDenied(AppException):
    """Permission denied (403)."""

    def __init__(self, message: str = "Permission denied"):
        super().__init__(code=1003, message=message, status_code=403)


class AuthenticationFailed(AppException):
    """Authentication failed (401)."""

    def __init__(self, message: str = "Authentication failed"):
        super().__init__(code=2001, message=message, status_code=401)


class TokenExpired(AppException):
    """Token has expired (401)."""

    def __init__(self):
        super().__init__(code=2002, message="Token has expired, please refresh", status_code=401)


class TokenInvalid(AppException):
    """Token is invalid or revoked (401)."""

    def __init__(self):
        super().__init__(code=2003, message="Token is invalid or has been revoked", status_code=401)


class FreePlanLimit(AppException):
    """Free plan feature limit (403)."""

    def __init__(self, feature: str):
        super().__init__(
            code=1004,
            message=f"Free plan does not support {feature}. Please upgrade to premium.",
            status_code=403,
        )


class ValidationError(AppException):
    """Validation error (400)."""

    def __init__(self, message: str = "Validation failed", errors: Optional[List[Dict]] = None):
        super().__init__(code=1001, message=message, status_code=400, errors=errors)


class ProcessingFailed(AppException):
    """Processing step failed (500)."""

    def __init__(self, step: str, detail: str = ""):
        super().__init__(
            code=3001,
            message=f"{step} processing failed: {detail}",
            status_code=500,
        )


class ServiceUnavailable(AppException):
    """Service unavailable (503)."""

    def __init__(self, service: str = ""):
        super().__init__(
            code=5001,
            message=f"Service temporarily unavailable{f': {service}' if service else ''}",
            status_code=503,
        )
