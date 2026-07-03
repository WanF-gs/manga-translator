"""
Vocabulary extraction utility — 从漫画 page 的 OCR 文本中提取生词，
写入 vocabularies + learning_progress 表，供学习中心使用。

被以下位置调用：
- common/tasks/pipeline_tasks.py: Celery 流水线翻译完成后
- translation_service/api/translate.py: 同步翻译完成后（修复学习中心 0 词汇）
- scripts/backfill_vocabulary.py: 一次性回填已翻译的旧数据
"""
from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# 按语言分词正则
_WORD_PATTERNS = {
    "ja": re.compile(r"[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]{2,}"),
    "en": re.compile(r"[a-zA-Z]{2,}"),
    "ko": re.compile(r"[\uac00-\ud7af]{2,}"),
    "zh": re.compile(r"[\u4e00-\u9fff]{2,}"),
}


async def extract_vocabulary_from_page(
    db: AsyncSession,
    page_id: str,
    user_id: str,
    source_lang: str,
) -> int:
    """
    从 page 的 OCR 文本中提取生词，写入 vocabularies + learning_progress。

    Returns:
        新增的词汇数量
    """
    try:
        from common.models.text_region import TextRegion
        from common.models.vocabulary import Vocabulary
        from common.models.v3_models import LearningProgress
        from common.models.page import Page
        from common.models.chapter import Chapter

        uid = uuid.UUID(user_id) if user_id else None
        if not uid:
            logger.debug(f"[VocabExtract] skip: no user_id for page {page_id}")
            return 0

        # Look up project_id via page → chapter
        page = (await db.execute(
            select(Page).where(Page.page_id == page_id)
        )).scalar_one_or_none()
        if not page:
            return 0

        chapter = (await db.execute(
            select(Chapter).where(Chapter.chapter_id == page.chapter_id)
        )).scalar_one_or_none()
        project_id = chapter.project_id if chapter else None

        # Get all OCR original text
        regions_result = await db.execute(
            select(TextRegion).where(
                TextRegion.page_id == page_id,
                TextRegion.original_text.isnot(None),
                TextRegion.original_text != "",
            )
        )
        regions = list(regions_result.scalars().all())
        if not regions:
            return 0

        # Tokenize
        pattern = _WORD_PATTERNS.get(source_lang)
        if not pattern:
            logger.debug(f"[VocabExtract] skip: unsupported lang {source_lang}")
            return 0

        seen: set[str] = set()
        words_to_add: list[str] = []
        # word -> translated_text mapping (for bilingual display)
        word_to_translation: dict[str, str] = {}
        for r in regions:
            original = r.original_text or ""
            translated = r.translated_text or ""
            for word in pattern.findall(original):
                w = word.lower() if source_lang == "en" else word
                if w not in seen:
                    seen.add(w)
                    words_to_add.append(w)
                if w not in word_to_translation and translated:
                    word_to_translation[w] = translated

        if not words_to_add:
            return 0

        # Dedup against existing
        existing_result = await db.execute(
            select(Vocabulary.word).where(
                Vocabulary.user_id == uid,
                Vocabulary.language == source_lang,
                Vocabulary.word.in_(words_to_add),
            )
        )
        existing_words = {row[0] for row in existing_result.fetchall()}

        now = datetime.now(timezone.utc)
        new_count = 0

        for word in words_to_add:
            if word in existing_words:
                continue
            # Build definition as "word\ntranslation" if translation exists
            translation = word_to_translation.get(word, "")
            definition = f"{word}\n{translation}" if translation and translation != word else word
            vocab = Vocabulary(
                user_id=uid,
                word=word,
                language=source_lang,
                definition=definition,
                source_project_id=project_id,
            )
            db.add(vocab)
            await db.flush()

            lp = LearningProgress(
                user_id=uid,
                vocab_id=vocab.vocab_id,
                review_count=0,
                mastery_level=1,
                next_review_at=now + timedelta(days=1),
            )
            db.add(lp)
            new_count += 1

        # Check and unlock achievements for vocabulary milestones
        if new_count > 0:
            try:
                from common.utils.achievement_checker import check_and_unlock_achievements
                await check_and_unlock_achievements(db, uid, category="vocabulary")
            except Exception as e:
                logger.debug(f"[VocabExtract] achievement check skipped: {e}")

        logger.info(
            f"[VocabExtract] page={page_id} lang={source_lang} "
            f"found={len(words_to_add)} new={new_count}"
        )
        return new_count
    except Exception as e:
        logger.warning(f"[VocabExtract] failed for page {page_id}: {e}", exc_info=True)
        return 0
