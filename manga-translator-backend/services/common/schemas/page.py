from __future__ import annotations
"""页面相关 Pydantic Schema"""
from typing import Optional, List
from pydantic import BaseModel, Field


class PageResponse(BaseModel):
    """页面响应"""
    page_id: str
    chapter_id: str
    original_url: str
    processed_url: Optional[str] = None
    thumbnail_url: Optional[str] = None
    sort_order: int = 0
    status: str = "pending"
    width: int = 0
    height: int = 0
    file_size: int = 0
    ocr_result: Optional[dict] = None
    translation_result: Optional[dict] = None
    preprocessing_result: Optional[dict] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    regions: Optional[List["TextRegionResponse"]] = Field(default=[], description="文字区域列表")

    class Config:
        from_attributes = True


class PageListQuery(BaseModel):
    """页面列表查询参数"""
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=30, ge=1, le=200)
    status: Optional[str] = Field(None, description="状态筛选: pending/processing/completed/failed")


class RegionUpdateRequest(BaseModel):
    """页面文字区域批量更新请求"""
    regions: List[dict] = Field(..., min_length=1, description="更新后的区域列表")
    target_lang: Optional[str] = Field(None, max_length=10, description="目标语言")

    class Config:
        json_schema_extra = {
            "example": {
                "regions": [
                    {
                        "region_id": "uuid",
                        "type": "bubble",
                        "boundary": {"x": 100, "y": 200, "width": 300, "height": 80},
                        "original_text": "こんにちは",
                        "translated_text": "你好",
                        "style_config": {"font": "SourceHanSans", "size": 14, "color": "#000000"}
                    }
                ],
                "target_lang": "zh-CN"
            }
        }


class PageTranslateRequest(BaseModel):
    """翻译页面请求"""
    target_lang: str = Field(..., min_length=1, max_length=10, description="目标语言")


class PageProcessRequest(BaseModel):
    """页面处理请求（检测+OCR+翻译+渲染 全链路）"""
    target_lang: str = Field(..., min_length=1, max_length=10, description="目标语言")
    engine_type: Optional[str] = Field(default="auto", description="翻译引擎: auto/basic/multimodal")
