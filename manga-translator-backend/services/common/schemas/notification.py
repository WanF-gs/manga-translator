from __future__ import annotations
"""通知相关 Pydantic Schema"""
from typing import Optional, List
from pydantic import BaseModel, Field


class NotificationResponse(BaseModel):
    """通知响应"""
    notification_id: str
    user_id: str
    type: str
    title: str
    content: Optional[str] = None
    is_read: bool = False
    ref_type: Optional[str] = None
    ref_id: Optional[str] = None
    created_at: Optional[str] = None

    class Config:
        from_attributes = True


class NotificationListQuery(BaseModel):
    """通知列表查询参数"""
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=100)
    is_read: Optional[bool] = Field(None, description="已读/未读筛选")
    type: Optional[str] = Field(None, max_length=30, description="通知类型筛选")


class NotificationBatchRead(BaseModel):
    """批量标记已读请求"""
    notification_ids: Optional[List[str]] = Field(default=None, description="指定通知ID列表，不传则全部标为已读")


class UnreadCountResponse(BaseModel):
    """未读通知数量"""
    unread_count: int
