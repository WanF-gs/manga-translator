from __future__ import annotations
"""
Translation API routes.
"""
import logging
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from common.core.database import get_db
from common.core.response import success_response, error_response
from common.core.security import get_current_user

from ..service.translation_service import TranslationService

logger = logging.getLogger(__name__)
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
        requested_target_lang = request_data.get("target_lang", "zh-CN")
        logger.info(f"[translate] page_id={page_id}, target_lang={requested_target_lang}, engine={request_data.get('engine', 'auto')}")
        if requested_target_lang == "zh-CN":
            logger.warning(f"[translate] target_lang is zh-CN (可能是默认值或用户选择), 请确认: request_data keys={list(request_data.keys())}")
        result = await service.translate_page(
            page_id=page_id,
            target_lang=requested_target_lang,
            engine=request_data.get("engine", "auto"),
            onomatopoeia_mode=request_data.get("onomatopoeia_mode", "keep_annotation"),
            culture_strategy=request_data.get("culture_strategy", "localize"),
            character_profile=character_profile,
        )

        # §3.0 词汇自动收集：同步翻译路径也提取生词
        # 之前的实现只在 Celery 流水线（run_pipeline_for_page）中调用，
        # 导致"逐页同步翻译"流程的页面从未写入 vocabularies，学习中心始终 0 词汇。
        try:
            from common.models.page import Page
            from sqlalchemy import select as sa_select
            page_row = (await db.execute(
                sa_select(Page).where(Page.page_id == page_id)
            )).scalar_one_or_none()
            if page_row:
                # 通过 chapter 获取 project 的 source_lang
                from common.models.chapter import Chapter
                from common.models.project import Project
                ch = (await db.execute(
                    sa_select(Chapter).where(Chapter.chapter_id == page_row.chapter_id)
                )).scalar_one_or_none()
                project_source_lang = "ja"
                if ch:
                    proj = (await db.execute(
                        sa_select(Project).where(Project.project_id == ch.project_id)
                    )).scalar_one_or_none()
                    if proj and proj.source_lang:
                        project_source_lang = proj.source_lang

                user_id = current_user.get("sub") if isinstance(current_user, dict) else None
                if user_id:
                    from common.tasks.vocab_extractor import extract_vocabulary_from_page
                    new_count = await extract_vocabulary_from_page(
                        db=db,
                        page_id=page_id,
                        user_id=user_id,
                        source_lang=project_source_lang,
                    )
                    if new_count > 0:
                        logger.info(f"[translate] VocabExtract: page={page_id} +{new_count} new words")
                    # 提交词汇写入（独立事务，不影响翻译结果回滚）
                    await db.commit()
        except Exception as vocab_err:
            logger.warning(f"[translate] VocabExtract failed (non-fatal): {vocab_err}", exc_info=True)

        return success_response(data=result)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return error_response(code=3003, message=f"Translation failed: {str(e)}", status_code=500)
