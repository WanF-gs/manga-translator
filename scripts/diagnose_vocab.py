"""
Diagnose vocabulary data and OCR output to identify the root cause of Chinese-only vocabulary.

Run from WSL2:
    cd manga-translator-backend
    python ../scripts/diagnose_vocab.py
"""
import asyncio
import sys
import os

backend_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "manga-translator-backend")
sys.path.insert(0, backend_path)

from sqlalchemy import select, func, text
from services.common.core.database import async_session_factory


async def diagnose():
    async with async_session_factory() as db:
        print("=" * 60)
        print("DIAGNOSTIC: Vocabulary & OCR Data Analysis")
        print("=" * 60)

        # 1. Check vocabulary language distribution
        print("\n[1] Vocabulary language distribution:")
        result = await db.execute(text(
            """SELECT language, COUNT(*) as cnt
               FROM vocabularies
               GROUP BY language
               ORDER BY cnt DESC"""
        ))
        for row in result.fetchall():
            print(f"    language={row[0]:10s} count={row[1]}")

        # 2. Check project source_lang distribution
        print("\n[2] Project source languages:")
        result = await db.execute(text(
            """SELECT source_lang, COUNT(*) as cnt
               FROM projects
               WHERE status = 'active'
               GROUP BY source_lang
               ORDER BY cnt DESC"""
        ))
        for row in result.fetchall():
            print(f"    source_lang={row[0]:10s} count={row[1]}")

        # 3. Check if OCR text has kana (Japanese indicator)
        print("\n[3] Sample OCR original_text (first 5, check for kana):")
        result = await db.execute(text(
            """SELECT tr.original_text, tr.page_id
               FROM text_regions tr
               JOIN pages pg ON tr.page_id = pg.page_id
               JOIN chapters ch ON pg.chapter_id = ch.chapter_id
               JOIN projects p ON ch.project_id = p.project_id
               WHERE tr.original_text != ''
               LIMIT 5"""
        ))
        for row in result.fetchall():
            text_sample = row[0][:80] if row[0] else "(empty)"
            has_kana = any(0x3040 <= ord(c) <= 0x30FF for c in text_sample)
            has_kanji = any(0x4E00 <= ord(c) <= 0x9FFF for c in text_sample)
            lang_hint = "JA" if has_kana else ("ZH/CJK" if has_kanji else "OTHER")
            print(f"    [{lang_hint}] {text_sample}")

        # 4. Check sample vocabulary words
        print("\n[4] Sample vocabulary words (first 10):")
        result = await db.execute(text(
            """SELECT word, language, definition, source_project_id
               FROM vocabularies
               LIMIT 10"""
        ))
        for row in result.fetchall():
            has_kana = any(0x3040 <= ord(c) <= 0x30FF for c in (row[0] or ""))
            print(f"    [{row[1]}] word={row[0]:20s} kana={has_kana} def={row[2][:40] if row[2] else ''}")

        # 5. Check achievement count
        print("\n[5] Achievements:")
        result = await db.execute(text("SELECT COUNT(*) FROM achievements"))
        ach_count = result.scalar()
        print(f"    achievements total: {ach_count}")

        result = await db.execute(text("SELECT COUNT(*) FROM user_achievements"))
        ua_count = result.scalar()
        print(f"    user_achievements total: {ua_count}")

        # 6. Check if manga-ocr is available
        print("\n[6] OCR engine availability:")
        try:
            from manga_ocr import MangaOcr
            print("    manga-ocr: INSTALLED")
        except ImportError:
            print("    manga-ocr: NOT INSTALLED (will use PaddleOCR)")

        try:
            import paddleocr
            print("    PaddleOCR: INSTALLED")
        except ImportError:
            print("    PaddleOCR: NOT INSTALLED")

        print("\n" + "=" * 60)
        print("DIAGNOSTIC COMPLETE")
        print("=" * 60)


if __name__ == "__main__":
    asyncio.run(diagnose())
