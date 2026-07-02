from __future__ import annotations
"""
Redis client initialization and helpers.
"""
import redis.asyncio as aioredis

from .config import settings

redis_client = aioredis.from_url(
    settings.REDIS_URL,
    encoding="utf-8",
    decode_responses=True,
)


async def get_redis():
    """Dependency: get Redis client."""
    return redis_client
