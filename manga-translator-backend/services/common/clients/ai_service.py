from __future__ import annotations
"""
AI 模型服务 HTTP 客户端 — 带重试、熔断、缓存。
"""
import time
import hashlib
import json
import logging
from typing import Dict, Any, Optional, List
from collections import OrderedDict
from dataclasses import dataclass, field

import httpx

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from common.core.config import settings

logger = logging.getLogger(__name__)


@dataclass
class CircuitBreaker:
    """Circuit breaker pattern implementation."""
    failure_threshold: int = 5
    recovery_timeout: float = 30.0  # seconds
    half_open_max_requests: int = 1
    
    failure_count: int = 0
    last_failure_time: float = 0.0
    state: str = "closed"  # closed, open, half_open
    half_open_requests: int = 0
    
    def record_success(self):
        """Record a successful call."""
        if self.state == "half_open":
            self.state = "closed"
        self.failure_count = 0
        self.half_open_requests = 0
    
    def record_failure(self):
        """Record a failed call."""
        self.failure_count += 1
        self.last_failure_time = time.time()
        
        if self.state == "half_open":
            self.state = "open"
        elif self.failure_count >= self.failure_threshold:
            self.state = "open"
    
    def allow_request(self) -> bool:
        """Check if a request should be allowed."""
        if self.state == "closed":
            return True
        
        if self.state == "open":
            # Check if recovery timeout has passed
            if time.time() - self.last_failure_time >= self.recovery_timeout:
                self.state = "half_open"
                self.half_open_requests = 0
                return True
            return False
        
        if self.state == "half_open":
            if self.half_open_requests < self.half_open_max_requests:
                self.half_open_requests += 1
                return True
            return False
        
        return True


class LRUCache:
    """Simple LRU cache with TTL."""
    
    def __init__(self, max_size: int = 200, ttl: float = 300.0):
        self.max_size = max_size
        self.ttl = ttl
        self._cache: OrderedDict = OrderedDict()
    
    def _make_key(self, *args, **kwargs) -> str:
        """Generate cache key from arguments."""
        raw = json.dumps({"args": args, "kwargs": kwargs}, sort_keys=True, default=str)
        return hashlib.md5(raw.encode()).hexdigest()
    
    def get(self, *args, **kwargs) -> Optional[Any]:
        """Get cached value if not expired."""
        key = self._make_key(*args, **kwargs)
        if key not in self._cache:
            return None
        
        value, timestamp = self._cache[key]
        if time.time() - timestamp > self.ttl:
            del self._cache[key]
            return None
        
        # Move to end (most recently used)
        self._cache.move_to_end(key)
        return value
    
    def set(self, value: Any, *args, **kwargs):
        """Set cache value."""
        key = self._make_key(*args, **kwargs)
        
        # Evict oldest if full
        while len(self._cache) >= self.max_size:
            self._cache.popitem(last=False)
        
        self._cache[key] = (value, time.time())
        self._cache.move_to_end(key)
    
    def clear(self):
        """Clear all cache entries."""
        self._cache.clear()


