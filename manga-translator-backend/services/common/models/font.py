from __future__ import annotations
"""Font model for font management system (v3.0)."""
from sqlalchemy import Column, String, Integer, Boolean, ForeignKey, CheckConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
import uuid

from .base import BaseModel

class Font(BaseModel):
    __tablename__ = "fonts"

    font_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="CASCADE"), nullable=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    file_url: Mapped[str] = mapped_column(String(500), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=True)
    category: Mapped[str] = mapped_column(String(20), nullable=False)
    style_tags = mapped_column(JSONB, default=list)
    license: Mapped[str] = mapped_column(String(30), nullable=False, default="personal_only")
    language_tags = mapped_column(JSONB, default=list)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    __table_args__ = (
        CheckConstraint("category IN ('dialogue','narration','onomatopoeia','title')", name="ck_fonts_category"),
        CheckConstraint("license IN ('free_commercial','attribution','personal_only')", name="ck_fonts_license"),
    )
