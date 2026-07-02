from __future__ import annotations
"""项目相关 Pydantic Schema"""
from typing import Optional, List
from pydantic import BaseModel, Field


class ProjectCreate(BaseModel):
    """创建项目请求"""
    name: str = Field(..., min_length=1, max_length=200, description="作品名称")
    source_lang: str = Field(..., min_length=1, max_length=10, description="源语言")
    cover_url: Optional[str] = Field(None, max_length=500, description="封面URL")


class ProjectUpdate(BaseModel):
    """更新项目请求"""
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    source_lang: Optional[str] = Field(None, min_length=1, max_length=10)
    cover_url: Optional[str] = Field(None, max_length=500)
    is_favorite: Optional[bool] = None
    status: Optional[str] = Field(None, max_length=20)


class ProjectResponse(BaseModel):
    """项目响应"""
    project_id: str
    user_id: str
    name: str
    source_lang: str
    cover_url: Optional[str] = None
    is_favorite: bool = False
    status: str = "active"
    trashed_at: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    chapter_count: Optional[int] = Field(default=0, description="章节数量")

    class Config:
        from_attributes = True


class ProjectListQuery(BaseModel):
    """项目列表查询参数"""
    page: int = Field(default=1, ge=1, description="页码")
    page_size: int = Field(default=20, ge=1, le=100, description="每页条数")
    status: Optional[str] = Field(None, description="状态筛选: active/trashed")
    search: Optional[str] = Field(None, max_length=200, description="名称搜索")
    sort_by: Optional[str] = Field(default="created_at", description="排序字段")
    sort_order: Optional[str] = Field(default="desc", description="排序方向: asc/desc")


class ProjectBatchRequest(BaseModel):
    """批量操作请求"""
    project_ids: List[str] = Field(..., min_length=1, description="项目ID列表")
