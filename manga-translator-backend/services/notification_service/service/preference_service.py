from __future__ import annotations
"""
通知偏好持久化服务

将通知偏好从内存字典迁移到 users.settings JSONB 字段。
读取路径: users.settings -> notification
写入路径: users.settings = jsonb_set(settings, '{notification}', ...)
"""
import logging
from typing import Optional

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.dialects.postgresql import UUID

logger = logging.getLogger(__name__)

# 默认偏好设置
DEFAULT_PREFERENCES = {
    "email_export_complete": True,
    "email_batch_complete": True,
    "email_system_notice": True,
    "web_push_enabled": True,
    "web_push_export": True,
    "web_push_translation": True,
    "in_app_export": True,
    "in_app_translation": True,
    "in_app_system": True,
    "quiet_hours_enabled": False,
    "quiet_hours_start": "22:00",
    "quiet_hours_end": "08:00",
}


class PreferenceService:
    """通知偏好持久化服务（基于 users.settings JSONB）"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_preferences(self, user_id: str) -> dict:
        """
        从 users.settings->'notification' 读取偏好。
        如果不存在则返回默认值并写入数据库。
        """
        from common.models.user import User
        import uuid as _uuid

        result = await self.db.execute(
            select(User.settings).where(User.user_id == _uuid.UUID(user_id))
        )
        row = result.scalar_one_or_none()

        if row is None:
            # 用户不存在，返回默认值
            return dict(DEFAULT_PREFERENCES)

        settings_data = row or {}
        notification_prefs = settings_data.get("notification")

        if notification_prefs and isinstance(notification_prefs, dict):
            # 合并默认值，确保所有字段都存在
            merged = dict(DEFAULT_PREFERENCES)
            merged.update(notification_prefs)
            return merged

        # 没有偏好记录，写入默认值
        merged = dict(DEFAULT_PREFERENCES)
        await self._save_preferences(user_id, merged)
        return merged

    async def update_preferences(self, user_id: str, preferences: dict) -> dict:
        """
        更新通知偏好到 users.settings->'notification'。
        使用 jsonb_set 原子操作避免并发覆盖。
        """
        import uuid as _uuid
        import json

        # 合并传入值与默认值（只更新提供的字段）
        current = await self.get_preferences(user_id)
        merged = dict(DEFAULT_PREFERENCES)
        merged.update(current)
        merged.update(preferences)

        # 使用 jsonb_set 写入
        from sqlalchemy import text

        await self.db.execute(
            text(
                "UPDATE users SET settings = "
                "COALESCE(jsonb_set(settings, '{notification}', :prefs::jsonb), "
                "jsonb_build_object('notification', :prefs::jsonb)) "
                "WHERE user_id = :uid"
            ),
            {
                "prefs": json.dumps(merged),
                "uid": _uuid.UUID(user_id),
            },
        )
        await self.db.commit()

        logger.info(f"Notification preferences updated for user {user_id}")
        return merged

    async def _save_preferences(self, user_id: str, preferences: dict) -> None:
        """内部方法：直接写入偏好"""
        import uuid as _uuid
        import json
        from sqlalchemy import text

        await self.db.execute(
            text(
                "UPDATE users SET settings = "
                "COALESCE(jsonb_set(settings, '{notification}', :prefs::jsonb), "
                "jsonb_build_object('notification', :prefs::jsonb)) "
                "WHERE user_id = :uid"
            ),
            {
                "prefs": json.dumps(preferences),
                "uid": _uuid.UUID(user_id),
            },
        )
        await self.db.commit()

    async def migrate_memory_to_db(self, memory_store: dict) -> int:
        """
        一次性迁移：将内存中的偏好数据迁移到数据库。
        返回成功迁移的用户数。
        """
        migrated = 0
        for user_id, prefs in memory_store.items():
            try:
                await self.update_preferences(user_id, prefs)
                migrated += 1
            except Exception as e:
                logger.warning(f"Failed to migrate preferences for user {user_id}: {e}")

        if migrated > 0:
            logger.info(f"Migrated {migrated} user preferences from memory to database")
        return migrated
