from __future__ import annotations
"""
Page ORM model.
"""
import uuid

from sqlalchemy import Column, String, Integer, Float
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import BaseModel


class Page(BaseModel):
    __tablename__ = "pages"

    page_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        name="page_id",
    )
    chapter_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    original_url: Mapped[str] = mapped_column(String(500), nullable=False)
    processed_url: Mapped[str] = mapped_column(String(500), nullable=True)
    thumbnail_url: Mapped[str] = mapped_column(String(500), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    ocr_result: Mapped[dict] = mapped_column(JSONB, nullable=True)
    translation_result: Mapped[dict] = mapped_column(JSONB, nullable=True)
    preprocessing_result: Mapped[dict] = mapped_column(JSONB, nullable=True)
