from __future__ import annotations
"""
Translation memory service - cache and similarity matching.
"""
import hashlib
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from common.models.translation_cache import TranslationCache
from ..repository.memory_repo import MemoryRepository


class MemoryService:
    """Translation memory with two-level caching (Redis + PostgreSQL)."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.repo = MemoryRepository(db)

    async def list_memory(
        self,
        user_id: str,
        page: int = 1,
        page_size: int = 20,
        keyword: str = None,
        source_lang: str = None,
        target_lang: str = None,
    ):
        """B7 FIX: List translation memory entries."""
        from sqlalchemy import select, func
        from common.models.translation_cache import TranslationCache
        
        query = select(TranslationCache)
        if keyword:
            query = query.where(
                TranslationCache.source_text.ilike(f"%{keyword}%") |
                TranslationCache.translated_text.ilike(f"%{keyword}%")
            )
        if source_lang:
            query = query.where(TranslationCache.source_lang == source_lang)
        if target_lang:
            query = query.where(TranslationCache.target_lang == target_lang)
        
        count_q = select(func.count()).select_from(query.subquery())
        total = (await self.db.execute(count_q)).scalar() or 0
        query = query.offset((page - 1) * page_size).limit(page_size)
        rows = (await self.db.execute(query)).scalars().all()
        
        items = []
        for r in rows:
            items.append({
                "id": str(r.id) if hasattr(r, 'id') else None,
                "source_text": r.source_text,
                "translated_text": r.translated_text,
                "source_lang": r.source_lang,
                "target_lang": r.target_lang,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            })
        return items, total

    def _compute_hash(self, text: str) -> str:
        """Compute a similarity hash for a text."""
        # Simple character n-gram hash for MVP
        normalized = text.strip().lower()
        return hashlib.sha256(normalized.encode()).hexdigest()

    async def find_cache(
        self,
        project_id: str,
        source_text: str,
        source_lang: str,
        target_lang: str,
    ) -> Optional[str]:
        """Find cached translation by exact text match."""
        cache = await self.repo.find_exact_match(
            project_id=project_id,
            source_text=source_text,
            source_lang=source_lang,
            target_lang=target_lang,
        )
        if cache:
            # Update hit count
            cache.hit_count += 1
            await self.db.flush()
            return cache.translated_text
        return None

    async def store_cache(
        self,
        project_id: str,
        source_text: str,
        translated_text: str,
        source_lang: str,
        target_lang: str,
    ) -> None:
        """Store a translation in the cache — with dedup to prevent duplicate rows."""
        # P1 FIX: validate translation quality before caching
        # Reject obviously bad translations (only punctuation, empty, etc.)
        if not translated_text or not translated_text.strip():
            return
        # Reject translations that consist only of punctuation/symbols
        # (e.g., "。。", "。。。", "！？", etc.) — these are LLM failures
        import re
        has_content = re.search(r'[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff'
                                r'\uac00-\ud7af\u0020-\u007e\u0100-\u024f'
                                r'\u0400-\u04ff\u0e00-\u0e7f\u1e00-\u1eff'
                                r'\u2000-\u206f]', translated_text)
        if not has_content:
            # Translation is only punctuation/symbols/whitespace — reject
            import logging
            logging.getLogger(__name__).warning(
                f"Rejecting low-quality cache: '{source_text[:40]}' → '{translated_text[:40]}'"
            )
            return

        # P1 FIX: check for existing cache entry before inserting
        existing = await self.repo.find_exact_match(
            project_id=project_id,
            source_text=source_text,
            source_lang=source_lang,
            target_lang=target_lang,
        )
        if existing:
            existing.translated_text = translated_text
            existing.hit_count = (existing.hit_count or 1) + 1
            await self.db.flush()
            return

        similarity_hash = self._compute_hash(source_text)
        cache = TranslationCache(
            project_id=project_id,
            source_text=source_text,
            translated_text=translated_text,
            source_lang=source_lang,
            target_lang=target_lang,
            similarity_hash=similarity_hash,
            hit_count=1,
        )
        self.db.add(cache)
        await self.db.flush()
