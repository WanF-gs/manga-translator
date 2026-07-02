from __future__ import annotations
"""
Unified API response helpers.
"""
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi.responses import JSONResponse


def success_response(
    data: Any = None,
    message: str = "success",
    request_id: Optional[str] = None,
    status_code: int = 200,
) -> JSONResponse:
    """Return a standardized success response."""
    return JSONResponse(
        status_code=status_code,
        content={
            "code": 0,
            "message": message,
            "data": data,
            "request_id": request_id or str(uuid.uuid4()),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    )


def created_response(
    data: Any = None,
    message: str = "Created successfully",
    request_id: Optional[str] = None,
) -> JSONResponse:
    """Return a standardized 201 created response."""
    return success_response(data=data, message=message, request_id=request_id, status_code=201)


def error_response(
    code: int,
    message: str,
    status_code: int = 400,
    request_id: Optional[str] = None,
    errors: Optional[List[Dict[str, str]]] = None,
) -> JSONResponse:
    """Return a standardized error response."""
    content: Dict[str, Any] = {
        "code": code,
        "message": message,
        "data": None,
        "request_id": request_id or str(uuid.uuid4()),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    if errors:
        content["errors"] = errors
    return JSONResponse(status_code=status_code, content=content)


def paginated_response(
    items: list,
    page: int,
    page_size: int,
    total: int,
    request_id: Optional[str] = None,
) -> JSONResponse:
    """Return a standardized paginated response."""
    total_pages = max(1, (total + page_size - 1) // page_size)
    return success_response(
        data={
            "items": items,
            "pagination": {
                "page": page,
                "page_size": page_size,
                "total": total,
                "total_pages": total_pages,
            },
        },
        request_id=request_id,
    )
