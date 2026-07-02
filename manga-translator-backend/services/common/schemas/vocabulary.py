from __future__ import annotations
"""生词本相关 Pydantic Schema"""
from typing import Optional
from pydantic import BaseModel, Field


class VocabularyCreate(BaseModel):
    """创建生词请求"""
    word: str = Field(..., min_length=1, max_length=200, description="生词")
    language: str = Field(..., min_length=1, max_length=10, description="语言")
    definition: Optional[str] = Field(None, description="释义")
    part_of_speech: Optional[str] = Field(None, max_length=50, description="词性")
    example_sentence: Optional[str] = Field(None, description="例句")
    source_project_id: Optional[str] = Field(None, description="来源项目ID")


class VocabularyUpdate(BaseModel):
    """更新生词请求"""
    word: Optional[str] = Field(None, min_length=1, max_length=200)
    language: Optional[str] = Field(None, min_length=1, max_length=10)
    definition: Optional[str] = None
    part_of_speech: Optional[str] = Field(None, max_length=50)
    example_sentence: Optional[str] = None


class VocabularyResponse(BaseModel):
    """生词响应"""
    vocab_id: str
    user_id: str
    word: str
    language: str
    definition: Optional[str] = None
    part_of_speech: Optional[str] = None
    example_sentence: Optional[str] = None
    source_project_id: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

    class Config:
        from_attributes = True


class VocabularyListQuery(BaseModel):
    """生词列表查询参数"""
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=30, ge=1, le=200)
    language: Optional[str] = Field(None, max_length=10, description="语言筛选")
    search: Optional[str] = Field(None, max_length=200, description="搜索关键词")
    sort_by: Optional[str] = Field(default="created_at", description="排序字段")
    sort_order: Optional[str] = Field(default="desc", description="排序: asc/desc")


class VocabReviewRequest(BaseModel):
    """生词复习请求"""
    vocab_id: str = Field(..., description="生词ID")
    remembered: bool = Field(default=True, description="是否记住")


class VocabBatchAddRequest(BaseModel):
    """批量添加生词请求"""
    words: list[VocabularyCreate] = Field(..., min_length=1, description="生词列表")
