from __future__ import annotations
"""
OperationHistory ORM model for undo/redo support.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, String, Text, DateTime, Integer
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import BaseModel


class OperationHistory(BaseModel):
    __tablename__ = "operation_histories"

    history_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        name="history_id",
    )
    page_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    
    operation_type: Mapped[str] = mapped_column(String(30), nullable=False)
    # detect, ocr, translate, inpaint, render, manual_edit, style_change
    
    snapshot_before: Mapped[dict] = mapped_column(JSONB, nullable=True)
    # Full page state before operation: {status, processed_url, text_regions: [...]}
    
    snapshot_after: Mapped[dict] = mapped_column(JSONB, nullable=True)
    # Full page state after operation
    
    regions_snapshot: Mapped[dict] = mapped_column(JSONB, nullable=True)
    # Full text_regions state: {region_id: {original_text, translated_text, boundary, type, ...}}
    
    description: Mapped[str] = mapped_column(String(500), nullable=True)
    # Human-readable description
    
    undo_stack_position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Position in undo stack (0 = latest)
    
    is_undone: Mapped[bool] = mapped_column(default=False)
    # Whether this operation has been undone (in redo stack)
