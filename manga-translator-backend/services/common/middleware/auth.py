from __future__ import annotations
"""
JWT Authentication middleware for FastAPI microservices.

Uses raw ASGI middleware (NOT BaseHTTPMiddleware) to avoid
interfering with WebSocket connections. BaseHTTPMiddleware
internally calls request.body() which is incompatible with
WebSocket handshakes, causing "WebSocket is closed before
the connection is established" errors.
"""
from starlette.requests import Request
from starlette.responses import JSONResponse

from ..core.security import decode_token

PUBLIC_PATHS = [
    "/api/v1/auth/register",
    "/api/v1/auth/login",
    "/api/v1/auth/refresh",
    "/api/v1/ws/notifications",
    "/api/v1/ws/projects",
    "/health",
    "/health/ready",
    "/docs",
    "/redoc",
    "/openapi.json",
]

PUBLIC_PATH_PREFIXES = [
    "/storage/",  # 静态文件存储路径（用户上传原图）
    "/uploads/",  # 处理后图片路径（inpaint、render 等结果图，供 <img> 标签加载）
    "/api/v1/external/",  # 开放平台外部 API：由 API Key 依赖鉴权，跳过 JWT 中间件
    "/api/v1/fonts/file/",  # 字体文件二进制流（被 <img>/@font-face 直接加载，浏览器不会带 Authorization 头）
]


def _is_public_path(path: str) -> bool:
    """Check if a path should skip authentication."""
    if path in PUBLIC_PATHS:
        return True
    if path.startswith("/docs") or path.startswith("/redoc") or path.startswith("/openapi"):
        return True
    for prefix in PUBLIC_PATH_PREFIXES:
        if path.startswith(prefix):
            return True
    # Allow page image serving endpoints used by <img> tags without auth headers
    if path.startswith("/api/v1/pages/") and path.endswith("/image"):
        return True
    return False


class AuthenticationMiddleware:
    """
    Pure ASGI middleware that validates JWT tokens.
    
    NOT based on BaseHTTPMiddleware to ensure WebSocket connections
    are passed through without any interception.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        # WebSocket connections: pass through immediately — token 
        # validation is done inside the WebSocket endpoint handler.
        if scope.get("type") == "websocket":
            await self.app(scope, receive, send)
            return

        # Only process HTTP requests
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        # Build request for path/handler inspection
        request = Request(scope, receive=receive)
        path = request.url.path

        # Skip public paths
        if _is_public_path(path):
            await self.app(scope, receive, send)
            return

        # Extract token from Authorization header
        auth_header = ""
        for key, value in scope.get("headers", []):
            if key == b"authorization":
                auth_header = value.decode("latin-1")
                break

        if not auth_header.startswith("Bearer "):
            # Also check X-User-ID header (set by gateway)
            user_id = ""
            plan_type = "free"
            for key, value in scope.get("headers", []):
                if key == b"x-user-id":
                    user_id = value.decode("latin-1")
                elif key == b"x-plan-type":
                    plan_type = value.decode("latin-1")

            if user_id:
                # Inject user info into scope for downstream handlers.
                # Use a plain dict — Starlette's Request will wrap it into a
                # State object, so downstream middleware (e.g. RequestIDMiddleware)
                # can safely set attributes like `request.state.request_id = ...`.
                if "state" not in scope:
                    scope["state"] = {}
                scope["state"]["user_id"] = user_id
                scope["state"]["plan_type"] = plan_type
                await self.app(scope, receive, send)
                return

            response = JSONResponse(
                status_code=401,
                content={
                    "code": 2001,
                    "message": "Missing authentication token",
                    "data": None,
                },
            )
            await response(scope, receive, send)
            return

        token = auth_header.split(" ", 1)[1]

        try:
            payload = decode_token(token)
            if payload.get("type") != "access":
                response = JSONResponse(
                    status_code=401,
                    content={
                        "code": 2003,
                        "message": "Invalid token type",
                        "data": None,
                    },
                )
                await response(scope, receive, send)
                return

            # Store user info in scope for downstream handlers.
            # Use a plain dict — Starlette's Request will wrap it into a
            # State object automatically, so downstream middleware and handlers
            # can safely use `request.state.user_id` / `request.state.plan_type`.
            if "state" not in scope:
                scope["state"] = {}
            scope["state"]["user_id"] = payload["sub"]
            scope["state"]["plan_type"] = payload.get("plan", "free")
        except Exception as e:
            response = JSONResponse(
                status_code=401,
                content={
                    "code": 2003,
                    "message": str(e),
                    "data": None,
                },
            )
            await response(scope, receive, send)
            return

        await self.app(scope, receive, send)
