from __future__ import annotations
"""
Unified Prometheus instrumentation setup for FastAPI services.
Exposes /metrics endpoint and adds custom business metrics.
"""
import os
from typing import Optional

from fastapi import FastAPI
from prometheus_client import Counter, Histogram, Gauge, generate_latest, REGISTRY
from prometheus_fastapi_instrumentator import Instrumentator, metrics
from starlette.requests import Request
from starlette.responses import Response


# ===================== Custom Business Metrics =====================

# AI Gateway latency per endpoint
ai_gateway_latency = Histogram(
    "ai_gateway_latency_seconds",
    "AI model inference latency in seconds",
    ["endpoint", "method"],
    buckets=[0.1, 0.5, 1.0, 2.0, 5.0, 10.0, 30.0, 60.0],
)

# Content safety request counter
content_safety_requests = Counter(
    "content_safety_requests_total",
    "Content safety moderation request counts",
    ["result"],  # approved, rejected, pending_review
)

# Celery queue length (updated periodically)
celery_queue_length = Gauge(
    "celery_queue_length",
    "Current number of pending tasks in each Celery queue",
    ["queue_name"],
)

# Translation engine usage
translation_engine_requests = Counter(
    "translation_engine_requests_total",
    "Translation requests per engine",
    ["engine", "source_lang", "target_lang"],
)

# Translation cache hit/miss
translation_cache_counter = Counter(
    "translation_cache_total",
    "Translation cache hit/miss counts",
    ["result"],  # hit, miss
)

# Image processing counters
image_processing_requests = Counter(
    "image_processing_requests_total",
    "Image processing pipeline step counts",
    ["step", "status"],  # step: detect/ocr/translate/inpaint/render; status: success/error
)

# Business metrics
business_metrics = Counter(
    "business_metrics_total",
    "Business operation counts",
    ["operation"],  # register, login, project_create, translation_page
)

# Export task metrics
export_metrics = Counter(
    "export_requests_total",
    "Export operation counts",
    ["format", "type"],  # format: png/cbz/pdf; type: single/batch
)


def setup_instrumentation(
    app: FastAPI,
    service_name: str,
    include_default_metrics: bool = True,
) -> Instrumentator:
    """
    Set up Prometheus instrumentation for a FastAPI application.

    Args:
        app: FastAPI application instance
        service_name: Name of the microservice (for labels)
        include_default_metrics: Whether to include default HTTP metrics

    Returns:
        Instrumentator instance for further customization
    """
    instrumentator = Instrumentator(
        should_group_status_codes=True,
        should_ignore_untemplated=True,
        should_respect_env_var=True,
        should_instrument_requests_inprogress=True,
        excluded_handlers=["/metrics", "/health", "/health/ready", "/docs", "/openapi.json"],
        env_var_name="ENABLE_METRICS",
        inprogress_name="http_requests_inprogress",
        inprogress_labels=True,
    )

    if include_default_metrics:
        instrumentator.add(metrics.request_size(
            should_include_handler=True,
            metric_name="http_request_size_bytes",
        ))
        instrumentator.add(metrics.response_size(
            should_include_handler=True,
            metric_name="http_response_size_bytes",
        ))

    # Add service name label to all default metrics
    instrumentator.add(
        lambda info: info.metric(
            name="http_requests_total_by_service",
            description="Total HTTP requests by service",
        ).add_extra_labels({"service": service_name})
    )

    # Instrument the app and expose /metrics
    instrumentator.instrument(app).expose(
        app,
        endpoint="/metrics",
        include_in_schema=True,
        tags=["Monitoring"],
    )

    return instrumentator


def get_metrics_bytes() -> bytes:
    """Get all metrics as Prometheus text format bytes."""
    return generate_latest(REGISTRY)
