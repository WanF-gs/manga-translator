from __future__ import annotations
"""章节相关 Pydantic Schema"""
from typing import Optional, List
from pydantic import BaseModel, Field


class ChapterCreate(BaseModel):
    """创建章节请求"""
    name: str = Field(..., min_length=1, max_length=200, description="章节名称")
    sort_order: Optional[int] = Field(default=0, ge=0, description="排序序号")


class ChapterUpdate(BaseModel):
    """更新章节请求"""
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    sort_order: Optional[int] = Field(None, ge=0)


class ChapterReorder(BaseModel):
    """章节重新排序请求"""
    chapter_id: str = Field(..., description="章节ID")
    new_sort_order: int = Field(..., ge=0, description="新排序序号")


class ChapterBatchReorder(BaseModel):
    """批量重新排序请求"""
    orders: List[ChapterReorder] = Field(..., min_length=1, description="排序列表")


class ChapterResponse(BaseModel):
    """章节响应"""
    chapter_id: str
    project_id: str
    name: str
    sort_order: int = 0
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    page_count: Optional[int] = Field(default=0, description="页面数量")

    class Config:
        from_attributes = True


class ChapterListQuery(BaseModel):
    """章节列表查询参数"""
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=50, ge=1, le=200)
    sort_order: Optional[str] = Field(default="asc", description="排序: asc/desc")
