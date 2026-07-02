from __future__ import annotations
"""
Translation memory repository.
"""
from typing import Optional

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from common.models.translation_cache import TranslationCache


class MemoryRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def find_exact_match(
        self,
        project_id: str,
        source_text: str,
        source_lang: str,
        target_lang: str,
    ) -> Optional[TranslationCache]:
        """Find exact text match in cache."""
        result = await self.db.execute(
            select(TranslationCache).where(
                and_(
                    TranslationCache.project_id == project_id,
                    TranslationCache.source_text == source_text,
                    TranslationCache.source_lang == source_lang,
                    TranslationCache.target_lang == target_lang,
                )
            )
        )
        # P1 FIX: use .first() instead of .scalar_one_or_none() to tolerate duplicate cache rows
        return result.scalars().first()
