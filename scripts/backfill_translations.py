#!/usr/bin/env python3
"""
Backfill vocabulary definitions using Jisho dictionary API.
Fixes previous bad data where whole-sentence translations were stored as word definitions.

Usage (from WSL2):
    cd /mnt/c/Users/WanFi/Desktop/大三实训/demo_04/manga-translator-backend
    DATABASE_URL=postgresql+asyncpg://manga_user:manga_pass@localhost:5433/manga_translator PYTHONPATH=. python3 ../scripts/backfill_translations.py
"""
import asyncio
import sys
import os

backend_path = os.path.dirname(os.path.abspath(__file__))
backend_path = os.path.join(os.path.dirname(backend_path), "manga-translator-backend")
sys.path.insert(0, backend_path)

from sqlalchemy import select
from services.common.core.database import AsyncSessionLocal
from services.common.models.vocabulary import Vocabulary

import logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def main():
    async with AsyncSessionLocal() as db:
        # Get all Japanese vocabulary
        vocab_list = (await db.execute(
            select(Vocabulary).where(Vocabulary.language == 'ja')
        )).scalars().all()

        if not vocab_list:
            logger.info("No Japanese vocabulary found")
            return

        logger.info(f"Found {len(vocab_list)} Japanese vocab to fix")

        # Batch lookup dictionary definitions
        words = [v.word for v in vocab_list]
        try:
            from services.common.utils.dictionary_service import batch_lookup_japanese
            dict_results = await batch_lookup_japanese(words, max_concurrent=20)
        except Exception as e:
            logger.error(f"Dictionary lookup failed: {e}")
            return

        updated = 0
        skipped = 0
        failed = 0

        for vocab in vocab_list:
            dict_entry = dict_results.get(vocab.word)
            if dict_entry:
                reading = dict_entry.get("reading", "")
                defs = dict_entry.get("definitions", [])
                translation = "; ".join(defs[:2]) if defs else ""
                pos = dict_entry.get("part_of_speech", "")[:50]  # truncate to fit DB schema
                
                # Build definition: reading + translation
                if reading and reading != vocab.word:
                    definition = f"{reading}\n{translation}" if translation else vocab.word
                else:
                    definition = f"{vocab.word}\n{translation}" if translation else vocab.word
                
                vocab.definition = definition
                vocab.part_of_speech = pos
                updated += 1
                if updated % 50 == 0:
                    logger.info(f"Progress: {updated}/{len(vocab_list)} updated...")
            else:
                # No dictionary entry - keep original but mark
                skipped += 1

        await db.commit()
        logger.info(f"Done: {updated} vocab updated with dictionary definitions, {skipped} skipped (no dict entry)")


if __name__ == "__main__":
    asyncio.run(main())
