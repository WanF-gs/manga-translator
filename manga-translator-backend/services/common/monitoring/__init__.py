from __future__ import annotations
"""
Common monitoring utilities for all microservices.
Provides unified Prometheus instrumentation and JSON logging setup.
"""
import logging

_logger = logging.getLogger(__name__)

try:
    from .instrumentator import setup_instrumentation
except TypeError as e:
    # Python 3.8 compatibility: prometheus_fastapi_instrumentator uses list[str] syntax
    _logger.warning(f"Instrumentation disabled (Python version compatibility): {e}")
    def setup_instrumentation(app=None, service_name="unknown"):
        """No-op instrumentation placeholder."""
        pass

from .logging import setup_json_logging

__all__ = ["setup_instrumentation", "setup_json_logging"]
