from __future__ import annotations
"""
Translation engine router - intelligently selects the best engine for each text.
"""
import logging
import time
from typing import Dict, Any, Optional

from ..engines.base import TranslationEngine
from ..engines.basic_engine import BasicEngine
from ..engines.multimodal_engine import MultimodalEngine

logger = logging.getLogger(__name__)


class EngineRouter:
    """Routes ALL translation through MultimodalEngine (GPT-4o). No downgrade."""

    def __init__(self):
        self.multimodal_engine = MultimodalEngine()

    async def route(
        self,
        text: str,
        source_lang: str,
        target_lang: str,
        region_type: str = "speech",
        character_tone: str = "neutral",
        from_cache: bool = False,
        context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        if from_cache:
            return {"text": text, "engine_used": "cache", "from_cache": True}

        merged_context = {
            "region_type": region_type,
            "character_tone": character_tone,
        }
        if context:
            merged_context.update(context)

        # All text goes through MultimodalEngine (GPT-4o).
        # Vision mode for onomatopoeia/effect, text LLM for speech/thought/narration.
        # NO downgrade to DeepL/Google/Tencent — quality above all.
        engine = self.multimodal_engine

        logger.info(f"[ROUTER] engine={engine.get_engine_name()} text_len={len(text)} src={source_lang} tgt={target_lang} type={region_type}")
        t0 = time.time()
        translated = await engine.translate(
            text=text,
            source_lang=source_lang,
            target_lang=target_lang,
            context=merged_context,
        )
        logger.info(f"[ROUTER] done in {time.time()-t0:.2f}s result_len={len(translated)}")

        return {
            "text": translated,
            "engine_used": engine.get_engine_name(),
            "from_cache": False,
        }
