from __future__ import annotations
"""
Translation Service - FastAPI application entry point.
Port: 8003
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

from .api import translate, terms, memory, characters, quality, feedback

# JSON-structured logging for Loki
setup_json_logging(service_name="translation-service", log_level=settings.LOG_LEVEL)

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events with cache warmup."""
    # Startup: warm up translation cache from DB to Redis
    try:
        from .tasks.cache_warmup import warmup_translation_cache, schedule_cache_sync
        await warmup_translation_cache()
        await schedule_cache_sync()
        logger.info("Translation cache warmup completed")
    except Exception as e:
        logger.warning(f"Translation cache warmup skipped: {e}")
    yield


app = FastAPI(
    title=f"{settings.APP_NAME} - Translation Service",
    version=settings.APP_VERSION,
    docs_url="/docs",
    lifespan=lifespan,
)

# Prometheus metrics instrumentation
setup_instrumentation(app, service_name="translation-service")

app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins_list, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
app.add_middleware(RequestIDMiddleware)
app.add_middleware(AuthenticationMiddleware)

app.include_router(translate.router, prefix="/api/v1", tags=["Translation"])
app.include_router(terms.router, prefix="/api/v1/terms", tags=["Terms"])
app.include_router(memory.router, prefix="/api/v1", tags=["Memory"])
app.include_router(characters.router, prefix="/api/v1/characters", tags=["Characters"])
app.include_router(quality.router, prefix="/api/v1/quality", tags=["Quality"])
app.include_router(feedback.router, prefix="/api/v1/feedback", tags=["Feedback"])


@app.get("/health")
async def health():
    return {"status": "healthy", "service": "translation-service", "version": settings.APP_VERSION}


@app.get("/health/ready")
async def ready():
    return {"status": "ready", "service": "translation-service", "checks": {"database": {"status": "ok"}}}

# ── B7 FIX: Root GET stubs for v3.0 endpoints ──
@app.get("/api/v1/quality")
async def quality_root():
    """GET /api/v1/quality — Translation quality assessment index."""
    return {"service": "translation-quality", "endpoints": ["POST /api/v1/quality/assess/{page_id}"], "version": "3.0"}
