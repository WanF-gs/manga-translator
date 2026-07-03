"""
Achievement auto-unlock checker.
Called from vocab extraction and learning progress update to check/unlock achievements.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


async def check_and_unlock_achievements(
    db: AsyncSession,
    user_id: uuid.UUID,
    category: Optional[str] = None,
):
    """
    Check and unlock achievements for a user.

    Args:
        db: Database session
        user_id: User UUID
        category: Optional category to check (if None, check all categories)
    """
    try:
        from common.models.v3_models import Achievement, UserAchievement, LearningProgress
        from common.models.vocabulary import Vocabulary

        # Get all achievements (optionally filtered by category)
        query = select(Achievement)
        if category:
            query = query.where(Achievement.category == category)
        all_achievements = (await db.execute(query)).scalars().all()

        if not all_achievements:
            return

        # Get current user stats
        # Total translations (count learning_progress review_count > 0)
        total_reviews_result = await db.execute(
            select(func.count(LearningProgress.progress_id))
            .where(LearningProgress.user_id == user_id)
        )
        total_reviews = total_reviews_result.scalar() or 0

        # Total vocabulary
        total_vocab_result = await db.execute(
            select(func.count(Vocabulary.vocab_id))
            .where(Vocabulary.user_id == user_id)
        )
        total_vocab = total_vocab_result.scalar() or 0

        # Streak days (max streak_days from learning_progress)
        streak_result = await db.execute(
            select(func.max(LearningProgress.streak_days))
            .where(LearningProgress.user_id == user_id)
        )
        max_streak = streak_result.scalar() or 0

        # Get existing user achievements
        existing = {
            str(ua.achievement_id): ua
            for ua in (
                await db.execute(
                    select(UserAchievement).where(
                        UserAchievement.user_id == user_id
                    )
                )
            ).scalars().all()
        }

        now = datetime.now(timezone.utc)
        newly_unlocked = 0

        for ach in all_achievements:
            ach_id_str = str(ach.achievement_id)
            ua = existing.get(ach_id_str)

            # Calculate progress
            target = ach.required_value or 1
            current_value = _get_current_value(ach.category, total_vocab, total_reviews, max_streak)
            progress = min(1.0, current_value / target)

            is_completed = current_value >= target

            if ua is None:
                # Create new user achievement record
                ua = UserAchievement(
                    user_id=user_id,
                    achievement_id=ach.achievement_id,
                    progress=progress,
                    unlocked_at=now if is_completed else None,
                )
                db.add(ua)
                if is_completed:
                    newly_unlocked += 1
                    logger.info(
                        f"[Achievement] Unlocked '{ach.name}' for user={user_id} "
                        f"({ach.category}: {current_value}/{target})"
                    )
            else:
                # Update existing record
                ua.progress = progress
                if is_completed and ua.unlocked_at is None:
                    ua.unlocked_at = now
                    newly_unlocked += 1
                    logger.info(
                        f"[Achievement] Unlocked '{ach.name}' for user={user_id} "
                        f"({ach.category}: {current_value}/{target})"
                    )

        if newly_unlocked > 0:
            await db.flush()
            logger.info(
                f"[Achievement] User={user_id}: {newly_unlocked} new achievement(s) unlocked"
            )

    except Exception as e:
        logger.warning(f"[Achievement] check failed: {e}", exc_info=True)


def _get_current_value(category: str, total_vocab: int, total_reviews: int, max_streak: int) -> int:
    """Get the user's current value for a given achievement category."""
    mapping = {
        "vocabulary": total_vocab,
        "translation": total_reviews,
        "streak": max_streak,
        "learning": total_reviews,
        "social": 0,  # Social features not implemented yet
    }
    return mapping.get(category, 0)
