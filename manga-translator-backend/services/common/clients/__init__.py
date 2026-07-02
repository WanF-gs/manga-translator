from __future__ import annotations
"""gRPC 客户端包"""
from .grpc_client import GRPCClient, ServiceRegistry, service_registry
from .ai_service import AIServiceClient, ai_client

__all__ = [
    "GRPCClient",
    "ServiceRegistry",
    "service_registry",
    "AIServiceClient",
    "ai_client",
]
