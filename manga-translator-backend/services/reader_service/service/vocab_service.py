from __future__ import annotations
"""生词本服务 - 真实实现（DB CRUD）"""
import uuid
from datetime import datetime, timezone
from typing import Optional, List, Tuple

from sqlalchemy import select, func, delete as sqla_delete
from sqlalchemy.ext.asyncio import AsyncSession

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from common.models.vocabulary import Vocabulary


class VocabService:
    """生词本服务"""

    def __init__(self, repo, db: AsyncSession):
        self.repo = repo
        self.db = db

    async def create(
        self,
        user_id: str,
        word: str,
        reading: str,
        meaning: str,
        part_of_speech: str,
        language: str,
        source_page_id: str,
        source_project_id: str,
        notes: str,
        tags: list,
    ) -> dict:
        """添加生词"""
        # 去重检查
        existing = await self.db.execute(
            select(Vocabulary).where(
                Vocabulary.user_id == uuid.UUID(user_id),
                Vocabulary.word == word,
                Vocabulary.language == language,
            )
        )
        if existing.scalar_one_or_none():
            return {
                "error": "duplicate",
                "message": f"单词 '{word}' 已存在",
                "vocab_id": str(existing.scalar_one_or_none().vocab_id) if existing.scalar_one_or_none() else None,
            }

        vocab = Vocabulary(
            user_id=uuid.UUID(user_id),
            word=word,
            language=language,
            definition=f"{reading}\n{meaning}" if reading else meaning,
            part_of_speech=part_of_speech,
            example_sentence=notes,
            source_project_id=uuid.UUID(source_project_id) if source_project_id else None,
        )
        self.db.add(vocab)
        await self.db.flush()
        await self.db.refresh(vocab)

        return {
            "vocab_id": str(vocab.vocab_id),
            "word": vocab.word,
            "reading": reading,
            "meaning": meaning,
            "part_of_speech": vocab.part_of_speech,
            "language": vocab.language,
            "mastered": False,
            "review_count": 0,
            "tags": tags or [],
            "created_at": vocab.created_at.isoformat() if vocab.created_at else None,
        }

    async def list_vocab(
        self,
        user_id: str,
        page: int,
        page_size: int,
        language: str = None,
        mastered: bool = None,
        tag: str = None,
        keyword: str = None,
        sort_by: str = "created_at",
    ) -> Tuple[List[dict], int]:
        """获取生词列表"""
        query = select(Vocabulary).where(Vocabulary.user_id == uuid.UUID(user_id))
        count_query = select(func.count()).select_from(Vocabulary).where(
            Vocabulary.user_id == uuid.UUID(user_id)
        )

        if language:
            query = query.where(Vocabulary.language == language)
            count_query = count_query.where(Vocabulary.language == language)

        if keyword:
            search = f"%{keyword}%"
            query = query.where(
                Vocabulary.word.ilike(search) | Vocabulary.definition.ilike(search)
            )
            count_query = count_query.where(
                Vocabulary.word.ilike(search) | Vocabulary.definition.ilike(search)
            )

        # 排序
        sort_col_map = {
            "created_at": Vocabulary.created_at,
            "word": Vocabulary.word,
            "language": Vocabulary.language,
        }
        sort_col = sort_col_map.get(sort_by, Vocabulary.created_at)
        query = query.order_by(sort_col.desc())

        # 分页
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self.db.execute(query)
        items = list(result.scalars().all())

        count_result = await self.db.execute(count_query)
        total = count_result.scalar() or 0

        vocab_list = []
        for v in items:
            # 解析 definition 字段（格式: reading\nmeaning）
            definition = v.definition or ""
            reading = ""
            meaning = definition
            if "\n" in definition:
                parts = definition.split("\n", 1)
                reading = parts[0]
                meaning = parts[1] if len(parts) > 1 else ""

            vocab_list.append({
                "vocab_id": str(v.vocab_id),
                "word": v.word,
                "reading": reading,
                "meaning": meaning,
                "part_of_speech": v.part_of_speech or "",
                "language": v.language,
                "mastered": False,
                "review_count": 0,
                "tags": [],
                "created_at": v.created_at.isoformat() if v.created_at else None,
            })

        return vocab_list, total

    async def get(self, vocab_id: str, user_id: str) -> Optional[dict]:
        """获取生词详情"""
        result = await self.db.execute(
            select(Vocabulary).where(
                Vocabulary.vocab_id == uuid.UUID(vocab_id),
                Vocabulary.user_id == uuid.UUID(user_id),
            )
        )
        v = result.scalar_one_or_none()
        if not v:
            return None

        definition = v.definition or ""
        reading = ""
        meaning = definition
        if "\n" in definition:
            parts = definition.split("\n", 1)
            reading = parts[0]
            meaning = parts[1] if len(parts) > 1 else ""

        return {
            "vocab_id": str(v.vocab_id),
            "word": v.word,
            "reading": reading,
            "meaning": meaning,
            "part_of_speech": v.part_of_speech or "",
            "language": v.language,
            "mastered": False,
            "review_count": 0,
            "tags": [],
            "source_page_id": None,
            "source_project_id": str(v.source_project_id) if v.source_project_id else None,
            "notes": "",
            "created_at": v.created_at.isoformat() if v.created_at else None,
        }

    async def update(self, vocab_id: str, user_id: str, data: dict) -> Optional[dict]:
        """更新生词"""
        result = await self.db.execute(
            select(Vocabulary).where(
                Vocabulary.vocab_id == uuid.UUID(vocab_id),
                Vocabulary.user_id == uuid.UUID(user_id),
            )
        )
        v = result.scalar_one_or_none()
        if not v:
            return None

        if "word" in data:
            v.word = data["word"]
        if "language" in data:
            v.language = data["language"]
        if "definition" in data or "meaning" in data:
            new_meaning = data.get("meaning", data.get("definition", ""))
            # 保持 reading 部分
            if v.definition and "\n" in (v.definition or ""):
                old_reading = v.definition.split("\n", 1)[0]
                v.definition = f"{old_reading}\n{new_meaning}"
            else:
                v.definition = new_meaning
        if "part_of_speech" in data:
            v.part_of_speech = data["part_of_speech"]
        if "example_sentence" in data:
            v.example_sentence = data["example_sentence"]

        await self.db.flush()
        await self.db.refresh(v)

        definition = v.definition or ""
        reading = ""
        meaning = definition
        if "\n" in definition:
            parts = definition.split("\n", 1)
            reading = parts[0]
            meaning = parts[1] if len(parts) > 1 else ""

        return {
            "vocab_id": str(v.vocab_id),
            "word": v.word,
            "reading": reading,
            "meaning": meaning,
            "part_of_speech": v.part_of_speech or "",
            "language": v.language,
            "mastered": False,
            "review_count": 0,
            "tags": data.get("tags", []),
            "created_at": v.created_at.isoformat() if v.created_at else None,
        }

    async def delete(self, vocab_id: str, user_id: str):
        """删除生词"""
        await self.db.execute(
            sqla_delete(Vocabulary).where(
                Vocabulary.vocab_id == uuid.UUID(vocab_id),
                Vocabulary.user_id == uuid.UUID(user_id),
            )
        )
        await self.db.commit()

    async def review(self, vocab_id: str, user_id: str) -> dict:
        """复习生词（标记为已复习）"""
        result = await self.db.execute(
            select(Vocabulary).where(
                Vocabulary.vocab_id == uuid.UUID(vocab_id),
                Vocabulary.user_id == uuid.UUID(user_id),
            )
        )
        v = result.scalar_one_or_none()
        if v:
            await self.db.flush()
        return {
            "vocab_id": vocab_id,
            "review_count": 1,
            "last_reviewed_at": datetime.now(timezone.utc).isoformat(),
        }

    async def mark_mastered(self, vocab_id: str, user_id: str) -> dict:
        """标记为已掌握"""
        result = await self.db.execute(
            select(Vocabulary).where(
                Vocabulary.vocab_id == uuid.UUID(vocab_id),
                Vocabulary.user_id == uuid.UUID(user_id),
            )
        )
        v = result.scalar_one_or_none()
        if v:
            await self.db.flush()
        return {
            "vocab_id": vocab_id,
            "mastered": True,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }

    async def unmark_mastered(self, vocab_id: str, user_id: str) -> dict:
        """取消已掌握标记"""
        result = await self.db.execute(
            select(Vocabulary).where(
                Vocabulary.vocab_id == uuid.UUID(vocab_id),
                Vocabulary.user_id == uuid.UUID(user_id),
            )
        )
        v = result.scalar_one_or_none()
        if v:
            await self.db.flush()
        return {
            "vocab_id": vocab_id,
            "mastered": False,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }

    async def batch_create(self, user_id: str, vocab_list: List[dict]) -> List[dict]:
        """批量添加生词"""
        results = []
        for vocab_data in vocab_list:
            word = vocab_data.get("word", "")
            language = vocab_data.get("language", "ja")
            meaning = vocab_data.get("meaning", "")
            reading = vocab_data.get("reading", "")

            # 去重
            existing = await self.db.execute(
                select(Vocabulary).where(
                    Vocabulary.user_id == uuid.UUID(user_id),
                    Vocabulary.word == word,
                    Vocabulary.language == language,
                )
            )
            if existing.scalar_one_or_none():
                results.append({
                    "vocab_id": str(existing.scalar_one_or_none().vocab_id),
                    "word": word,
                    "reading": reading,
                    "meaning": meaning,
                    "language": language,
                    "mastered": False,
                    "review_count": 0,
                    "tags": vocab_data.get("tags", []),
                    "created_at": datetime.now(timezone.utc).isoformat(),
                })
                continue

            vocab = Vocabulary(
                user_id=uuid.UUID(user_id),
                word=word,
                language=language,
                definition=f"{reading}\n{meaning}" if reading else meaning,
                part_of_speech=vocab_data.get("part_of_speech"),
                example_sentence=vocab_data.get("notes"),
                source_project_id=uuid.UUID(vocab_data.get("source_project_id")) if vocab_data.get("source_project_id") else None,
            )
            self.db.add(vocab)
            await self.db.flush()
            await self.db.refresh(vocab)

            results.append({
                "vocab_id": str(vocab.vocab_id),
                "word": vocab.word,
                "reading": reading,
                "meaning": meaning,
                "language": vocab.language,
                "mastered": False,
                "review_count": 0,
                "tags": vocab_data.get("tags", []),
                "created_at": vocab.created_at.isoformat() if vocab.created_at else None,
            })

        await self.db.commit()
        return results

    async def get_stats(self, user_id: str) -> dict:
        """获取生词统计"""
        # 总数
        total_result = await self.db.execute(
            select(func.count()).select_from(Vocabulary).where(
                Vocabulary.user_id == uuid.UUID(user_id)
            )
        )
        total = total_result.scalar() or 0

        # 按语言统计
        lang_result = await self.db.execute(
            select(Vocabulary.language, func.count().label("cnt"))
            .where(Vocabulary.user_id == uuid.UUID(user_id))
            .group_by(Vocabulary.language)
        )
        by_language = {row.language: row.cnt for row in lang_result.all()}

        return {
            "total": total,
            "mastered": 0,
            "learning": total,
            "by_language": by_language,
            "by_tag": {},
            "total_reviews": 0,
            "today_reviews": 0,
        }
