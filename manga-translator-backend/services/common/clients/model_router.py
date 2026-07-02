from __future__ import annotations
"""
GPU Priority Queue & Model Router — PRD v3.0 §4.2 GPU Computing Enhancement.
Manages GPU task priority scheduling and multi-model routing for AI inference.
Works with NVIDIA GPU via CUDA or CPU fallback with priority tiers.
"""
import logging
import asyncio
from enum import Enum
from typing import Optional, Dict, Any, Callable, Awaitable
from dataclasses import dataclass, field
from collections import defaultdict
import time
import threading

logger = logging.getLogger(__name__)

# ===== Priority Tiers =====
class TaskPriority(str, Enum):
    HIGH = "high"       # Real-time user requests (UI blocking)
    NORMAL = "normal"   # Standard batch processing
    LOW = "low"         # Background / precompute / warmup


# ===== Model Registry =====
class ModelType(str, Enum):
    DETECTION = "detection"     # Text region detection
    OCR = "ocr"                 # Optical character recognition
    INPAINT = "inpaint"        # Image inpainting
    TRANSLATE = "translate"    # Neural translation
    RENDER = "render"          # Text rendering
    TTS = "tts"                # Text-to-speech
    DYNAMIC = "dynamic_manga"  # Dynamic manga generation


# ===== GPU/CPU Route =====
class Runtime(str, Enum):
    GPU_CUDA = "cuda"
    GPU_MPS = "mps"       # Apple Silicon
    CPU_ONNX = "cpu"
    CPU_FALLBACK = "cpu_fallback"


# ===== Model Route Entry =====
@dataclass
class ModelRoute:
    model_type: ModelType
    name: str
    runtime: Runtime
    priority: int  # 0=primary, 1=fallback, 2=last_resort
    device_id: int = 0
    batch_size: int = 1
    warm: bool = False
    avg_latency_ms: float = 0.0
    total_requests: int = 0
    error_count: int = 0


# ===== Priority Queue =====
@dataclass(order=True)
class QueuedTask:
    priority: int
    created_at: float = field(compare=False)
    task_id: str = field(compare=False)
    model_type: ModelType = field(compare=False)
    payload: Dict[str, Any] = field(compare=False)
    future: Any = field(compare=False, default=None)


