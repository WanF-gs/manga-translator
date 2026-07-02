from __future__ import annotations
"""
Style preset business logic.
"""
import uuid
from typing import Dict, Any, List, Optional

from sqlalchemy.ext.asyncio import AsyncSession

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from common.models.style_preset import StylePreset
from ..repository.preset_repo import PresetRepository


class PresetService:
    """Style preset CRUD service."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.repo = PresetRepository(db)

    async def list_presets(
        self,
        scope: str = "system",
        category: str = None,
        user_id: str = None,
    ) -> List[Dict[str, Any]]:
        """List style presets."""
        presets = await self.repo.list_presets(scope=scope, category=category, user_id=user_id)

        items = []
        for p in presets:
            items.append({
                "preset_id": str(p.preset_id),
                "name": p.name,
                "category": p.category,
                "scope": p.scope,
                "style_config": p.style_config,
            })
        return items

    async def create_preset(self, user_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a style preset."""
        preset = StylePreset(
            preset_id=uuid.uuid4(),
            user_id=user_id,
            project_id=data.get("project_id"),
            name=data.get("name", "New Preset"),
            category=data.get("category", "speech"),
            style_config=data.get("style_config", {}),
            scope=data.get("scope", "account"),
        )
        self.db.add(preset)
        await self.db.flush()

        return {
            "preset_id": str(preset.preset_id),
            "name": preset.name,
            "category": preset.category,
            "scope": preset.scope,
            "style_config": preset.style_config,
        }

    async def update_preset(self, preset_id: str, user_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Update a style preset."""
        preset = await self.repo.find_by_id(preset_id, user_id)
        if not preset:
            raise ValueError("Preset not found")

        if "name" in data:
            preset.name = data["name"]
        if "category" in data:
            preset.category = data["category"]
        if "style_config" in data:
            preset.style_config = data["style_config"]

        await self.db.flush()

        return {
            "preset_id": str(preset.preset_id),
            "name": preset.name,
            "category": preset.category,
            "style_config": preset.style_config,
        }

    async def delete_preset(self, preset_id: str, user_id: str) -> None:
        """Delete a style preset."""
        preset = await self.repo.find_by_id(preset_id, user_id)
        if not preset:
            raise ValueError("Preset not found")
        if preset.scope == "system":
            raise ValueError("Cannot delete system presets")
        await self.db.delete(preset)
        await self.db.flush()

    async def apply_preset(
        self, preset_id: str, user_id: str, region_ids: List[str]
    ) -> Dict[str, Any]:
        """Apply a style preset to specified text regions."""
        preset = await self.repo.find_by_id(preset_id, user_id)
        if not preset:
            raise ValueError("Preset not found")

        style_config = preset.style_config or {}
        updated = 0

        from ..repository.page_repo import PageRepository
        page_repo = PageRepository(self.db)

        for region_id in region_ids:
            region = await page_repo.find_region_by_id(region_id)
            if region:
                region.style_config = {**(region.style_config or {}), **style_config}
                updated += 1

        await self.db.flush()
        return {"applied_count": updated, "preset_name": preset.name}
