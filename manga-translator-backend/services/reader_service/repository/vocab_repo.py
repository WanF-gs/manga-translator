from __future__ import annotations
"""生词本数据仓库"""
from typing import List, Optional, Tuple
import uuid

from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))

from common.models.vocabulary import Vocabulary


class VocabRepo:
    """生词本数据仓库"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(self, vocab: Vocabulary) -> Vocabulary:
        """添加生词"""
        self.db.add(vocab)
        await self.db.flush()
        await self.db.refresh(vocab)
        return vocab

    async def find_by_id(self, vocab_id: str, user_id: str) -> Optional[Vocabulary]:
        """按ID查询生词"""
        result = await self.db.execute(
            select(Vocabulary).where(
                Vocabulary.vocab_id == uuid.UUID(vocab_id),
                Vocabulary.user_id == uuid.UUID(user_id),
            )
        )
        return result.scalar_one_or_none()

    async def find_by_word(self, user_id: str, word: str, language: str) -> Optional[Vocabulary]:
        """按单词和语言查询（去重检查）"""
        result = await self.db.execute(
            select(Vocabulary).where(
                Vocabulary.user_id == uuid.UUID(user_id),
                Vocabulary.word == word,
                Vocabulary.language == language,
            )
        )
        return result.scalar_one_or_none()

    async def find_paginated(
        self, user_id: str, page: int = 1, page_size: int = 30,
        language: Optional[str] = None, search: Optional[str] = None,
        sort_by: str = "created_at", sort_order: str = "desc",
    ) -> Tuple[List[Vocabulary], int]:
        """分页查询生词"""
        query = select(Vocabulary).where(Vocabulary.user_id == uuid.UUID(user_id))
        count_query = select(func.count()).select_from(Vocabulary).where(
            Vocabulary.user_id == uuid.UUID(user_id)
        )

        if language:
            query = query.where(Vocabulary.language == language)
            count_query = count_query.where(Vocabulary.language == language)

        if search:
            search_filter = Vocabulary.word.ilike(f"%{search}%")
            query = query.where(search_filter)
            count_query = count_query.where(search_filter)

        # 排序
        sort_col = getattr(Vocabulary, sort_by, Vocabulary.created_at)
        if sort_order == "asc":
            query = query.order_by(sort_col.asc())
        else:
            query = query.order_by(sort_col.desc())

        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self.db.execute(query)
        items = list(result.scalars().all())

        count_result = await self.db.execute(count_query)
        total = count_result.scalar() or 0

        return items, total

    async def update(self, vocab: Vocabulary) -> Vocabulary:
        """更新生词"""
        await self.db.flush()
        await self.db.refresh(vocab)
        return vocab

    async def delete(self, vocab_id: str, user_id: str) -> bool:
        """删除生词"""
        result = await self.db.execute(
            delete(Vocabulary).where(
                Vocabulary.vocab_id == uuid.UUID(vocab_id),
                Vocabulary.user_id == uuid.UUID(user_id),
            )
        )
        await self.db.flush()
        return result.rowcount > 0

    async def batch_create(self, vocabs: List[Vocabulary]) -> List[Vocabulary]:
        """批量添加生词"""
        for v in vocabs:
            self.db.add(v)
        await self.db.flush()
        for v in vocabs:
            await self.db.refresh(v)
        return vocabs

    async def count_by_language(self, user_id: str) -> List[dict]:
        """按语言统计生词数量"""
        result = await self.db.execute(
            select(
                Vocabulary.language,
                func.count().label("cnt"),
            )
            .where(Vocabulary.user_id == uuid.UUID(user_id))
            .group_by(Vocabulary.language)
            .order_by(func.count().desc())
        )
        return [
            {"language": row.language, "count": row.cnt}
            for row in result.all()
        ]
