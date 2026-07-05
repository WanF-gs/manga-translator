#!/usr/bin/env python3
"""Quick test: check Jisho API and database connectivity."""
import asyncio, sys, os
backend_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "manga-translator-backend")
sys.path.insert(0, backend_path)

import httpx
from services.common.core.database import AsyncSessionLocal
from services.common.models.vocabulary import Vocabulary
from sqlalchemy import select

async def test():
    # 1. Test Jisho API
    print("=== Testing Jisho API ===")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get("https://jisho.org/api/v1/search/words", params={"keyword": "そういうことで"})
        print(f"Status: {resp.status_code}")
        data = resp.json()
        if data.get("data"):
            first = data["data"][0]
            japanese = first.get("japanese", [{}])[0]
            print(f"Word: {japanese.get('word')}")
            print(f"Reading: {japanese.get('reading')}")
            senses = first.get("senses", [])
            if senses:
                print(f"Defs: {senses[0].get('english_definitions', [])[:2]}")
    except Exception as e:
        print(f"Jisho ERROR: {e}")

    # 2. Test DB
    print("\n=== Testing DB ===")
    try:
        async with AsyncSessionLocal() as db:
            count = (await db.execute(select(Vocabulary).where(Vocabulary.language == 'ja'))).scalars().all()
            print(f"Japanese vocab count: {len(count)}")
            sample = count[0] if count else None
            if sample:
                print(f"Sample word: {sample.word}")
                print(f"Sample definition: {sample.definition[:100] if sample.definition else 'None'}")
    except Exception as e:
        print(f"DB ERROR: {e}")

if __name__ == "__main__":
    asyncio.run(test())
