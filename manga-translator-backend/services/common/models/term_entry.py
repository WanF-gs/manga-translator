from __future__ import annotations
"""
TermEntry ORM model.
"""
import uuid

from sqlalchemy import Column, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import BaseModel


class TermEntry(BaseModel):
    __tablename__ = "term_entries"

    term_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        name="term_id",
    )
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=True)
    source_text: Mapped[str] = mapped_column(String(500), nullable=False)
    target_text: Mapped[str] = mapped_column(String(500), nullable=False)
    note: Mapped[str] = mapped_column(Text, nullable=True)
    category: Mapped[str] = mapped_column(String(50), nullable=True)
    scope: Mapped[str] = mapped_column(String(20), nullable=False, default="account")
