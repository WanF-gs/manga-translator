from __future__ import annotations
"""
Translation Cache Semantic Enhancement — PRD v3.0 §3.1.
Adds embedding-based semantic similarity search on top of exact hash matching.
Uses cosine similarity on text embeddings to find near-match translations.
"""
import logging
import hashlib
import json
from typing import Optional, List, Tuple
from dataclasses import dataclass

import redis.asyncio as aioredis

logger = logging.getLogger(__name__)


@dataclass
class SemanticMatch:
    cache_id: str
    source_text: str
    translated_text: str
    similarity: float  # 0-1 cosine similarity
    hit_count: int


class SemanticCache:
    """
    Semantic-enhanced translation cache.
    
    Two-tier lookup:
    1. Exact hash match (SHA256) — O(1), instant
    2. Semantic similarity (embedding cosine) — O(n*log n), fallback
    """

    def __init__(self, redis_url: str, embedding_dim: int = 384, similarity_threshold: float = 0.85):
        self.redis_url = redis_url
        self.embedding_dim = embedding_dim
        self.similarity_threshold = similarity_threshold
        self._redis: Optional[aioredis.Redis] = None
        self._initialized = False

    async def init(self):
        """Initialize Redis connection."""
        if not self._initialized:
            self._redis = await aioredis.from_url(
                self.redis_url, encoding="utf-8", decode_responses=True
            )
            self._initialized = True

    @staticmethod
    def exact_hash(text: str, source_lang: str, target_lang: str) -> str:
        """SHA256 hash for exact match lookup."""
        content = f"{text.strip().lower()}|{source_lang}|{target_lang}"
        return hashlib.sha256(content.encode()).hexdigest()

    @staticmethod
    def simple_embed(text: str) -> List[float]:
        """
        Simple character n-gram based embedding (no external model needed).
        For production, replace with sentence-transformers or OpenAI embeddings.
        """
        text = text.strip().lower()
        if not text:
            return [0.0] * 384

        # Character n-gram hashing to fixed-dimension vector
        dim = 384
        vec = [0.0] * dim
        for n in range(1, 4):  # 1-3 grams
            for i in range(len(text) - n + 1):
                ngram = text[i:i + n]
                idx = hash(ngram) % dim
                vec[idx] += 1.0 / (n * (len(text) - n + 1) or 1)

        # Normalize
        norm = sum(v * v for v in vec) ** 0.5
        if norm > 0:
            vec = [v / norm for v in vec]
        return vec

    @staticmethod
    def cosine_similarity(v1: List[float], v2: List[float]) -> float:
        """Cosine similarity between two vectors."""
        if len(v1) != len(v2):
            return 0.0
        dot = sum(a * b for a, b in zip(v1, v2))
        norm1 = sum(a * a for a in v1) ** 0.5
        norm2 = sum(b * b for b in v2) ** 0.5
        if norm1 == 0 or norm2 == 0:
            return 0.0
        return dot / (norm1 * norm2)

    async def find(
        self,
        source_text: str,
        source_lang: str,
        target_lang: str,
    ) -> Optional[SemanticMatch]:
        """
        Find best translation match.
        
        Tier 1: Exact hash match
        Tier 2: Semantic similarity search
        """
        await self.init()

        # Tier 1: Exact match
        h = self.exact_hash(source_text, source_lang, target_lang)
        cached = await self._redis.hgetall(f"cache:exact:{h}")

        if cached:
            return SemanticMatch(
                cache_id=h,
                source_text=cached.get("source", ""),
                translated_text=cached.get("translated", ""),
                similarity=1.0,
                hit_count=int(cached.get("hits", "1")),
            )

        # Tier 2: Semantic search
        query_emb = self.simple_embed(source_text)
        prefix_key = f"cache:semantic:{source_lang}:{target_lang}"

        # Scan for semantic entries in the same language pair
        cursor = 0
        best_match: Optional[SemanticMatch] = None

        while True:
            cursor, keys = await self._redis.scan(cursor, match=f"{prefix_key}:*", count=50)
            for key in keys:
                data = await self._redis.hgetall(key)
                stored_emb = json.loads(data.get("embedding", "[]"))
                if not stored_emb:
                    continue

                sim = self.cosine_similarity(query_emb, stored_emb)
                if sim >= self.similarity_threshold:
                    if best_match is None or sim > best_match.similarity:
                        best_match = SemanticMatch(
                            cache_id=data.get("cache_id", key),
                            source_text=data.get("source", ""),
                            translated_text=data.get("translated", ""),
                            similarity=sim,
                            hit_count=int(data.get("hits", "1")),
                        )

            if cursor == 0:
                break

        if best_match:
            # Increment hit count for the matched entry
            entry_key = f"cache:semantic:{source_lang}:{target_lang}:{best_match.cache_id}"
            await self._redis.hincrby(entry_key, "hits", 1)
            return best_match

        return None

    async def store(
        self,
        source_text: str,
        translated_text: str,
        source_lang: str,
        target_lang: str,
        metadata: Optional[dict] = None,
    ):
        """Store translation in both exact and semantic caches."""
        await self.init()

        cache_id = hashlib.sha256(
            f"{source_text}|{translated_text}|{source_lang}|{target_lang}".encode()
        ).hexdigest()[:16]

        # Exact cache (7 day TTL)
        h = self.exact_hash(source_text, source_lang, target_lang)
        exact_data = {
            "source": source_text,
            "translated": translated_text,
            "cache_id": cache_id,
            "hits": "0",
            "created": str(int(__import__('time').time())),
        }
        if metadata:
            exact_data.update({f"meta:{k}": str(v) for k, v in metadata.items()})

        await self._redis.hset(f"cache:exact:{h}", mapping=exact_data)
        await self._redis.expire(f"cache:exact:{h}", 7 * 24 * 3600)

        # Semantic cache (30 day TTL)
        embedding = self.simple_embed(source_text)
        semantic_data = {
            "source": source_text,
            "translated": translated_text,
            "cache_id": cache_id,
            "hits": "0",
            "embedding": json.dumps(embedding),
        }
        sem_key = f"cache:semantic:{source_lang}:{target_lang}:{cache_id}"
        await self._redis.hset(sem_key, mapping=semantic_data)
        await self._redis.expire(sem_key, 30 * 24 * 3600)

    async def warmup(self, entries: List[Tuple[str, str, str, str]]):
        """
        Batch warmup the semantic cache.
        entries: List of (source_text, translated_text, source_lang, target_lang)
        """
        for entry in entries:
            await self.store(*entry)

    async def stats(self) -> dict:
        """Get cache statistics."""
        await self.init()
        import time
        
        exact_count = 0
        semantic_count = 0
        
        cursor = 0
        while True:
            cursor, keys = await self._redis.scan(cursor, match="cache:exact:*", count=100)
            exact_count += len(keys)
            if cursor == 0:
                break
        
        cursor = 0
        while True:
            cursor, keys = await self._redis.scan(cursor, match="cache:semantic:*", count=100)
            semantic_count += len(keys)
            if cursor == 0:
                break

        return {
            "exact_entries": exact_count,
            "semantic_entries": semantic_count,
            "similarity_threshold": self.similarity_threshold,
            "embedding_dim": self.embedding_dim,
        }
