from __future__ import annotations
"""Export Microservice - Port 8005"""
import sys
import os
from contextlib import asynccontextmanager
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from common.core.config import settings
from common.core.database import engine, Base
from common.middleware.request_id import RequestIDMiddleware
from common.middleware.auth import AuthenticationMiddleware
from common.monitoring import setup_instrumentation, setup_json_logging
from .api import export, tasks, bilingual, long_image, audio_dynamic

# JSON-structured logging for Loki
setup_json_logging(service_name="export-service", log_level=settings.LOG_LEVEL)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    await engine.dispose()


app = FastAPI(
    title="Export Service",
    description="漫画导出微服务 - 单页/批量导出、格式转换、双语合成",
    version="0.1.0",
    docs_url="/docs",
    lifespan=lifespan,
)

# Prometheus metrics instrumentation
setup_instrumentation(app, service_name="export-service")

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
    return {"status": "ok", "service": "export-service"}


@app.get("/health/ready")
async def ready():
    return {"status": "ready", "service": "export-service"}


# Routers
app.include_router(export.router, prefix="/api/v1")       # /api/v1/exports/*
app.include_router(export.export_router, prefix="/api/v1") # /api/v1/export/* (PRD aliases)
app.include_router(export.pages_export_router, prefix="/api/v1")
app.include_router(export.chapters_export_router, prefix="/api/v1")
app.include_router(tasks.router, prefix="/api/v1")
app.include_router(bilingual.router, prefix="/api/v1")
app.include_router(long_image.router, prefix="/api/v1")
app.include_router(audio_dynamic.router, prefix="/api/v1")  # /api/v1/audio/*, /api/v1/dynamic-manga/*

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8005)