class ModelRouter:
    """
    Multi-model routing with priority queue and GPU/CPU fallback.

    Usage:
        router = ModelRouter()
        router.register_route(ModelRoute(...))
        result = await router.route(ModelType.DETECTION, payload={"image": ...})
    """

    def __init__(self, max_concurrent: int = 4):
        self._routes: Dict[ModelType, list[ModelRoute]] = defaultdict(list)
        self._gpu_available = self._detect_gpu()
        self._max_concurrent = max_concurrent
        self._semaphore = asyncio.Semaphore(max_concurrent)
        self._lock = threading.Lock()
        self._queue: list[QueuedTask] = []
        self._stats: Dict[str, int] = defaultdict(int)

    @staticmethod
    def _detect_gpu() -> bool:
        """Detect NVIDIA GPU availability."""
        try:
            import subprocess
            result = subprocess.run(
                ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
                capture_output=True, text=True, timeout=5
            )
            if result.returncode == 0 and result.stdout.strip():
                logger.info(f"GPU detected: {result.stdout.strip()}")
                return True
        except Exception:
            pass

        # Check for MPS (Apple Silicon)
        try:
            import torch
            if torch.backends.mps.is_available():
                logger.info("Apple MPS detected")
                return True
        except ImportError:
            pass

        logger.info("No GPU detected, using CPU mode")
        return False

    def register_route(self, route: ModelRoute):
        """Register a model route with priority."""
        self._routes[route.model_type].append(route)
        self._routes[route.model_type].sort(key=lambda r: r.priority)
        logger.info(f"Registered route: {route.model_type.value}/{route.name} [{route.runtime.value}] p{route.priority}")

    def get_best_route(self, model_type: ModelType) -> Optional[ModelRoute]:
        """Get the best available route for a model type."""
        routes = self._routes.get(model_type, [])
        if not routes:
            return None

        # Filter by GPU availability
        available = [
            r for r in routes
            if r.runtime in (Runtime.GPU_CUDA, Runtime.GPU_MPS) and self._gpu_available
        ]
        if not available:
            available = [r for r in routes if r.runtime == Runtime.CPU_ONNX]
        if not available:
            available = [r for r in routes if r.runtime == Runtime.CPU_FALLBACK]
        if not available:
            available = routes

        # Return the highest priority (lowest priority number) with fewest errors
        return min(available, key=lambda r: (r.priority, r.error_count / max(r.total_requests + 1, 1)))

    async def route(
        self,
        model_type: ModelType,
        payload: Dict[str, Any],
        priority: TaskPriority = TaskPriority.NORMAL,
        runner: Optional[Callable[[ModelRoute, Dict[str, Any]], Awaitable[Any]]] = None,
    ) -> Any:
        """
        Route a task to the best model, handling GPU/CPU fallback.

        Args:
            model_type: Type of model to use
            payload: Input data for the model
            priority: Task priority
            runner: Optional custom runner function; if None, resolution is deferred
        """
        route = self.get_best_route(model_type)
        if not route:
            raise ValueError(f"No route available for model type: {model_type}")

        # Priority-based queueing
        priority_map = {TaskPriority.HIGH: 0, TaskPriority.NORMAL: 1, TaskPriority.LOW: 2}
        task = QueuedTask(
            priority=priority_map.get(priority, 1),
            created_at=time.time(),
            task_id=f"{model_type.value}_{int(time.time() * 1000)}",
            model_type=model_type,
            payload=payload,
        )

        async with self._semaphore:
            start = time.time()
            try:
                if runner:
                    result = await runner(route, payload)
                else:
                    result = {"status": "routed", "route": route.name, "runtime": route.runtime.value}

                route.total_requests += 1
                route.avg_latency_ms = (
                    route.avg_latency_ms * 0.9 + (time.time() - start) * 1000 * 0.1
                )
                self._stats[f"{model_type.value}_success"] += 1
                return result

            except Exception as e:
                route.error_count += 1
                self._stats[f"{model_type.value}_error"] += 1
                logger.error(f"Model route {route.name} failed: {e}")

                # Try next route
                fallback_routes = self._routes.get(model_type, [])[1:]
                for fb in fallback_routes:
                    if fb.name != route.name:
                        try:
                            if runner:
                                result = await runner(fb, payload)
                                fb.total_requests += 1
                                self._stats[f"{model_type.value}_fallback"] += 1
                                return result
                        except Exception as fb_e:
                            logger.error(f"Fallback route {fb.name} also failed: {fb_e}")
                            continue

                raise

    def get_stats(self) -> Dict[str, Any]:
        """Get router statistics including cost estimation (P1 GPU cost optimization)."""
        estimated_cost_per_model = {
            ModelType.DETECTION: 0.002,     # ~$0.002 per detection
            ModelType.OCR: 0.003,            # ~$0.003 per OCR
            ModelType.INPAINT: 0.015,        # ~$0.015 per inpaint (GPU-intensive)
            ModelType.TRANSLATE: 0.001,      # ~$0.001 per translation (API cost)
            ModelType.RENDER: 0.0005,        # ~$0.0005 per render (CPU)
            ModelType.TTS: 0.005,            # ~$0.005 per TTS call
            ModelType.DYNAMIC: 0.05,         # ~$0.05 per dynamic manga generation
        }

        routes_info = {}
        total_estimated_cost = 0.0
        for mt, routes in self._routes.items():
            routes_info[mt.value] = []
            for r in routes:
                reqs = r.total_requests
                cost = reqs * estimated_cost_per_model.get(mt, 0.001)
                total_estimated_cost += cost
                routes_info[mt.value].append({
                    "name": r.name,
                    "runtime": r.runtime.value,
                    "priority": r.priority,
                    "avg_latency_ms": round(r.avg_latency_ms, 2),
                    "total_requests": reqs,
                    "error_count": r.error_count,
                    "error_rate": round(r.error_count / max(reqs, 1), 4),
                    "estimated_cost": round(cost, 4),
                })

        return {
            "gpu_available": self._gpu_available,
            "max_concurrent": self._max_concurrent,
            "routes": routes_info,
            "stats": dict(self._stats),
            "total_estimated_cost": round(total_estimated_cost, 4),
            "cost_currency": "USD",
        }

    def get_cost_optimization_hint(self) -> Optional[str]:
        """Suggest cost optimization if GPU usage exceeds budget (P1 §2.21)."""
        stats = self.get_stats()
        total_cost = stats["total_estimated_cost"]
        gpu_routes = sum(
            r["total_requests"] for routes in stats["routes"].values()
            for r in routes if r["runtime"] in ("cuda", "mps")
        )
        cpu_routes = sum(
            r["total_requests"] for routes in stats["routes"].values()
            for r in routes if r["runtime"] in ("cpu", "cpu_fallback")
        )
        total = gpu_routes + cpu_routes
        gpu_ratio = gpu_routes / max(total, 1)

        if stats["gpu_available"] and gpu_ratio > 0.8:
            return f"GPU使用率 {gpu_ratio:.0%}，建议检查是否有可降级到 CPU 的任务以降低成本"
        if total_cost > 5.0:
            return f"累计预估成本 ${total_cost:.2f}，建议检查缓存命中率和翻译记忆复用"
        return None


# ===== Global Router Instance =====
model_router = ModelRouter(max_concurrent=4)

# Register default routes for all model types
_default_routes = [
    ModelRoute(ModelType.DETECTION, "cuda-detector", Runtime.GPU_CUDA, 0),
    ModelRoute(ModelType.DETECTION, "cpu-detector", Runtime.CPU_FALLBACK, 2),
    ModelRoute(ModelType.OCR, "tesseract-gpu", Runtime.GPU_CUDA, 0),
    ModelRoute(ModelType.OCR, "tesseract-cpu", Runtime.CPU_FALLBACK, 2),
    ModelRoute(ModelType.INPAINT, "cuda-inpaint", Runtime.GPU_CUDA, 0),
    ModelRoute(ModelType.INPAINT, "cpu-inpaint", Runtime.CPU_FALLBACK, 2),
    ModelRoute(ModelType.TRANSLATE, "api-translate", Runtime.CPU_FALLBACK, 0),
    ModelRoute(ModelType.RENDER, "cpu-render", Runtime.CPU_FALLBACK, 0),
    ModelRoute(ModelType.TTS, "api-tts", Runtime.CPU_FALLBACK, 0),
    ModelRoute(ModelType.DYNAMIC, "cpu-dynamic", Runtime.CPU_FALLBACK, 0),
]

for route in _default_routes:
    model_router.register_route(route)
