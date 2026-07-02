from __future__ import annotations
"""导出相关 Pydantic Schema"""
from typing import Optional, List
from pydantic import BaseModel, Field


class ExportTaskCreate(BaseModel):
    """创建导出任务请求"""
    project_id: str = Field(..., description="项目ID")
    chapter_ids: Optional[List[str]] = Field(default=None, description="指定章节ID列表，不传则导出全部")
    format: str = Field(default="png", max_length=10, description="导出格式: png/jpg/webp/pdf/cbz/zip")
    quality: int = Field(default=90, ge=1, le=100, description="图片质量 (1-100)")
    resolution: str = Field(default="original", max_length=10, description="分辨率: original/hd/2k/4k")
    bilingual_mode: Optional[str] = Field(None, max_length=20, description="双语模式: overunder/side_by_side/alternate")
    naming_rule: Optional[str] = Field(None, max_length=200, description="文件命名规则")
    export_original: bool = Field(default=False, description="是否同时导出原文版本")
    export_edited: bool = Field(default=True, description="是否导出翻译后版本")


class ExportTaskUpdate(BaseModel):
    """更新导出任务（管理员操作）"""
    status: Optional[str] = Field(None, max_length=20, description="状态: queued/processing/completed/failed")
    progress: Optional[float] = Field(None, ge=0, le=100)
    result_url: Optional[str] = Field(None, max_length=500)
    error_msg: Optional[str] = None


class ExportTaskResponse(BaseModel):
    """导出任务响应"""
    task_id: str
    user_id: str
    project_id: str
    chapter_ids: List[str] = []
    format: str = "png"
    quality: int = 90
    resolution: str = "original"
    bilingual_mode: Optional[str] = None
    naming_rule: Optional[str] = None
    status: str = "queued"
    progress: float = 0.0
    result_url: Optional[str] = None
    error_msg: Optional[str] = None
    completed_at: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

    class Config:
        from_attributes = True


class ExportTaskQuery(BaseModel):
    """导出任务列表查询"""
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=100)
    status: Optional[str] = Field(None, max_length=20, description="状态筛选")
    project_id: Optional[str] = Field(None, description="按项目筛选")


class ExportBatchRequest(BaseModel):
    """批量导出请求"""
    project_id: str = Field(..., description="项目ID")
    chapter_ids: Optional[List[str]] = Field(default=None)
    formats: List[str] = Field(default=["png"], description="导出格式列表")
