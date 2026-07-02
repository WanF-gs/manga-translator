from __future__ import annotations
"""Reader Microservice - Port 8006"""
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
from .api import reader, vocab, search_learn

# JSON-structured logging for Loki
setup_json_logging(service_name="reader-service", log_level=settings.LOG_LEVEL)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    await engine.dispose()


app = FastAPI(
    title="Reader Service",
    description="漫画阅读微服务 - 阅读数据管理、生词本管理",
    version="0.1.0",
    docs_url="/docs",
    lifespan=lifespan,
)

# Prometheus metrics instrumentation
setup_instrumentation(app, service_name="reader-service")

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
    return {"status": "ok", "service": "reader-service"}


@app.get("/health/ready")
async def ready():
    return {"status": "ready", "service": "reader-service"}


# Routers
app.include_router(reader.router, prefix="/api/v1")
app.include_router(vocab.router, prefix="/api/v1")
app.include_router(search_learn.router, prefix="/api/v1")

# ── B7 FIX: Root GET stubs for v3.0 endpoints ──
@app.get("/api/v1/reader")
async def reader_root():
    """GET /api/v1/reader — Reader service index."""
    return {"service": "reader", "endpoints": ["POST /api/v1/reader/sessions", "GET /api/v1/reader/progress/{project_id}"], "version": "3.0"}

@app.get("/api/v1/learn")
async def learn_root():
    """GET /api/v1/learn — Learning center index."""
    return {"service": "learning-center", "endpoints": ["GET /api/v1/learn/vocab", "GET /api/v1/learn/progress"], "version": "3.0"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8006)