class AIServiceClient:
    """AI 模型服务 HTTP 客户端 — 带重试、熔断、连接池、缓存。"""

    MAX_RETRIES = 3
    RETRY_BACKOFF_BASE = 1.0  # 1s → 2s → 4s
    
    def __init__(self, base_url: Optional[str] = None, timeout: float = 600.0):
        self.base_url = base_url or getattr(settings, "AI_SERVICE_BASE_URL", "http://ai-services")
        self.timeout = timeout
        self._client: Optional[httpx.AsyncClient] = None
        self._circuit_breaker = CircuitBreaker()
        self._cache = LRUCache(max_size=200, ttl=300.0)
    
    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create HTTP client with connection pooling."""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=self.timeout,
                limits=httpx.Limits(
                    max_keepalive_connections=20,
                    max_connections=50,
                    keepalive_expiry=30.0,
                ),
                transport=httpx.AsyncHTTPTransport(retries=1),
            )
        return self._client
    
    async def close(self):
        """Close the HTTP client."""
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None
    
    async def _call(
        self,
        endpoint: str,
        method: str = "POST",
        json_data: Optional[Dict] = None,
        files: Optional[Dict] = None,
        use_cache: bool = False,
    ) -> Dict[str, Any]:
        """统一请求方法 — 带重试和熔断。"""
        # Check circuit breaker
        if not self._circuit_breaker.allow_request():
            logger.warning(f"Circuit breaker OPEN for {endpoint}, returning fallback")
            return {"status": "unavailable", "error": "Circuit breaker open", "circuit_open": True}
        
        # Check cache
        if use_cache and json_data:
            cache_key_data = json.dumps(json_data, sort_keys=True)
            cached = self._cache.get(endpoint, method, cache_key_data)
            if cached is not None:
                return cached
        
        last_exception = None
        
        for attempt in range(self.MAX_RETRIES):
            try:
                client = await self._get_client()
                url = f"{self.base_url}{endpoint}"
                
                if files:
                    response = await client.request(method, url, files=files)
                else:
                    response = await client.request(method, url, json=json_data)
                
                response.raise_for_status()
                result = response.json()
                
                # Record success
                self._circuit_breaker.record_success()
                
                # Cache successful result
                if use_cache and json_data:
                    cache_key_data = json.dumps(json_data, sort_keys=True)
                    self._cache.set(result, endpoint, method, cache_key_data)
                
                return result
                
            except httpx.HTTPStatusError as e:
                status = e.response.status_code
                last_exception = e
                
                if status in (429, 503):  # Rate limit or server error — retry
                    if attempt < self.MAX_RETRIES - 1:
                        wait = self.RETRY_BACKOFF_BASE * (2 ** attempt)
                        logger.warning(f"HTTP {status} for {endpoint}, retrying in {wait}s (attempt {attempt + 1}/{self.MAX_RETRIES})")
                        time.sleep(wait)
                        continue
                    else:
                        self._circuit_breaker.record_failure()
                
                elif status >= 500:
                    if attempt < self.MAX_RETRIES - 1:
                        wait = self.RETRY_BACKOFF_BASE * (2 ** attempt)
                        logger.warning(f"Server error {status} for {endpoint}, retrying in {wait}s")
                        time.sleep(wait)
                        continue
                    else:
                        self._circuit_breaker.record_failure()
                else:
                    # Client error — don't retry
                    self._circuit_breaker.record_failure()
                    break
                    
            except (httpx.TimeoutException, httpx.ConnectError, httpx.RemoteProtocolError) as e:
                last_exception = e
                if attempt < self.MAX_RETRIES - 1:
                    wait = self.RETRY_BACKOFF_BASE * (2 ** attempt)
                    logger.warning(f"Connection error for {endpoint}, retrying in {wait}s: {e}")
                    time.sleep(wait)
                    continue
                else:
                    self._circuit_breaker.record_failure()
            
            except Exception as e:
                last_exception = e
                self._circuit_breaker.record_failure()
                break
        
        logger.error(f"All retries exhausted for {endpoint}: {last_exception}")
        return {"status": "error", "error": str(last_exception) if last_exception else "Unknown error"}

    async def detect_text_regions(self, image_url: str, language: str = "ja") -> Dict[str, Any]:
        """文字区域检测 — P0 FIX: 禁用缓存，每次检测都使用最新图片"""
        return await self._call(
            "/detector/detect",
            json_data={"image_url": image_url, "language": language},
            use_cache=False,  # P0: 图片内容可能变化，不能缓存检测结果
        )

    async def ocr_recognize(self, image_url: str, regions: List[Dict], lang: str = "ja") -> Dict[str, Any]:
        """OCR 识别"""
        return await self._call(
            "/ocr/recognize",
            json_data={
                "image_url": image_url,
                "regions": regions,
                "lang": lang,
            },
        )

    async def translate_with_llm(
        self, text: str, source_lang: str, target_lang: str,
        context: Optional[str] = None, tone: str = "neutral",
    ) -> Dict[str, Any]:
        """LLM 翻译"""
        return await self._call(
            "/llm/translate",
            json_data={
                "text": text,
                "source_lang": source_lang,
                "target_lang": target_lang,
                "context": context,
                "tone": tone,
            },
            use_cache=True,
        )

    async def inpaint_image(self, image_url: str, masks: List[Dict], method: str = "lama", bubble_erase: bool = False) -> Dict[str, Any]:
        """图像修复"""
        return await self._call(
            "/inpaint/inpaint",
            json_data={
                "image_url": image_url,
                "masks": masks,
                "method": method,
                "bubble_erase": bubble_erase,
            },
        )

    async def render_image(
        self,
        image_base64: str,
        text_regions: List[Dict],
        auto_resize: bool = True,
        output_format: str = "png",
    ) -> Dict[str, Any]:
        """文字渲染回填"""
        return await self._call(
            "/render/render",
            json_data={
                "image_base64": image_base64,
                "text_regions": text_regions,
                "auto_resize": auto_resize,
                "output_format": output_format,
            },
        )

    async def health_check(self) -> Dict[str, Any]:
        """AI 服务健康检查"""
        try:
            client = await self._get_client()
            response = await client.get(f"{self.base_url}/health")
            return response.json()
        except Exception:
            return {"status": "unavailable"}

    @property
    def circuit_state(self) -> str:
        """Get current circuit breaker state."""
        return self._circuit_breaker.state


# 全局 AI 服务客户端实例
ai_client = AIServiceClient()
