from __future__ import annotations
"""样式预设相关 Pydantic Schema"""
from typing import Optional
from pydantic import BaseModel, Field


class PresetCreate(BaseModel):
    """创建样式预设请求"""
    name: str = Field(..., min_length=1, max_length=100, description="预设名称")
    category: str = Field(..., max_length=20, description="预设类别: font/color/layout/bubble")
    style_config: dict = Field(..., description="样式配置JSON")
    scope: str = Field(default="system", max_length=20, description="作用范围: system/account/project")
    project_id: Optional[str] = Field(None, description="关联项目ID")


class PresetUpdate(BaseModel):
    """更新样式预设请求"""
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    category: Optional[str] = Field(None, max_length=20)
    style_config: Optional[dict] = None
    scope: Optional[str] = Field(None, max_length=20)


class PresetResponse(BaseModel):
    """样式预设响应"""
    preset_id: str
    user_id: Optional[str] = None
    project_id: Optional[str] = None
    name: str
    category: str
    style_config: dict
    scope: str = "system"
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

    class Config:
        from_attributes = True


class PresetListQuery(BaseModel):
    """样式预设列表查询参数"""
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=50, ge=1, le=200)
    category: Optional[str] = Field(None, max_length=20, description="类别筛选")
    scope: Optional[str] = Field(None, max_length=20, description="范围筛选")
