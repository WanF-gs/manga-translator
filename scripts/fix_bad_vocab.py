import asyncio
import sys, os

backend_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "manga-translator-backend")
sys.path.insert(0, backend_path)

from sqlalchemy import select, text
from services.common.core.database import AsyncSessionLocal
from services.common.models.vocabulary import Vocabulary
import httpx

async def lookup_jisho(word):
    """Simple Jisho lookup."""
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                "https://jisho.org/api/v1/search/words",
                params={"keyword": word}
            )
        data = resp.json()
        if not data.get("data"):
            return None
        first = data["data"][0]
        japanese = first.get("japanese", [{}])[0]
        reading = japanese.get("reading", "")
        senses = first.get("senses", [])
        defs = []
        for s in senses[:2]:
            d = s.get("english_definitions", [])
            if d:
                defs.append("; ".join(d[:3]))
        return {
            "reading": reading,
            "definitions": defs,
        }
    except Exception as e:
        print(f"  Jisho failed: {e}")
        return None

async def fix_bad_translations():
    async with AsyncSessionLocal() as db:
        # Find bad translations: contains ellipsis, too short, or same as word
        result = await db.execute(
            select(Vocabulary).where(
                Vocabulary.language == 'ja',
                Vocabulary.definition.isnot(None),
            )
        )
        vocab_list = result.scalars().all()
        
        bad_words = []
        for v in vocab_list:
            defn = v.definition or ""
            # Check if definition contains ellipsis or is just the word
            if "。。" in defn or ".." in defn or "…" in defn or "\n" not in defn:
                bad_words.append(v)
        
        print(f"Found {len(bad_words)} vocab with bad/missing translations")
        
        fixed = 0
        for v in bad_words[:50]:  # fix first 50 to avoid timeout
            print(f"Fixing: {v.word}")
            entry = await lookup_jisho(v.word)
            if entry:
                reading = entry.get("reading", "")
                defs = entry.get("definitions", [])
                translation = "; ".join(defs[:2]) if defs else ""
                if reading and reading != v.word:
                    v.definition = f"{reading}\n{translation}" if translation else v.word
                else:
                    v.definition = f"{v.word}\n{translation}" if translation else v.word
                fixed += 1
                print(f"  -> {v.definition[:80]}")
            else:
                print(f"  -> No Jisho entry found")
        
        await db.commit()
        print(f"Done: {fixed}/{len(bad_words)} fixed")

if __name__ == "__main__":
    asyncio.run(fix_bad_translations())
