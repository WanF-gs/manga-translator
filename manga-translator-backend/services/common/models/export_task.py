from __future__ import annotations
"""
ExportTask ORM model.
"""
import uuid

from sqlalchemy import Column, String, Integer, Float, Text, DateTime
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import BaseModel


class ExportTask(BaseModel):
    __tablename__ = "export_tasks"

    task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        name="task_id",
    )
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    chapter_ids: Mapped[dict] = mapped_column(JSONB, nullable=False)
    format: Mapped[str] = mapped_column(String(10), nullable=False)
    quality: Mapped[int] = mapped_column(Integer, nullable=False, default=90)
    resolution: Mapped[str] = mapped_column(String(10), nullable=False, default="original")
    bilingual_mode: Mapped[str] = mapped_column(String(20), nullable=True)
    naming_rule: Mapped[str] = mapped_column(String(200), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="queued")
    progress: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    result_url: Mapped[str] = mapped_column(String(500), nullable=True)
    error_msg: Mapped[str] = mapped_column(Text, nullable=True)
    completed_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=True)
