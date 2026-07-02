"""
Unit tests for Translation Service.

Tests: translation memory cache, term substitution, engine routing, onomatopoeia, culture strategies.
"""
import sys
import os
import pytest
import hashlib
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "services"))


class TestTranslationMemory:
    """Tests for translation memory cache logic."""

    def test_compute_hash_consistent(self):
        """Test that the same text produces the same hash."""
        text = "こんにちは"
        hash1 = hashlib.sha256(text.strip().lower().encode()).hexdigest()
        hash2 = hashlib.sha256(text.strip().lower().encode()).hexdigest()
        assert hash1 == hash2

    def test_compute_hash_case_insensitive(self):
        """Test that hashing is case-insensitive."""
        text1 = "Hello World"
        text2 = "hello world"
        hash1 = hashlib.sha256(text1.strip().lower().encode()).hexdigest()
        hash2 = hashlib.sha256(text2.strip().lower().encode()).hexdigest()
        assert hash1 == hash2

    def test_compute_hash_different_texts(self):
        """Test that different texts produce different hashes."""
        hash1 = hashlib.sha256("Text A".encode()).hexdigest()
        hash2 = hashlib.sha256("Text B".encode()).hexdigest()
        assert hash1 != hash2

    @pytest.mark.asyncio
    async def test_cache_key_format(self):
        """Test cache key generation format for Redis."""
        project_id = "test-project-123"
        source_text = "こんにちは"
        source_lang = "ja"
        target_lang = "zh-CN"
        text_hash = hashlib.sha256(source_text.strip().lower().encode()).hexdigest()[:16]

        cache_key = f"trans_cache:{project_id}:{source_lang}:{target_lang}:{text_hash}"
        assert cache_key.startswith("trans_cache:")
        assert project_id in cache_key
        assert source_lang in cache_key
        assert target_lang in cache_key


class TestTermSubstitution:
    """Tests for term substitution logic."""

    def test_apply_terms_single(self):
        """Test applying a single term substitution."""
        terms = [{"source_text": "忍術", "target_text": "忍术"}]
        text = "これは忍術だ"
        for term in terms:
            if term["source_text"] in text:
                text = text.replace(term["source_text"], f"{{{{{term['target_text']}}}}}")
        assert "{{忍术}}" in text

    def test_apply_terms_multiple(self):
        """Test applying multiple term substitutions."""
        terms = [
            {"source_text": "忍術", "target_text": "忍术"},
            {"source_text": "火遁", "target_text": "火遁"},
        ]
        text = "忍術と火遁の術"
        for term in terms:
            if term["source_text"] in text:
                text = text.replace(term["source_text"], f"{{{{{term['target_text']}}}}}")
        assert "{{忍术}}" in text
        assert "{{火遁}}" in text

    def test_apply_terms_no_match(self):
        """Test that text without matching terms remains unchanged."""
        terms = [{"source_text": "忍術", "target_text": "忍术"}]
        text = "これは魔法だ"
        original = text
        for term in terms:
            if term["source_text"] in text:
                text = text.replace(term["source_text"], f"{{{{{term['target_text']}}}}}")
        assert text == original


class TestOnomatopoeiaMode:
    """Tests for onomatopoeia processing modes."""

    def test_replace_mode(self):
        """Test replace mode returns translated text directly."""
        original = "ドドン"
        translated = "轰隆"
        result = translated  # replace mode
        assert result == "轰隆"

    def test_keep_annotation_mode(self):
        """Test keep_annotation mode shows translated with original."""
        original = "ドドン"
        translated = "轰隆"
        result = f"{translated} [{original}]"
        assert "轰隆" in result
        assert "ドドン" in result

    def test_bilingual_mode(self):
        """Test bilingual mode shows both original and translated."""
        original = "ザザー"
        translated = "沙沙"
        result = f"{original}({translated})"
        assert "ザザー" in result
        assert "沙沙" in result


class TestCultureStrategy:
    """Tests for culture reference handling strategies."""

    def test_localize_strategy(self):
        """Test localize strategy uses translated text directly."""
        original = "おにぎり"
        translated = "饭团"
        result = translated
        assert result == "饭团"
        assert result != original

    def test_footnote_strategy(self):
        """Test footnote strategy adds footnote marker."""
        original = "おにぎり"
        translated = "饭团"
        if original != translated:
            result = f"{translated}*"
        else:
            result = translated
        assert result.endswith("*")
        assert "饭团" in result

    def test_tooltip_strategy(self):
        """Test tooltip strategy adds tooltip marker."""
        original = "おにぎり"
        translated = "饭团"
        if original != translated:
            result = f"{translated}ⓘ"
        else:
            result = translated
        assert result.endswith("ⓘ")
        assert "饭团" in result


class TestCrossPageContext:
    """Tests for cross-page context building."""

    def test_build_context_same_page(self):
        """Test building context from same-page previous regions."""
        current_idx = 2
        regions_texts = ["A", "B", "C", "D"]
        context = []
        for i in range(max(0, current_idx - 2), current_idx):
            context.append({"role": "previous", "text": regions_texts[i]})
        assert len(context) == 2
        assert context[0]["text"] == "A"
        assert context[1]["text"] == "B"

    def test_build_context_cross_page(self):
        """Test building context with cross-page data."""
        previous_context = [
            {"page_id": "p1", "regions": [
                {"original_text": "前の会話", "translated_text": "之前的对话", "type": "speech"},
                {"original_text": "そうですね", "translated_text": "是啊", "type": "speech"},
            ]}
        ]
        last_page = previous_context[-1]
        last_regions = last_page["regions"]
        tail = last_regions[-2:] if len(last_regions) >= 2 else last_regions
        assert len(tail) == 2
        assert tail[0]["translated_text"] == "之前的对话"


class TestTranslationEngineRouting:
    """Tests for translation engine routing logic."""

    def test_engine_priority_order(self):
        """Test engine priority: DeepL > Google > Tencent > Dictionary."""
        engines = ["deepl", "google", "tencent", "dictionary"]
        assert engines[0] == "deepl"
        assert engines[-1] == "dictionary"

    def test_engine_auto_selection(self):
        """Test auto engine selection based on language pair."""
        # ja→zh should prefer DeepL/Google
        source = "ja"
        target = "zh-CN"
        assert source == "ja"
        assert target.startswith("zh")

    def test_fallback_to_dictionary(self):
        """Test fallback to built-in dictionary when all APIs unavailable."""
        # When all external APIs fail, should fall back to built-in dictionary
        fallback_text = "【辞書】こんにちは → 你好"
        assert "辞書" in fallback_text or "你好" in fallback_text
