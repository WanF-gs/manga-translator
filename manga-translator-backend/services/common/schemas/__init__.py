from __future__ import annotations
"""Pydantic 数据校验模型"""
from .auth import (
    RegisterRequest,
    LoginRequest,
    RefreshRequest,
    TokenResponse,
    UserInfo,
    AuthResponse,
)
from .project import (
    ProjectCreate,
    ProjectUpdate,
    ProjectResponse,
    ProjectListQuery,
    ProjectBatchRequest,
)
from .chapter import (
    ChapterCreate,
    ChapterUpdate,
    ChapterResponse,
    ChapterReorder,
    ChapterListQuery,
)
from .page import (
    PageResponse,
    PageListQuery,
    RegionUpdateRequest,
)
from .region import (
    TextRegionCreate,
    TextRegionUpdate,
    TextRegionResponse,
)
from .term import (
    TermCreate,
    TermUpdate,
    TermResponse,
    TermListQuery,
    TermMatchRequest,
)
from .preset import (
    PresetCreate,
    PresetUpdate,
    PresetResponse,
    PresetListQuery,
)
from .export import (
    ExportTaskCreate,
    ExportTaskUpdate,
    ExportTaskResponse,
    ExportTaskQuery,
)
from .vocabulary import (
    VocabularyCreate,
    VocabularyUpdate,
    VocabularyResponse,
    VocabularyListQuery,
    VocabReviewRequest,
)
from .notification import (
    NotificationResponse,
    NotificationListQuery,
    NotificationBatchRead,
)

__all__ = [
    # auth
    "RegisterRequest", "LoginRequest", "RefreshRequest",
    "TokenResponse", "UserInfo", "AuthResponse",
    # project
    "ProjectCreate", "ProjectUpdate", "ProjectResponse",
    "ProjectListQuery", "ProjectBatchRequest",
    # chapter
    "ChapterCreate", "ChapterUpdate", "ChapterResponse",
    "ChapterReorder", "ChapterListQuery",
    # page
    "PageResponse", "PageListQuery", "RegionUpdateRequest",
    # region
    "TextRegionCreate", "TextRegionUpdate", "TextRegionResponse",
    # term
    "TermCreate", "TermUpdate", "TermResponse",
    "TermListQuery", "TermMatchRequest",
    # preset
    "PresetCreate", "PresetUpdate", "PresetResponse", "PresetListQuery",
    # export
    "ExportTaskCreate", "ExportTaskUpdate", "ExportTaskResponse", "ExportTaskQuery",
    # vocabulary
    "VocabularyCreate", "VocabularyUpdate", "VocabularyResponse",
    "VocabularyListQuery", "VocabReviewRequest",
    # notification
    "NotificationResponse", "NotificationListQuery", "NotificationBatchRead",
]
