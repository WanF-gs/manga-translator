from __future__ import annotations
"""
Preset repository.
"""
from typing import Optional, List

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from common.models.style_preset import StylePreset


class PresetRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def find_by_id(self, preset_id: str, user_id: str = None) -> Optional[StylePreset]:
        query = select(StylePreset).where(StylePreset.preset_id == preset_id)
        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    async def list_presets(
        self,
        scope: str = "system",
        category: str = None,
        user_id: str = None,
    ) -> List[StylePreset]:
        conditions = []
        if scope == "system":
            conditions.append(StylePreset.scope == "system")
        elif scope == "account" and user_id:
            conditions.append(StylePreset.scope.in_(["system", "account"]))
            conditions.append(
                (StylePreset.user_id == user_id) | (StylePreset.scope == "system")
            )

        if category:
            conditions.append(StylePreset.category == category)

        query = select(StylePreset).where(*conditions) if conditions else select(StylePreset)
        result = await self.db.execute(query)
        return result.scalars().all()
