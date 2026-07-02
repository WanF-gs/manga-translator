from __future__ import annotations
"""术语相关 Pydantic Schema"""
from typing import Optional
from pydantic import BaseModel, Field


class TermCreate(BaseModel):
    """创建术语请求"""
    source_text: str = Field(..., min_length=1, max_length=500, description="源文本")
    target_text: str = Field(..., min_length=1, max_length=500, description="目标文本")
    note: Optional[str] = Field(None, description="备注说明")
    category: Optional[str] = Field(None, max_length=50, description="分类")
    scope: str = Field(default="account", max_length=20, description="作用范围: account/project/system")


class TermUpdate(BaseModel):
    """更新术语请求"""
    source_text: Optional[str] = Field(None, min_length=1, max_length=500)
    target_text: Optional[str] = Field(None, min_length=1, max_length=500)
    note: Optional[str] = None
    category: Optional[str] = Field(None, max_length=50)
    scope: Optional[str] = Field(None, max_length=20)


class TermResponse(BaseModel):
    """术语响应"""
    term_id: str
    user_id: str
    project_id: Optional[str] = None
    source_text: str
    target_text: str
    note: Optional[str] = None
    category: Optional[str] = None
    scope: str = "account"
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

    class Config:
        from_attributes = True


class TermListQuery(BaseModel):
    """术语列表查询参数"""
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=30, ge=1, le=200)
    search: Optional[str] = Field(None, max_length=500, description="搜索关键词")
    category: Optional[str] = Field(None, max_length=50, description="分类筛选")
    scope: Optional[str] = Field(None, max_length=20, description="范围筛选")


class TermMatchRequest(BaseModel):
    """术语匹配请求"""
    text: str = Field(..., min_length=1, description="要匹配的文本")
    project_id: Optional[str] = Field(None, description="项目ID，用于项目级术语匹配")
