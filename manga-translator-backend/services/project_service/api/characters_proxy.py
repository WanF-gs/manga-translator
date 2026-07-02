from __future__ import annotations
"""
Character management proxy — delegates /api/v1/projects/{pid}/characters
to translation-service's characters API internally.
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Query
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
import httpx

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from common.core.config import settings

logger = logging.getLogger(__name__)

characters_proxy_router = APIRouter(prefix="/projects")


def _get_translation_service_url() -> str:
    """Get translation-service base URL."""
    return os.environ.get(
        "TRANSLATION_SERVICE_URL",
        "http://translation-service:8003"
    )


@characters_proxy_router.get("/{project_id}/characters")
async def list_project_characters(
    project_id: str,
    request: Request,
    tone_type: Optional[str] = Query(None),
):
    """GET /api/v1/projects/{pid}/characters — Proxy to translation-service."""
    try:
        base_url = _get_translation_service_url()
        url = f"{base_url}/api/v1/characters"
        params = {"project_id": project_id}
        if tone_type:
            params["tone_type"] = tone_type

        # Forward auth header
        headers = {}
        auth_header = request.headers.get("Authorization")
        if auth_header:
            headers["Authorization"] = auth_header
        request_id = request.headers.get("X-Request-ID")
        if request_id:
            headers["X-Request-ID"] = request_id

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, params=params, headers=headers)
            return JSONResponse(
                content=resp.json(),
                status_code=resp.status_code,
            )
    except httpx.TimeoutException:
        logger.error(f"Timeout proxying characters list for project {project_id}")
        raise HTTPException(status_code=504, detail="Translation service timeout")
    except httpx.ConnectError:
        logger.error(f"Cannot connect to translation-service for characters list")
        raise HTTPException(status_code=503, detail="Translation service unavailable")
    except Exception as e:
        logger.error(f"Failed to proxy characters list: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal proxy error: {str(e)}")


@characters_proxy_router.post("/{project_id}/characters")
async def create_project_character(
    project_id: str,
    request: Request,
):
    """POST /api/v1/projects/{pid}/characters — Proxy to translation-service."""
    try:
        base_url = _get_translation_service_url()
        url = f"{base_url}/api/v1/characters"

        headers = {}
        auth_header = request.headers.get("Authorization")
        if auth_header:
            headers["Authorization"] = auth_header
        request_id = request.headers.get("X-Request-ID")
        if request_id:
            headers["X-Request-ID"] = request_id

        body = await request.json()
        # Inject project_id from URL path if not in body
        if "project_id" not in body:
            body["project_id"] = project_id

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(url, json=body, headers=headers)
            return JSONResponse(
                content=resp.json(),
                status_code=resp.status_code,
            )
    except httpx.TimeoutException:
        logger.error(f"Timeout proxying character creation for project {project_id}")
        raise HTTPException(status_code=504, detail="Translation service timeout")
    except httpx.ConnectError:
        logger.error(f"Cannot connect to translation-service for character creation")
        raise HTTPException(status_code=503, detail="Translation service unavailable")
    except Exception as e:
        logger.error(f"Failed to proxy character creation: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal proxy error: {str(e)}")
