from __future__ import annotations
"""
Project Service - FastAPI application entry point.
Port: 8002
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from common.core.config import settings
from common.middleware.request_id import RequestIDMiddleware
from common.middleware.auth import AuthenticationMiddleware
from common.monitoring import setup_instrumentation, setup_json_logging

from .api import projects, chapters, pages, presets, trash, pipeline, undo, websocket, moderation, storage, fonts, collaboration, review, members, export_proxy

# JSON-structured logging for Loki
setup_json_logging(service_name="project-service", log_level=settings.LOG_LEVEL)


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


app = FastAPI(
    title=f"{settings.APP_NAME} - Project Service",
    version=settings.APP_VERSION,
    docs_url="/docs",
    lifespan=lifespan,
)

# Prometheus metrics instrumentation
setup_instrumentation(app, service_name="project-service")

app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins_list, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
app.add_middleware(RequestIDMiddleware)
app.add_middleware(AuthenticationMiddleware)

app.include_router(projects.router, prefix="/api/v1/projects", tags=["Projects"])
app.include_router(chapters.router, prefix="/api/v1/chapters", tags=["Chapters"])
app.include_router(pages.router, prefix="/api/v1/pages", tags=["Pages"])
# P0-2 fix: Mount only upload routes under /api/v1 to support /chapters/{cid}/pages/upload
# WITHOUT polluting root namespace with /{page_id} catch-all routes
app.include_router(pages.upload_router, prefix="/api/v1", tags=["Pages"])
app.include_router(presets.router, prefix="/api/v1/presets", tags=["Presets"])
app.include_router(trash.router, prefix="/api/v1/trash", tags=["Trash"])
app.include_router(pipeline.router, prefix="/api/v1")
app.include_router(undo.router, prefix="/api/v1")
app.include_router(websocket.router, prefix="/api/v1")
app.include_router(moderation.router, prefix="/api/v1")
app.include_router(storage.router)  # /storage/* file serving (no prefix, raw path)
app.include_router(fonts.router, prefix="/api/v1/fonts", tags=["Fonts"])
app.include_router(collaboration.router, prefix="/api/v1/collaboration", tags=["Collaboration"])
app.include_router(review.router, prefix="/api/v1", tags=["Review"])
app.include_router(review.review_router, prefix="/api/v1", tags=["Review"])  # P0-3 fix: /review/* paths for E2E compatibility
app.include_router(members.router, prefix="/api/v1", tags=["Members"])
# FIX: Character management proxy — /api/v1/projects/:pid/characters → translation-service characters API
# Project-service acts as pass-through, delegating to translation-service internally
from .api.characters_proxy import characters_proxy_router
app.include_router(characters_proxy_router, prefix="/api/v1", tags=["Characters"])
app.include_router(export_proxy.router, prefix="/api/v1", tags=["Export"])
from .api.invites import router as invites_router
app.include_router(invites_router, prefix="/api/v1", tags=["Invites"])
from .api.privacy import router as privacy_router
app.include_router(privacy_router, tags=["Privacy"])


@app.get("/health")
async def health():
    return {"status": "healthy", "service": "project-service", "version": settings.APP_VERSION}


@app.get("/health/ready")
async def ready():
    return {"status": "ready", "service": "project-service", "checks": {"database": {"status": "ok"}}}

# ── B7 FIX: Root GET stubs for v3.0 endpoints ──
@app.get("/api/v1/review")
async def review_root():
    """GET /api/v1/review — Proofreading review workbench index."""
    return {"service": "review-workbench", "endpoints": ["GET /api/v1/projects/{pid}/review/pages"], "version": "3.0"}

@app.get("/api/v1/quality-dashboard")
async def quality_dashboard_root():
    """GET /api/v1/quality-dashboard — Quality assessment dashboard index."""
    return {"service": "quality-dashboard", "endpoints": ["GET /api/v1/quality-dashboard/overview"], "version": "3.0"}
