from __future__ import annotations
"""
gRPC 客户端基类
"""
from typing import Optional, Dict, Any
import grpc


class GRPCClient:
    """gRPC 客户端基类"""

    def __init__(self, host: str, port: int, service_name: str = ""):
        self.host = host
        self.port = port
        self.service_name = service_name
        self.channel: Optional[grpc.aio.Channel] = None

    async def connect(self):
        """建立 gRPC 连接"""
        target = f"{self.host}:{self.port}"
        self.channel = grpc.aio.insecure_channel(
            target,
            options=[
                ("grpc.max_send_message_length", 100 * 1024 * 1024),  # 100MB
                ("grpc.max_receive_message_length", 100 * 1024 * 1024),
                ("grpc.keepalive_time_ms", 30000),
                ("grpc.keepalive_timeout_ms", 10000),
            ],
        )
        return self.channel

    async def close(self):
        """关闭连接"""
        if self.channel:
            await self.channel.close()
            self.channel = None

    async def __aenter__(self):
        await self.connect()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.close()


class ServiceRegistry:
    """
    服务注册中心 - 管理所有 gRPC 服务端点地址。
    从环境变量或配置加载。
    """

    def __init__(self):
        import sys
        import os
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

        # 使用 HTTP 地址作为 gRPC 地址的后备
        self._services: Dict[str, Dict[str, Any]] = {
            "user_service":       {"host": "user-service",       "http_port": 8001, "grpc_port": 9001},
            "project_service":    {"host": "project-service",    "http_port": 8002, "grpc_port": 9002},
            "translation_service": {"host": "translation-service", "http_port": 8003, "grpc_port": 9003},
            "image_service":      {"host": "image-service",      "http_port": 8004, "grpc_port": 9004},
            "export_service":     {"host": "export-service",     "http_port": 8005, "grpc_port": 9005},
            "reader_service":     {"host": "reader-service",     "http_port": 8006, "grpc_port": 9006},
            "detector_service":   {"host": "detector-service",   "http_port": 0,    "grpc_port": 9101},
            "ocr_service":        {"host": "ocr-service",        "http_port": 0,    "grpc_port": 9102},
            "llm_service":        {"host": "llm-service",        "http_port": 0,    "grpc_port": 9103},
            "inpaint_ai_service": {"host": "inpaint-service",    "http_port": 0,    "grpc_port": 9104},
        }

    def get_grpc_address(self, service_name: str) -> Optional[Dict[str, Any]]:
        """获取 gRPC 服务地址"""
        svc = self._services.get(service_name)
        if not svc:
            return None
        return {"host": svc["host"], "port": svc["grpc_port"]}

    def get_http_address(self, service_name: str) -> Optional[Dict[str, Any]]:
        """获取 HTTP 服务地址"""
        svc = self._services.get(service_name)
        if not svc:
            return None
        return {"host": svc["host"], "port": svc["http_port"]}


# 全局服务注册中心
service_registry = ServiceRegistry()
