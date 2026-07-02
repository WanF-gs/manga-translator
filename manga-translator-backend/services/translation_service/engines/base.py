from __future__ import annotations
"""
Abstract base class for translation engines.
"""
from abc import ABC, abstractmethod
from typing import Dict, Any, Optional


class TranslationEngine(ABC):
    """Abstract translation engine interface."""

    @abstractmethod
    async def translate(
        self,
        text: str,
        source_lang: str,
        target_lang: str,
        context: Optional[Dict[str, Any]] = None,
    ) -> str:
        """
        Translate text from source language to target language.

        Args:
            text: Source text to translate
            source_lang: Source language code (ja, zh, en, ko)
            target_lang: Target language code
            context: Optional context (surrounding regions, image description, etc.)

        Returns:
            Translated text
        """
        pass

    @abstractmethod
    def get_engine_name(self) -> str:
        """Return the engine identifier name."""
        pass
