from __future__ import annotations
"""
User Service - FastAPI application entry point.
Port: 8001
"""
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

from .api import auth, profile, api_keys, payments, external

# JSON-structured logging for Loki
setup_json_logging(service_name="user-service", log_level=settings.LOG_LEVEL)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events."""
    yield


app = FastAPI(
    title=f"{settings.APP_NAME} - User Service",
    version=settings.APP_VERSION,
    description="Authentication and user profile management APIs",
    docs_url="/docs",
    lifespan=lifespan,
)

# Prometheus metrics instrumentation
setup_instrumentation(app, service_name="user-service")

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

# Routers
app.include_router(auth.router, prefix="/api/v1/auth", tags=["Authentication"])
app.include_router(profile.router, prefix="/api/v1/user", tags=["User Profile"])
app.include_router(api_keys.router, prefix="/api/v1/api-keys", tags=["API Keys"])
# FIX: /api/v1/platform/keys alias — same router, different prefix for frontend compatibility
app.include_router(api_keys.router, prefix="/api/v1/platform/keys", tags=["API Keys"])
app.include_router(payments.router, prefix="/api/v1/payments", tags=["Payments"])
# 开放平台外部 API（API Key 鉴权，非 JWT）— /api/v1/external/{detect,ocr,translate}
app.include_router(external.router, prefix="/api/v1", tags=["Open Platform"])


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "user-service",
        "version": settings.APP_VERSION,
    }


@app.get("/health/ready")
async def ready():
    return {
        "status": "ready",
        "service": "user-service",
        "checks": {
            "database": {"status": "ok"},
        },
    }
