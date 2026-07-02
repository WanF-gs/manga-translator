from __future__ import annotations
"""v3.0 new models: APIKey, CollaborationLock, Comment, ChangeLog, Snapshot,
TranslationQuality, Feedback, LearningProgress, Achievement, UserAchievement, Voice."""
from sqlalchemy import Column, String, Integer, BigInteger, Boolean, Text, Float, ForeignKey, DateTime, CheckConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func, text
import uuid

from .base import BaseModel

class Voice(BaseModel):
    __tablename__ = "voices"

    voice_id: Mapped[str] = mapped_column(String(100), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="CASCADE"), nullable=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    gender: Mapped[str] = mapped_column(String(10), nullable=False)
    age_group: Mapped[str] = mapped_column(String(20), nullable=True)
    tone_description: Mapped[str] = mapped_column(String(200), nullable=True)
    language: Mapped[str] = mapped_column(String(10), nullable=False, default="ja")
    sample_url: Mapped[str] = mapped_column(String(500), nullable=True)
    is_system: Mapped[bool] = mapped_column(Boolean, default=False)
    is_custom_clone: Mapped[bool] = mapped_column(Boolean, default=False)
    clone_sample_url: Mapped[str] = mapped_column(String(500), nullable=True)

    __table_args__ = (
        CheckConstraint("gender IN ('male','female','neutral')", name="ck_voices_gender"),
        CheckConstraint("age_group IN ('child','teen','young_adult','adult','elder')", name="ck_voices_age"),
    )


class APIKey(BaseModel):
    __tablename__ = "api_keys"

    api_key_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False)
    key_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    key_prefix: Mapped[str] = mapped_column(String(8), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    permissions = mapped_column(JSONB, default=["detect","ocr","translate"])
    rate_limit: Mapped[int] = mapped_column(Integer, default=60)
    total_calls: Mapped[int] = mapped_column(BigInteger, default=0)
    monthly_calls: Mapped[int] = mapped_column(BigInteger, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    expires_at = mapped_column(DateTime(timezone=True), nullable=True)
    last_used_at = mapped_column(DateTime(timezone=True), nullable=True)


class CollaborationLock(BaseModel):
    __tablename__ = "collaboration_locks"
    __mapper_args__ = {"eager_defaults": True}

    lock_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    page_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("pages.page_id", ondelete="CASCADE"), nullable=False, unique=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False)
    lock_type: Mapped[str] = mapped_column(String(10), nullable=False)
    locked_at = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at = mapped_column(DateTime(timezone=True), server_default=text("now() + INTERVAL '30 minutes'"))

    __table_args__ = (
        CheckConstraint("lock_type IN ('edit','review')", name="ck_locks_type"),
    )


class Comment(BaseModel):
    __tablename__ = "comments"

    comment_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    region_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("text_regions.region_id", ondelete="CASCADE"), nullable=True)
    page_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("pages.page_id", ondelete="CASCADE"), nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.project_id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    mentioned_user_ids = mapped_column(JSONB, default=list)
    status: Mapped[str] = mapped_column(String(10), default="open")
    parent_comment_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("comments.comment_id", ondelete="CASCADE"), nullable=True)
    resolved_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)
    resolved_at = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        CheckConstraint("status IN ('open','resolved')", name="ck_comments_status"),
    )


class ChangeLog(BaseModel):
    __tablename__ = "change_logs"

    log_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.project_id", ondelete="CASCADE"), nullable=False)
    page_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("pages.page_id", ondelete="CASCADE"), nullable=True)
    region_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("text_regions.region_id", ondelete="SET NULL"), nullable=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False)
    action: Mapped[str] = mapped_column(String(50), nullable=False)
    field_name: Mapped[str] = mapped_column(String(50), nullable=True)
    old_value: Mapped[str] = mapped_column(Text, nullable=True)
    new_value: Mapped[str] = mapped_column(Text, nullable=True)
    extra_data = mapped_column(JSONB, nullable=True)


class Snapshot(BaseModel):
    __tablename__ = "snapshots"

    snapshot_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.project_id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=True)
    snapshot_data = mapped_column(JSONB, nullable=False)


class TranslationQuality(BaseModel):
    __tablename__ = "translation_quality"

    quality_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    page_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("pages.page_id", ondelete="CASCADE"), nullable=False)
    bleu_score: Mapped[float] = mapped_column(Float, nullable=True)
    meteor_score: Mapped[float] = mapped_column(Float, nullable=True)
    tone_consistency: Mapped[float] = mapped_column(Float, nullable=True)
    term_consistency: Mapped[float] = mapped_column(Float, nullable=True)
    overall_score: Mapped[float] = mapped_column(Float, nullable=True)
    report_json = mapped_column(JSONB, nullable=True)

    __table_args__ = (
        CheckConstraint("bleu_score >= 0 AND bleu_score <= 1", name="ck_quality_bleu"),
        CheckConstraint("meteor_score >= 0 AND meteor_score <= 1", name="ck_quality_meteor"),
        CheckConstraint("overall_score >= 0 AND overall_score <= 1", name="ck_quality_overall"),
    )


class Feedback(BaseModel):
    __tablename__ = "feedback"

    feedback_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False)
    region_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("text_regions.region_id", ondelete="CASCADE"), nullable=False)
    original_translation: Mapped[str] = mapped_column(Text, nullable=False)
    user_translation: Mapped[str] = mapped_column(Text, nullable=True)
    rating: Mapped[str] = mapped_column(String(10), nullable=True)
    correction_reason: Mapped[str] = mapped_column(Text, nullable=True)
    used_for_training: Mapped[bool] = mapped_column(Boolean, default=False)

    __table_args__ = (
        CheckConstraint("rating IN ('good','bad','neutral')", name="ck_feedback_rating"),
    )


class LearningProgress(BaseModel):
    __tablename__ = "learning_progress"

    progress_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False)
    vocab_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("vocabularies.vocab_id", ondelete="CASCADE"), nullable=True)
    review_count: Mapped[int] = mapped_column(Integer, default=0)
    last_review_at = mapped_column(DateTime(timezone=True), nullable=True)
    next_review_at = mapped_column(DateTime(timezone=True), nullable=True)
    mastery_level: Mapped[int] = mapped_column(Integer, default=1)
    streak_days: Mapped[int] = mapped_column(Integer, default=0)

    __table_args__ = (
        CheckConstraint("mastery_level >= 1 AND mastery_level <= 5", name="ck_learning_mastery"),
    )


class Achievement(BaseModel):
    __tablename__ = "achievements"

    achievement_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=True)
    icon_url: Mapped[str] = mapped_column(String(500), nullable=True)
    category: Mapped[str] = mapped_column(String(30), nullable=False)
    required_value: Mapped[int] = mapped_column(Integer, nullable=False)

    __table_args__ = (
        CheckConstraint("category IN ('translation','vocabulary','learning','streak','social')", name="ck_achievements_category"),
    )


class UserAchievement(BaseModel):
    __tablename__ = "user_achievements"

    user_achievement_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False)
    achievement_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("achievements.achievement_id", ondelete="CASCADE"), nullable=False)
    progress: Mapped[float] = mapped_column(Float, default=0)
    unlocked_at = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        CheckConstraint("progress >= 0 AND progress <= 1", name="ck_user_achievement_progress"),
    )
