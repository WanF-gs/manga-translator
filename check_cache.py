#!/usr/bin/env python3
"""Check translation cache and trace the exact pipeline"""
import asyncio
import asyncpg

async def check():
    conn = await asyncpg.connect(
        "postgresql://manga_user:manga_pass@localhost:5433/manga_translator",
        timeout=5
    )
    
    # Check translation cache for these texts
    texts = ["いえ、", "おおお…お兄さん!!", "あ、", "これ…秋田のお米です!", "生来!"]
    
    print("=== Translation Cache ===")
    for t in texts:
        rows = await conn.fetch("""
            SELECT source_text, translated_text, source_lang, target_lang, hit_count, created_at
            FROM translation_cache
            WHERE source_text = $1
            ORDER BY created_at DESC
            LIMIT 3
        """, t)
        for r in rows:
            print(f"  source: {r['source_text'][:40]}")
            print(f"  trans:  {r['translated_text'][:50]}")
            print(f"  lang: {r['source_lang']}→{r['target_lang']} hits={r['hit_count']}")
            print()
    
    # Also clear all caches for these texts (they might be stale)
    print("=== Clearing stale caches ===")
    for t in texts:
        result = await conn.execute("""
            DELETE FROM translation_cache WHERE source_text = $1
        """, t)
        deleted = int(result.split()[-1])
        if deleted:
            print(f"  Deleted {deleted} cache entries for: {t[:30]}")
    
    await conn.close()

asyncio.run(check())
