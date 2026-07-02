from __future__ import annotations
"""
Project ORM model.
"""
import uuid

from sqlalchemy import Column, String, Boolean, DateTime, CheckConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import BaseModel


class Project(BaseModel):
    __tablename__ = "projects"

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        name="project_id",
    )
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    source_lang: Mapped[str] = mapped_column(String(10), nullable=False)
    default_target_lang: Mapped[str] = mapped_column(String(10), nullable=False, default="zh-CN")
    cover_url: Mapped[str] = mapped_column(String(500), nullable=True)
    is_favorite: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    trashed_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=True)


class ProjectMember(BaseModel):
    __tablename__ = "project_members"

    member_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        name="member_id",
    )
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="viewer")
    invited_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=True)
    joined_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False, default="now")
    updated_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False)
