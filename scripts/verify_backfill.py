#!/usr/bin/env python3
"""Check if backfill worked."""
import asyncio, sys, os
backend_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "manga-translator-backend")
sys.path.insert(0, backend_path)

from services.common.core.database import AsyncSessionLocal
from services.common.models.vocabulary import Vocabulary
from sqlalchemy import select

async def check():
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Vocabulary).where(Vocabulary.word == 'そういうことはいえないわけじゃあ')
        )
        v = result.scalar_one_or_none()
        if v:
            print(f"Word: {v.word}")
            print(f"Definition: {v.definition}")
            print(f"Part of speech: {v.part_of_speech}")
        else:
            print("Word not found")

        # Count how many ja vocab have \n in definition (meaning they have a translation)
        from sqlalchemy import text
        r = await db.execute(text("SELECT COUNT(*) FROM vocabularies WHERE language='ja' AND definition LIKE '%\\n%'"))
        with_trans = r.scalar()
        r = await db.execute(text("SELECT COUNT(*) FROM vocabularies WHERE language='ja'"))
        total = r.scalar()
        print(f"Japanese vocab with translation: {with_trans}/{total}")

if __name__ == "__main__":
    asyncio.run(check())
