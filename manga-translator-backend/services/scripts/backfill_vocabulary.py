"""
Backfill vocabulary for already-translated pages.
给已经翻译过、但 vocabularies 表里没有对应生词的 pages 一次性回填。

Usage（在 WSL2 中）:
  cd /mnt/c/Users/WanFi/Desktop/大三实训/demo_04/manga-translator-backend/services
  python3 -m scripts.backfill_vocabulary
  # 或指定用户
  python3 -m scripts.backfill_vocabulary --user-id <uuid>
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys

# 允许直接执行
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select

from common.core.database import AsyncSessionLocal
from common.models.page import Page
from common.models.chapter import Chapter
from common.models.project import Project
from common.tasks.vocab_extractor import extract_vocabulary_from_page

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("backfill_vocabulary")


async def main(user_id: str | None = None) -> None:
    async with AsyncSessionLocal() as db:
        # 1. 找到所有有 OCR 文本的 pages（不管 status，因为 status 枚举里没有 "translated"）
        from common.models.text_region import TextRegion
        page_ids_q = select(TextRegion.page_id).where(
            TextRegion.original_text.isnot(None),
            TextRegion.original_text != "",
        ).distinct()
        page_ids = [row[0] for row in (await db.execute(page_ids_q)).all()]
        if not page_ids:
            logger.info("No pages with OCR text found.")
            return

        if user_id:
            pages_q = (
                select(Page, Chapter, Project)
                .join(Chapter, Chapter.chapter_id == Page.chapter_id)
                .join(Project, Project.project_id == Chapter.project_id)
                .where(
                    Project.user_id == user_id,
                    Page.page_id.in_(page_ids),
                )
            )
        else:
            pages_q = (
                select(Page, Chapter, Project)
                .join(Chapter, Chapter.chapter_id == Page.chapter_id)
                .join(Project, Project.project_id == Chapter.project_id)
                .where(Page.page_id.in_(page_ids))
            )

        rows = (await db.execute(pages_q)).all()
        logger.info(f"Found {len(rows)} pages with OCR text to backfill")

        total_new = 0
        for page, chapter, project in rows:
            new = await extract_vocabulary_from_page(
                db=db,
                page_id=str(page.page_id),
                user_id=str(project.user_id),
                source_lang=project.source_lang or "ja",
            )
            if new > 0:
                logger.info(f"  page {page.page_id} ({project.source_lang}): +{new} new words")
                total_new += new

        await db.commit()
        logger.info(f"Done. Total new vocabulary inserted: {total_new}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--user-id", default=None, help="只回填指定用户的 pages")
    args = parser.parse_args()
    asyncio.run(main(user_id=args.user_id))
