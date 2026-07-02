from __future__ import annotations
"""Character model for tone consistency engine (v2.0 + v3.0)."""
from sqlalchemy import Column, String, Integer, Text, ForeignKey, CheckConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
import uuid

from .base import BaseModel

class Character(BaseModel):
    __tablename__ = "characters"

    character_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.project_id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    tone_type: Mapped[str] = mapped_column(String(20), nullable=False, default="custom")
    custom_tone_params = mapped_column(JSONB, nullable=True)
    catchphrase: Mapped[str] = mapped_column(Text, nullable=True)
    honorific_level: Mapped[str] = mapped_column(String(10), nullable=True)
    gender: Mapped[str] = mapped_column(String(10), nullable=True)
    visual_features = mapped_column(JSONB, nullable=True)
    voice_id: Mapped[str] = mapped_column(String(100), nullable=True)
    font_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("fonts.font_id", ondelete="SET NULL"), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    __table_args__ = (
        CheckConstraint(
            "tone_type IN ('tsundere','hotblooded','calm','cold','loli','genki','lazy','chuunibyou','natural','bellyblack','custom')",
            name="ck_characters_tone_type"
        ),
        CheckConstraint("honorific_level IN ('casual','polite','formal')", name="ck_characters_honorific"),
        CheckConstraint("gender IN ('male','female','neutral')", name="ck_characters_gender"),
    )
