"""
Backfill vocabulary translations from existing text_regions data.

This script finds each vocabulary word in the user's text_regions,
then stores the corresponding translated_text as the translation in
vocabularies.definition (format: "word\ntranslation").

Usage:
    cd manga-translator-backend
    python ../scripts/backfill_vocabulary_translations.py
"""
import asyncio
import sys
import os

# Add backend to path
backend_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "manga-translator-backend")
sys.path.insert(0, backend_path)

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from services.common.core.database import async_session_factory
from services.common.models.vocabulary import Vocabulary
from services.common.models.text_region import TextRegion
from services.common.models.page import Page
from services.common.models.chapter import Chapter
from services.common.models.project import Project

import logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def backfill_one_user(db: AsyncSession, user_id: str):
    """Backfill translations for one user's vocabulary."""
    # Get all vocabulary without translations (definition = word)
    vocab_list = (await db.execute(
        select(Vocabulary).where(
            Vocabulary.user_id == user_id,
        )
    )).scalars().all()

    updated = 0
    skipped = 0

    for vocab in vocab_list:
        # Check if definition already has a translation
        definition = vocab.definition or ""
        if "\n" in definition:
            skipped += 1
            continue

        word = vocab.word

        # Find this word in the user's text_regions (via project)
        regions = (await db.execute(
            select(TextRegion).where(
                TextRegion.original_text.contains(word),
            )
        )).scalars().all()

        translation = None
        for region in regions:
            # Verify the region belongs to user's project
            page = (await db.execute(
                select(Page).where(Page.page_id == region.page_id)
            )).scalar_one_or_none()
            if not page:
                continue

            chapter = (await db.execute(
                select(Chapter).where(Chapter.chapter_id == page.chapter_id)
            )).scalar_one_or_none()
            if not chapter:
                continue

            project = (await db.execute(
                select(Project).where(
                    Project.project_id == chapter.project_id,
                    Project.user_id == user_id,
                )
            )).scalar_one_or_none()
            if not project:
                continue

            # Found a match - use the translated_text
            if region.translated_text:
                translation = region.translated_text
                break

        if translation and translation != word:
            vocab.definition = f"{word}\n{translation}"
            updated += 1
        else:
            skipped += 1

    if updated > 0:
        await db.flush()
        logger.info(f"Backfill done for user={user_id}: {updated} updated, {skipped} skipped")
    else:
        logger.info(f"No updates needed for user={user_id}")


async def main():
    """Main entry: backfill all users."""
    async with async_session_factory() as db:
        # Get all distinct user_ids with vocabulary
        result = await db.execute(
            select(Vocabulary.user_id).distinct()
        )
        user_ids = [str(row[0]) for row in result.fetchall()]

        if not user_ids:
            logger.info("No vocabulary found in database")
            return

        logger.info(f"Found {len(user_ids)} user(s) with vocabulary")

        for user_id in user_ids:
            await backfill_one_user(db, user_id)

        await db.commit()
        logger.info("All done!")


if __name__ == "__main__":
    asyncio.run(main())
