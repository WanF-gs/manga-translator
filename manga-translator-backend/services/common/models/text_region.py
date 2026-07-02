from __future__ import annotations
"""
TextRegion ORM model.
"""
import uuid

from sqlalchemy import Column, String, Integer, Float, Boolean, Text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import BaseModel


class TextRegion(BaseModel):
    __tablename__ = "text_regions"

    region_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        name="region_id",
    )
    page_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    type: Mapped[str] = mapped_column(String(20), nullable=False)
    boundary: Mapped[dict] = mapped_column(JSONB, nullable=False)
    # §2.2.8 选区包围模式: rect(降级) / polygon(优选) / bezier
    boundary_mode: Mapped[str] = mapped_column(String(10), nullable=False, default="rect")
    original_text: Mapped[str] = mapped_column(Text, nullable=True)
    translated_text: Mapped[str] = mapped_column(Text, nullable=True)
    confidence: Mapped[float] = mapped_column(Float, nullable=True)
    is_locked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    style_config: Mapped[dict] = mapped_column(JSONB, nullable=True)
    # §2.13/§2.25 关联角色（用于语气一致性 + 字体-角色绑定回填）
    character_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False)
