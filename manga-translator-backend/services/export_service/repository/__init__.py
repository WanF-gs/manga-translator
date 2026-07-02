from __future__ import annotations
"""导出任务数据访问层 — 真实 DB 持久化实现（v3.0）"""
from sqlalchemy.ext.asyncio import AsyncSession


class ExportRepo:
    """导出任务仓库 — 基于 SQLAlchemy 的真实数据库仓库（已从 Mock 升级）。"""

    def __init__(self, db: AsyncSession):
        self.db = db
