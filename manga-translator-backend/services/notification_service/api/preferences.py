from __future__ import annotations
"""
通知偏好设置 API — 数据库持久化版本

GET  /api/v1/notification-preferences  — 获取通知偏好
PUT  /api/v1/notification-preferences  — 更新通知偏好

偏好数据存储在 users.settings JSONB 字段的 'notification' 子对象中。
服务重启不丢失，支持多设备同步。
"""
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from typing import Optional

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from common.core.database import get_db
from common.core.response import success_response, error_response
from common.core.security import get_current_user

from ..service.preference_service import PreferenceService

router = APIRouter(prefix="/api/v1/notification-preferences", tags=["Notification Preferences"])


class NotificationPreferences(BaseModel):
    """通知偏好设置"""
    email_export_complete: bool = Field(default=True, description="导出完成邮件通知")
    email_batch_complete: bool = Field(default=True, description="批量任务完成邮件通知")
    email_system_notice: bool = Field(default=True, description="系统公告邮件通知")

    web_push_enabled: bool = Field(default=True, description="浏览器推送通知")
    web_push_export: bool = Field(default=True, description="导出进度推送")
    web_push_translation: bool = Field(default=True, description="翻译进度推送")

    in_app_export: bool = Field(default=True, description="站内导出通知")
    in_app_translation: bool = Field(default=True, description="站内翻译通知")
    in_app_system: bool = Field(default=True, description="站内系统通知")

    quiet_hours_enabled: bool = Field(default=False, description="免打扰时段")
    quiet_hours_start: Optional[str] = Field(default="22:00", description="免打扰开始 (HH:MM)")
    quiet_hours_end: Optional[str] = Field(default="08:00", description="免打扰结束 (HH:MM)")


@router.get("")
async def get_preferences(
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """获取当前用户的通知偏好设置（从数据库读取）"""
    user_id = current_user["sub"]
    service = PreferenceService(db)

    try:
        prefs = await service.get_preferences(user_id)
        return success_response(data=prefs)
    except Exception as e:
        return error_response(code=5000, message=f"读取偏好失败: {str(e)}")


@router.put("")
async def update_preferences(
    preferences: NotificationPreferences,
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """更新通知偏好设置（持久化到数据库）"""
    user_id = current_user["sub"]
    service = PreferenceService(db)

    try:
        # 只提交非 None 的字段
        update_data = preferences.dict(exclude_unset=False)
        result = await service.update_preferences(user_id, update_data)
        return success_response(
            data=result,
            message="通知偏好已更新并持久化"
        )
    except Exception as e:
        return error_response(code=5000, message=f"更新偏好失败: {str(e)}")
