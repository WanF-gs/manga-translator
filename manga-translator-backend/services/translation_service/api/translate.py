from __future__ import annotations
"""
Translation API routes.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from common.core.database import get_db
from common.core.response import success_response, error_response
from common.core.security import get_current_user

from ..service.translation_service import TranslationService

router = APIRouter()


@router.post("/pages/{page_id}/translate")
async def translate_page(
    page_id: str,
    request_data: dict,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Translate all text regions on a page.

    Supports optional character_id for tone-consistent translation (P1 §2.13).
    When character_id is provided, the character's tone profile (tone_type, catchphrase,
    personality_desc) is injected into the translation context for cross-page consistency.
    """
    service = TranslationService(db)
    character_id = request_data.get("character_id")

    # P1-B: 拉取角色档案用于语气一致的翻译。仅使用 Character 真实存在的字段
    # （tone_type / catchphrase / honorific_level / custom_tone_params / gender）。
    character_profile = None
    if character_id:
        try:
            from common.models.character import Character
            from sqlalchemy import select as sa_select
            char = (await db.execute(
                sa_select(Character).where(Character.character_id == character_id)
            )).scalar_one_or_none()
            if char:
                character_profile = {
                    "name": char.name,
                    "tone_type": char.tone_type,
                    "catchphrase": char.catchphrase,
                    "honorific_level": char.honorific_level,
                    "custom_tone_params": char.custom_tone_params,
                    "gender": char.gender,
                }
        except Exception as e:
            import logging
            logging.getLogger(__name__).debug(f"Character profile lookup skipped: {e}")

    try:
        result = await service.translate_page(
            page_id=page_id,
            target_lang=request_data.get("target_lang", "zh-CN"),
            engine=request_data.get("engine", "auto"),
            onomatopoeia_mode=request_data.get("onomatopoeia_mode", "keep_annotation"),
            culture_strategy=request_data.get("culture_strategy", "localize"),
            character_profile=character_profile,
        )
        return success_response(data=result)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return error_response(code=3003, message=f"Translation failed: {str(e)}", status_code=500)
