from __future__ import annotations
"""
Translation orchestration service.
"""
import asyncio
import hashlib
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Dict, Any, List

logger = logging.getLogger(__name__)

from sqlalchemy.ext.asyncio import AsyncSession

# url补全：相对路径→完整 HTTP URL（修复PBP-VIS多模态翻译图片下载失败）
STORAGE_BASE_URL = os.getenv("STORAGE_BASE_URL", "http://localhost:8002")

def _resolve_image_url(image_url: str) -> str:
    """补全相对路径为完整 HTTP URL，否则 httpx 无法下载图片。"""
    if not image_url:
        return image_url
    if image_url.startswith("http://") or image_url.startswith("https://"):
        return image_url
    if image_url.startswith("/"):
        return f"{STORAGE_BASE_URL}{image_url}"
    return f"{STORAGE_BASE_URL}/{image_url}"

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from common.models.text_region import TextRegion
from common.models.translation_cache import TranslationCache

from .engine_router import EngineRouter
from .term_service import TermService
from .memory_service import MemoryService


class TranslationService:
    """Orchestrates page translation: regions → terms → cache → engine."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.router = EngineRouter()
        self.term_service = TermService(db)
        self.memory_service = MemoryService(db)

    async def translate_page(
        self,
        page_id: str,
        target_lang: str = "zh-CN",
        engine: str = "auto",
        onomatopoeia_mode: str = "keep_annotation",
        culture_strategy: str = "localize",
        previous_context: list = None,
        max_context_pages: int = 2,
        character_tones: dict = None,
        character_profile: dict = None,
    ) -> Dict[str, Any]:
        """
        Translate all text regions on a page.

        Args:
            previous_context: 前几页的翻译结果列表，用于跨页上下文传递
            max_context_pages: 最多引用前N页的翻译作为上下文
        """
        # Get regions for this page
        from sqlalchemy import select
        result = await self.db.execute(
            select(TextRegion)
            .where(TextRegion.page_id == page_id)
            .order_by(TextRegion.sort_order)
        )
        regions = result.scalars().all()

        if not regions:
            return {"regions": [], "cache_hits": 0, "engine": "basic", "processed_at": datetime.now(timezone.utc).isoformat()}

        # Get project ID for cache context
        from common.models.page import Page
        page_result = await self.db.execute(select(Page).where(Page.page_id == page_id))
        page = page_result.scalar_one_or_none()

        project_id = None
        source_lang = "ja"  # Will be overridden by project setting
        chapter_id = None
        current_sort_order = 0
        if page:
            from common.models.chapter import Chapter
            ch_result = await self.db.execute(select(Chapter).where(Chapter.chapter_id == page.chapter_id))
            chapter = ch_result.scalar_one_or_none()
            if chapter:
                project_id = str(chapter.project_id)
                chapter_id = str(chapter.chapter_id)
                source_lang = await self._get_project_source_lang(project_id)
            current_sort_order = page.sort_order

        # Get terms for this user/project
        terms = await self.term_service.get_terms_for_translation(project_id=project_id)

        from common.utils.text_sanitize import validate_translation_source

        # Phase 1: Categorize regions
        translated_regions = [None] * len(regions)
        to_translate = []  # (idx, region)
        cache_hits = 0
        engine_used = "basic"

        for idx, region in enumerate(regions):
            if not region.original_text or region.is_locked:
                translated_regions[idx] = {
                    "region_id": str(region.region_id),
                    "translated_text": region.translated_text or region.original_text or "",
                    "engine_used": "locked",
                    "from_cache": False,
                    "alternative_translations": [],
                }
                continue

            text = region.original_text
            is_valid, reason = validate_translation_source(text)
            if not is_valid:
                translated_regions[idx] = {
                    "region_id": str(region.region_id),
                    "translated_text": "",
                    "engine_used": "skipped",
                    "from_cache": False,
                    "alternative_translations": [],
                    "skip_reason": reason,
                }
                continue

            to_translate.append((idx, region))

        # Phase 2: Pre-check cache serially (avoid session conflicts)
        uncached = []  # (idx, region)
        for idx, region in to_translate:
            text = region.original_text
            cached = None
            if project_id:
                cached = await self.memory_service.find_cache(
                    project_id=project_id, source_text=text,
                    source_lang=source_lang, target_lang=target_lang,
                )
            # P2 fix: validate cached translation quality — reject pure-punctuation caches
            _has_valid_cached = cached and re.search(
                r'[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff'
                r'\uac00-\ud7af\u0020-\u007e\u0100-\u024f'
                r'\u0400-\u04ff\u0e00-\u0e7f]', cached
            )
            if cached and _has_valid_cached:
                region.translated_text = cached[:1000]
                translated_regions[idx] = {
                    "region_id": str(region.region_id),
                    "translated_text": cached,
                    "engine_used": "cache",
                    "from_cache": True,
                    "alternative_translations": [],
                }
                cache_hits += 1
            elif cached and not _has_valid_cached:
                # Stale/bad cache — delete it and re-translate
                logger.warning(f"Invalidating bad cache for '{text[:30]}' → '{cached[:30]}'")
                uncached.append((idx, region))
            else:
                uncached.append((idx, region))

        # Phase 3: Concurrent translation (engine only, no DB writes)
        sem = asyncio.Semaphore(5)

        # PBP-VIS: Collect all page texts for full-page context
        all_page_texts = [r.original_text for r in regions if r.original_text and not r.is_locked]
        # Build term glossary as {source: target} dict for enforcement
        term_glossary = {}
        for term_row in terms:
            if term_row.get("source_text") and term_row.get("target_text"):
                term_glossary[term_row["source_text"]] = term_row["target_text"]

        async def _translate_only(idx, region):
            async with sem:
                engine_text = self._apply_terms(region.original_text, terms, target_lang)
                context = self._build_translation_context(
                    current_region_index=idx, regions=regions, previous_context=previous_context,
                )
                if page and page.original_url:
                    context["image_url"] = _resolve_image_url(page.original_url)
                # PBP-VIS: page-level context + term glossary
                context["all_page_texts"] = all_page_texts
                context["term_glossary"] = term_glossary
                # P1-B: 页级角色档案（若请求指定 character_id）注入，供 prompt 渲染语气
                if character_profile:
                    context["character_profile"] = character_profile
                character_tone = self._resolve_character_tone(region=region, character_tones=character_tones)
                result = await self.router.route(
                    text=engine_text, source_lang=source_lang, target_lang=target_lang,
                    region_type=region.type, character_tone=character_tone, context=context,
                )
                translated_text = self._unwrap_terms(result["text"])
                # OCR post-processing correction
                translated_text = self._ocr_postprocess(translated_text, source_lang, target_lang)
                if len(translated_text) > 500:
                    translated_text = translated_text[:500]
                if len(translated_text) > 20:
                    repeats = re.findall(r'(\S{1,10})\1{3,}', translated_text)
                    if repeats:
                        translated_text = ""
                return idx, translated_text, result["engine_used"]

        if uncached:
            tasks = [_translate_only(idx, r) for idx, r in uncached]
            results = await asyncio.gather(*tasks)

            # Phase 4: Store results in cache serially
            for idx, translated_text, used_engine in results:
                region = regions[idx]
                region.translated_text = (translated_text or "")[:1000]
                translated_regions[idx] = {
                    "region_id": str(region.region_id),
                    "translated_text": translated_text,
                    "engine_used": used_engine,
                    "from_cache": False,
                    "alternative_translations": [],
                }
                engine_used = used_engine

                if project_id and translated_text:
                    await self.memory_service.store_cache(
                        project_id=project_id, source_text=region.original_text,
                        translated_text=translated_text, source_lang=source_lang, target_lang=target_lang,
                    )

        # Update page status
        if page:
            page.status = "reviewed"
            page.translation_result = {
                "regions": translated_regions,
                "engine": engine_used,
                "target_lang": target_lang,
                "processed_at": datetime.now(timezone.utc).isoformat(),
            }

        # P0 FIX: 安全flush + rollback保护
        try:
            await self.db.flush()
        except Exception as flush_err:
            logger.warning(f"Flush failed, attempting rollback: {flush_err}")
            try:
                await self.db.rollback()
                await self.db.flush()
            except Exception:
                logger.error(f"Rollback+flush also failed: {flush_err}")
                raise

        return {
            "regions": translated_regions,
            "cache_hits": cache_hits,
            "engine": engine_used,
            "processed_at": datetime.now(timezone.utc).isoformat(),
        }

    async def _translate_region(
        self, idx, region, text, terms, source_lang, target_lang,
        project_id, cache_hits, previous_context, regions, character_tones,
    ):
        cached = None
        if project_id:
            cached = await self.memory_service.find_cache(
                project_id=project_id, source_text=text,
                source_lang=source_lang, target_lang=target_lang,
            )
        if cached:
            return cached, "cache", True, [], cache_hits + 1

        engine_text = self._apply_terms(text, terms, target_lang)
        context = self._build_translation_context(
            current_region_index=idx, regions=regions, previous_context=previous_context,
        )

        character_tone = self._resolve_character_tone(region=region, character_tones=character_tones)

        result = await self.router.route(
            text=engine_text, source_lang=source_lang, target_lang=target_lang,
            region_type=region.type, character_tone=character_tone, context=context,
        )
        translated_text = self._unwrap_terms(result["text"])

        if len(translated_text) > 500:
            translated_text = translated_text[:500]
        if len(translated_text) > 20:
            repeats = re.findall(r'(\S{1,10})\1{3,}', translated_text)
            if repeats:
                translated_text = ""

        if project_id:
            await self.memory_service.store_cache(
                project_id=project_id, source_text=text,
                translated_text=translated_text,
                source_lang=source_lang, target_lang=target_lang,
            )

        return translated_text, result["engine_used"], False, [], cache_hits

    async def _load_previous_pages_context(
        self,
        chapter_id: str,
        before_sort_order: int,
        max_pages: int,
        target_lang: str,
    ) -> list:
        """加载同章节前N页的翻译上下文"""
        from sqlalchemy import select
        from common.models.page import Page

        result = await self.db.execute(
            select(Page)
            .where(
                Page.chapter_id == chapter_id,
                Page.sort_order < before_sort_order,
            )
            .order_by(Page.sort_order.desc())
            .limit(max_pages)
        )
        prev_pages = list(result.scalars().all())

        context = []
        for prev_page in reversed(prev_pages):  # 按顺序排列
            if prev_page.translation_result:
                regions = prev_page.translation_result.get("regions", [])
                page_context = {
                    "page_id": str(prev_page.page_id),
                    "sort_order": prev_page.sort_order,
                    "regions": [
                        {
                            "original_text": r.get("original_text", ""),
                            "translated_text": r.get("translated_text", ""),
                            "type": r.get("type", "speech"),
                        }
                        for r in regions
                        if r.get("translated_text")
                    ],
                }
                context.append(page_context)

        return context

    def _build_translation_context(
        self,
        current_region_index: int,
        regions: list,
        previous_context: list,
    ) -> dict:
        """
        构建翻译引擎上下文，包含：
        - 当前页已翻译的前几个region
        - 前一页最后几个region（可能跨页对话延续）
        """
        context_parts = []

        # 同页上文（当前region之前的翻译结果）
        for i in range(max(0, current_region_index - 2), current_region_index):
            if i < len(regions) and regions[i].translated_text:
                context_parts.append({
                    "role": "previous",
                    "original": regions[i].original_text or "",
                    "translated": regions[i].translated_text,
                })

        # 跨页上下文（前一页的最后几个区域）
        if previous_context:
            last_page = previous_context[-1]  # 最近的前一页
            last_regions = last_page.get("regions", [])
            # 取最后一页的最后2个区域作为跨页对话延续线索
            tail_regions = last_regions[-2:] if len(last_regions) >= 2 else last_regions
            for r in tail_regions:
                context_parts.append({
                    "role": "cross_page",
                    "original": r.get("original_text", ""),
                    "translated": r.get("translated_text", ""),
                })

        return {
            "previous_segments": context_parts,
            "has_cross_page_context": bool(previous_context),
        }

    async def _get_project_source_lang(self, project_id: str) -> str:
        """从项目设置中获取源语言"""
        try:
            from sqlalchemy import select
            from common.models.project import Project
            result = await self.db.execute(
                select(Project.source_lang).where(Project.project_id == project_id)
            )
            lang = result.scalar_one_or_none()
            logger.info(f"_get_project_source_lang({project_id}) = {lang}")
            return lang or "ja"
        except Exception as e:
            logger.error(f"_get_project_source_lang failed: {e}")
            return "ja"

    def _apply_terms(self, text: str, terms: List[Dict], target_lang: str) -> str:
        """Apply term substitutions to text (wrap matched terms in {{}} for engine preservation)."""
        for term in terms:
            src = term.get("source_text") or ""
            tgt = term.get("target_text") or ""
            if src and tgt and src in text:
                text = text.replace(src, f"{{{{{tgt}}}}}")
        return text

    def _unwrap_terms(self, text: str) -> str:
        """Strip {{}} markers from translated text, restoring actual term translations."""
        return re.sub(r'\{\{(.+?)\}\}', r'\1', text)

    # ============================================================
    # OCR 后处理纠正 — 日文常见OCR错误修正 (BallonTranslator-style)
    # ============================================================
    # Common Japanese OCR errors and their corrections
    _OCR_CORRECTIONS_JA = [
        # Long vowel normalization (長音符統一)
        (r'ー+', 'ー'),           # Remove duplicate long vowel marks
        (r'ッ+', 'ッ'),           # Remove duplicate small tsu
        # Common character confusions (MangaOCR/PaddleOCR known issues)
        ('巳', '已'),  ('曰', '日'),  ('夭', '天'),
        ('十', '一'),  ('亘', '旦'),  ('菅', '管'),
        ('榎', '梗'),  ('栃', '砺'),  ('茨', '茨'),
        # Punctuation fixes (half-width -> full-width for manga)
        ('!', '！'), ('?', '？'), (',', '、'), ('.', '。'),
        # Remove OCR artifacts
        (r'\s{2,}', ' '),         # Remove multiple spaces
        # Small kana normalization
        ('かつ', 'かっ'), ('はつ', 'はっ'),
    ]

    _OCR_CORRECTIONS_ZH = [
        # Chinese common corrections
        ('己', '已'), ('末', '未'), ('土', '士'),
        ('干', '千'), ('天', '夭'), ('白', '曰'),
        # Punctuation
        (',', '，'), ('?', '？'),
        # Remove artifacts
        (r'\s{2,}', ''),
    ]

    def _ocr_postprocess(self, text: str, source_lang: str, target_lang: str) -> str:
        """Apply OCR error correction rules to translated text.

        BallonTranslator-style regex corrections for common OCR mistakes.
        Source text correction happens before translation;
        target text correction happens on the output.
        """
        if not text:
            return text

        corrections = self._OCR_CORRECTIONS_JA if source_lang == "ja" else self._OCR_CORRECTIONS_ZH
        for pattern, replacement in corrections:
            try:
                text = re.sub(pattern, replacement, text)
            except re.error:
                text = text.replace(pattern, replacement)

        return text

    def _apply_onomatopoeia_mode(
        self, original: str, translated: str, mode: str
    ) -> str:
        """
        应用拟声词处理模式。

        Modes:
        - keep_annotation: 保留原文拟声词，在旁边添加译文注释
        - replace: 完全替换为译文拟声词
        - bilingual: 双语叠加显示（原文+译文）
        """
        if mode == "replace":
            return translated
        elif mode == "bilingual":
            return f"{original}({translated})"
        elif mode == "keep_annotation":
            return f"{translated} [{original}]"
        return translated

    def _apply_culture_strategy(
        self, original: str, translated: str, strategy: str
    ) -> str:
        """
        应用文化梗处理策略。

        Strategies:
        - localize: 完全本地化（用中文对等概念替换）
        - footnote: 保留原文+页脚注释
        - tooltip: 保留原文+悬浮注释（前端处理）
        """
        if strategy == "localize":
            return translated
        elif strategy == "footnote":
            # 标记需要页脚注释（前端根据此标记显示注释）
            if original != translated:
                return f"{translated}*"
            return translated
        elif strategy == "tooltip":
            # 标记需要悬浮注释
            if original != translated:
                return f"{translated}ⓘ"
            return translated
        return translated

    def _resolve_character_tone(
        self,
        region: TextRegion,
        character_tones: dict = None,
    ) -> str:
        """
        Y2 fix: 动态解析角色语气，不使用硬编码 "neutral"。

        优先级:
        1. region.style_config 中记录的 character_name → 查 character_tones 映射
        2. region 的 speaker_label 属性
        3. region.type 推断（narration → "formal", speech → "conversational" 等）
        4. 默认为 "conversational"（更适合日语对话场景）
        """
        # 1. 从 style_config 获取角色名，映射语气
        if character_tones:
            style = getattr(region, 'style_config', None) or {}
            char_name = style.get('character_name') or style.get('speaker')
            if char_name and char_name in character_tones:
                return character_tones[char_name]

        # 2. 从 region 的 speaker_label 推断
        # ⚠️ P2 工程债：TextRegion 模型无 speaker_label 列（getattr 恒为 None），此分支当前是死代码。
        #   根因：数据库迁移已给 text_regions 加 character_id 列，但 ORM 模型未同步（common/models/text_region.py）。
        #   彻底修复需：① ORM 补 character_id 字段 ② 建立 region→character 关联，实现逐区域（而非页级）语气。
        #   现状：P1-B 已通过页级 character_id 注入角色档案，覆盖主要场景；逐区域说话人识别留待 P2。
        speaker = getattr(region, 'speaker_label', None)
        if speaker:
            speaker_lower = str(speaker).lower()
            if any(kw in speaker_lower for kw in ['narration', 'narrator', 'ナレーション', '旁白']):
                return "formal"
            if any(kw in speaker_lower for kw in ['child', 'kid', '少年', '少女', '子供']):
                return "casual_youth"
            if any(kw in speaker_lower for kw in ['old', 'elder', '老人', 'elderly']):
                return "formal_elder"
            if any(kw in speaker_lower for kw in ['boss', 'villain', '敵', 'enemy', 'boss']):
                return "aggressive"
            if any(kw in speaker_lower for kw in ['female', 'woman', 'girl', '女', '少女']):
                return "polite_feminine"
            if any(kw in speaker_lower for kw in ['male', 'man', 'boy', '男', '少年']):
                return "casual_masculine"

        # 3. 从 region.type 推断默认语气
        region_type = getattr(region, 'type', 'speech')
        type_tone_map = {
            "speech": "conversational",
            "thought": "introspective",
            "narration": "formal",
            "onomatopoeia": "neutral",
            "title": "formal",
            "sfx": "neutral",
        }
        return type_tone_map.get(region_type, "conversational")

    @staticmethod
    def calculate_bleu(reference: str, hypothesis: str, max_n: int = 4) -> float:
        """Calculate BLEU score between reference and hypothesis translations."""
        if not reference or not hypothesis:
            return 0.0

        ref_tokens = list(reference)
        hyp_tokens = list(hypothesis)

        if not hyp_tokens:
            return 0.0

        scores = []
        for n in range(1, max_n + 1):
            ref_ngrams = {}
            for i in range(len(ref_tokens) - n + 1):
                ng = tuple(ref_tokens[i:i+n])
                ref_ngrams[ng] = ref_ngrams.get(ng, 0) + 1

            hyp_ngrams = {}
            for i in range(len(hyp_tokens) - n + 1):
                ng = tuple(hyp_tokens[i:i+n])
                hyp_ngrams[ng] = hyp_ngrams.get(ng, 0) + 1

            clipped = 0
            total = 0
            for ng, count in hyp_ngrams.items():
                clipped += min(count, ref_ngrams.get(ng, 0))
                total += count

            if total == 0:
                scores.append(0.0)
            else:
                scores.append(clipped / total)

        if not scores or all(s == 0 for s in scores):
            return 0.0

        import math
        geometric_mean = math.exp(sum(math.log(s + 1e-10) for s in scores) / len(scores))
        brevity_penalty = min(1.0, math.exp(1 - len(ref_tokens) / max(len(hyp_tokens), 1)))
        return brevity_penalty * geometric_mean
