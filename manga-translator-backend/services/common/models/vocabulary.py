from __future__ import annotations
"""
Vocabulary ORM model.
"""
import uuid

from sqlalchemy import Column, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import BaseModel


class Vocabulary(BaseModel):
    __tablename__ = "vocabularies"

    vocab_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        name="vocab_id",
    )
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    word: Mapped[str] = mapped_column(String(200), nullable=False)
    language: Mapped[str] = mapped_column(String(10), nullable=False)
    definition: Mapped[str] = mapped_column(Text, nullable=True)
    part_of_speech: Mapped[str] = mapped_column(String(50), nullable=True)
    example_sentence: Mapped[str] = mapped_column(Text, nullable=True)
    source_project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=True)
