from __future__ import annotations
"""Image Processing Microservice - Port 8004"""
import sys
import os
import logging
from contextlib import asynccontextmanager
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
logger = logging.getLogger(__name__)

import pathlib
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from common.core.config import settings
from common.core.database import engine, Base
from common.middleware.request_id import RequestIDMiddleware
from common.middleware.auth import AuthenticationMiddleware
from common.monitoring import setup_instrumentation, setup_json_logging
from .api import detect, ocr, inpaint, render, enhance, batch, preprocess
from .api import erase_quality, content_safety  # v3.0

# Ensure uploads directory exists for MinIO fallback file writes
# Prefer env-var, fallback to temp dir (WSL2 compatibility)
_upload_dir = os.getenv("UPLOAD_DIR", "/tmp/manga-uploads")
UPLOADS_DIR = pathlib.Path(_upload_dir)
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

# JSON-structured logging for Loki
setup_json_logging(service_name="image-service", log_level=settings.LOG_LEVEL)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # P0: 预加载 OCR 模型，避免首次请求延迟
    try:
        try:
            from service.ocr_service import _get_manga_ocr, _get_rapid_ocr
        except ImportError:
            from image_service.service.ocr_service import _get_manga_ocr, _get_rapid_ocr

        import asyncio as _asyncio
        loop = _asyncio.get_event_loop()
        await loop.run_in_executor(None, _get_manga_ocr)
        logger.info("manga-ocr preloaded in image_service")
        await loop.run_in_executor(None, _get_rapid_ocr)
        logger.info("RapidOCR preloaded in image_service")
    except Exception as e:
        logger.warning(f"OCR preload skipped in image_service: {e}")

    yield
    await engine.dispose()


app = FastAPI(
    title="Image Processing Service",
    description="漫画图像处理微服务 - 文字检测、OCR识别、图像修复、文字渲染、图像增强",
    version="0.1.0",
    docs_url="/docs",
    lifespan=lifespan,
)

# Prometheus metrics instrumentation
setup_instrumentation(app, service_name="image-service")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Request ID
app.add_middleware(RequestIDMiddleware)

# Authentication
app.add_middleware(AuthenticationMiddleware)

# Health check
@app.get("/health")
async def health():
    return {"status": "ok", "service": "image-service"}


@app.get("/health/ready")
async def ready():
    return {"status": "ready", "service": "image-service"}

# ── B7 FIX: Root GET stubs for v3.0 endpoints ──
@app.get("/api/v1/erase-quality")
async def erase_quality_root():
    """GET /api/v1/erase-quality — Erase quality evaluation index."""
    return {"service": "erase-quality", "endpoints": ["POST /api/v1/erase-quality/evaluate"], "version": "3.0"}

@app.get("/api/v1/safety")
async def safety_root():
    """GET /api/v1/safety — Content safety moderation index."""
    return {"service": "content-safety", "endpoints": ["POST /api/v1/safety/check-image"], "version": "3.0"}


# Static file serving for uploaded processed images (MinIO fallback)
# Mount BEFORE API routes so /uploads/ is served directly without auth middleware
app.mount("/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")

# Routers
app.include_router(detect.router, prefix="/api/v1")
app.include_router(ocr.router, prefix="/api/v1")
app.include_router(inpaint.router, prefix="/api/v1")
app.include_router(render.router, prefix="/api/v1")
app.include_router(enhance.router, prefix="/api/v1")
app.include_router(batch.router, prefix="/api/v1")
app.include_router(preprocess.router, prefix="/api/v1")
app.include_router(erase_quality.router, prefix="/api/v1")  # v3.0
app.include_router(content_safety.router, prefix="/api/v1")  # v3.0

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8004)
