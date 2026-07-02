from __future__ import annotations
"""
Premium plan check middleware.
"""
from fnmatch import fnmatch
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

PREMIUM_ONLY_PATTERNS = [
    "/api/v1/pages/*/translate?engine=multimodal*",
    "/api/v1/pages/*/enhance",
    "/api/v1/export/batch",
]


class PlanCheckMiddleware(BaseHTTPMiddleware):
    """Checks if the user has premium plan for premium-only features."""

    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        # Check if this path requires premium
        requires_premium = False
        for pattern in PREMIUM_ONLY_PATTERNS:
            # Simple path matching
            clean_pattern = pattern.split("?")[0]
            if fnmatch(path, clean_pattern):
                # Check if multimodal engine is requested
                if "engine=multimodal" in pattern:
                    query = request.url.query or ""
                    if "multimodal" in query:
                        requires_premium = True
                        break
                else:
                    requires_premium = True
                    break

        if requires_premium:
            plan_type = getattr(request.state, "plan_type", "free")
            if plan_type != "premium":
                return JSONResponse(
                    status_code=403,
                    content={
                        "code": 1004,
                        "message": "This feature requires premium plan. Please upgrade.",
                        "data": {"upgrade_url": "/settings/upgrade"},
                    },
                )

        return await call_next(request)
