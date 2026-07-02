from __future__ import annotations
"""
Request ID injection middleware.

Fixed in Phase 1: Converted from BaseHTTPMiddleware to pure ASGI middleware.
BaseHTTPMiddleware internally calls request.body() which consumes the multipart
request body, causing FastAPI UploadFile to receive an empty stream → 500 error.
"""
import uuid

from starlette.responses import Response


class RequestIDMiddleware:
    """
    Pure ASGI middleware that injects a unique X-Request-ID header.

    NOT based on BaseHTTPMiddleware to avoid consuming the request body.
    This is critical for multipart/form-data upload endpoints.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        request_id = ""
        for key, value in scope.get("headers", []):
            if key == b"x-request-id":
                request_id = value.decode("latin-1")
                break

        if not request_id:
            request_id = str(uuid.uuid4())

        async def send_with_id(message):
            if message.get("type") == "http.response.start":
                headers = list(message.get("headers", []))
                headers.append((b"x-request-id", request_id.encode("latin-1")))
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_with_id)
