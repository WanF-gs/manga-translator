from __future__ import annotations
"""
JSON-structured logging configuration for Loki log aggregation.
"""
import logging
import sys
from datetime import datetime, timezone
from typing import Optional

try:
    from pythonjsonlogger import jsonlogger
    HAS_JSON_LOGGER = True
except ImportError:
    HAS_JSON_LOGGER = False


class CustomJsonFormatter(jsonlogger.JsonFormatter if HAS_JSON_LOGGER else logging.Formatter):
    """JSON log formatter with service-level context."""

    def __init__(self, service_name: str):
        if HAS_JSON_LOGGER:
            super().__init__(
                fmt="%(timestamp)s %(level)s %(service)s %(message)s",
                datefmt="%Y-%m-%dT%H:%M:%S",
                json_ensure_ascii=False,
            )
        else:
            super().__init__(
                fmt='{"timestamp":"%(asctime)s","level":"%(levelname)s","service":"%(service)s","message":"%(message)s"}',
                datefmt="%Y-%m-%dT%H:%M:%S",
            )
        self.service_name = service_name

    def add_fields(self, log_record, record, message_dict):
        super(CustomJsonFormatter, self).add_fields(log_record, record, message_dict)
        log_record["timestamp"] = datetime.now(timezone.utc).isoformat()
        log_record["service"] = self.service_name
        if hasattr(record, "request_id") and record.request_id:
            log_record["request_id"] = record.request_id
        if record.exc_info and record.exc_info[0]:
            log_record["exception"] = self.formatException(record.exc_info)


def setup_json_logging(
    service_name: str,
    log_level: str = "INFO",
) -> logging.Logger:
    """
    Configure JSON-structured logging for a service.

    Args:
        service_name: Name of the microservice
        log_level: Logging level (DEBUG, INFO, WARNING, ERROR)

    Returns:
        Configured root logger
    """
    logger = logging.getLogger()
    logger.setLevel(getattr(logging, log_level.upper(), logging.INFO))

    # Remove existing handlers
    for handler in logger.handlers[:]:
        logger.removeHandler(handler)

    # Console handler with JSON format
    handler = logging.StreamHandler(sys.stdout)
    formatter = CustomJsonFormatter(service_name)
    handler.setFormatter(formatter)
    logger.addHandler(handler)

    # Ensure uvicorn access logs are also JSON-formatted
    uvicorn_logger = logging.getLogger("uvicorn.access")
    uvicorn_logger.handlers.clear()
    uvicorn_logger.addHandler(handler)
    uvicorn_logger.propagate = False

    uvicorn_error_logger = logging.getLogger("uvicorn.error")
    uvicorn_error_logger.handlers.clear()
    uvicorn_error_logger.addHandler(handler)
    uvicorn_error_logger.propagate = False

    # FastAPI/Starlette logging
    for log_name in ["fastapi", "starlette"]:
        mod_logger = logging.getLogger(log_name)
        mod_logger.handlers.clear()
        mod_logger.addHandler(handler)

    logger.info("JSON logging initialized", extra={"service": service_name})
    return logger
