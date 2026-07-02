from __future__ import annotations
"""文字区域相关 Pydantic Schema"""
from typing import Optional
from pydantic import BaseModel, Field


class TextRegionCreate(BaseModel):
    """创建文字区域请求"""
    type: str = Field(..., max_length=20, description="区域类型: bubble/sfx/thought/caption/narrative")
    boundary: dict = Field(..., description="边界框: {x, y, width, height}")
    original_text: Optional[str] = Field(None, description="原始文字")
    style_config: Optional[dict] = Field(None, description="样式配置")
    sort_order: int = Field(default=0, ge=0, description="排序序号")


class TextRegionUpdate(BaseModel):
    """更新文字区域请求"""
    type: Optional[str] = Field(None, max_length=20)
    boundary: Optional[dict] = None
    original_text: Optional[str] = None
    translated_text: Optional[str] = None
    confidence: Optional[float] = Field(None, ge=0, le=1)
    is_locked: Optional[bool] = None
    style_config: Optional[dict] = None
    sort_order: Optional[int] = Field(None, ge=0)


class TextRegionResponse(BaseModel):
    """文字区域响应"""
    region_id: str
    page_id: str
    type: str
    boundary: dict
    original_text: Optional[str] = None
    translated_text: Optional[str] = None
    confidence: Optional[float] = None
    is_locked: bool = False
    style_config: Optional[dict] = None
    sort_order: int = 0
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

    class Config:
        from_attributes = True
