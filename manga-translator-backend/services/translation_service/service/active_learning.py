from __future__ import annotations
"""
Active Learning Pipeline — PRD v3.0 (v3.0 new module).

Intelligently collects low-confidence translations, feeds them back to improve
the translation engine via human-in-the-loop correction loops.

Architecture:
  1. Low-confidence collector: 翻译后 BLEU/METEOR < threshold → collect
  2. Feedback loop: 人工修改后 → store as corrected pair in training data
  3. Weekly retraining: Celery Beat task re-evaluates with accumulated corrections
  4. Confidence scoring: track per-engine confidence, route accordingly
"""
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, List, Optional, Any, Tuple
import json, uuid, hashlib
import logging

logger = logging.getLogger(__name__)


@dataclass
class TranslationFeedback:
    """A single human-corrected translation feedback entry."""
    feedback_id: str
    source_text: str
    machine_translation: str
    human_correction: str
    source_lang: str
    target_lang: str
    engine_used: str
    region_type: str
    character_tone: str
    confidence_score: float  # 0.0 ~ 1.0
    project_id: Optional[str] = None
    page_id: Optional[str] = None
    region_id: Optional[str] = None
    corrected_by: Optional[str] = None
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class ActiveLearningPipeline:
    """
    Active learning loop for translation quality improvement.

    流程:
    1. After each page translation, check confidence scores
    2. Regions with confidence < threshold are flagged for review
    3. Human corrections are collected as feedback
    4. Weekly, accumulated feedback is used to update the engine routing weights
    """

    # Confidence thresholds
    LOW_CONFIDENCE_THRESHOLD = 0.65   # Below this: collect for active learning
    HIGH_CONFIDENCE_THRESHOLD = 0.85  # Above this: trusted, no collection needed

    # Engine routing weights (dynamically updated)
    _engine_weights: Dict[str, Dict[str, float]] = {
        # engine_name → { lang_pair: weight }
        "deepl": {"ja→zh": 1.0, "ja→en": 0.9, "en→zh": 0.85, "default": 0.7},
        "google": {"ja→zh": 0.7, "ja→en": 0.8, "en→zh": 0.75, "default": 0.6},
        "tencent": {"ja→zh": 0.8, "ja→en": 0.6, "en→zh": 0.9, "default": 0.5},
        "openai": {"ja→zh": 0.85, "ja→en": 0.85, "en→zh": 0.8, "default": 0.75},
        "basic": {"default": 0.3},
    }

    def __init__(self, storage_path: str = "/tmp/al_feedback.json"):
        self.storage_path = storage_path
        self._feedback_buffer: List[TranslationFeedback] = []
        self._correction_count: int = 0

    # ── Collection Phase ──

    def should_collect(self, confidence_score: float) -> bool:
        """Determine if a translation result should be collected for active learning."""
        return confidence_score < self.LOW_CONFIDENCE_THRESHOLD

    def collect_feedback(
        self,
        source_text: str,
        machine_translation: str,
        human_correction: str,
        source_lang: str,
        target_lang: str,
        engine_used: str,
        region_type: str = "speech",
        character_tone: str = "conversational",
        confidence_score: float = 0.5,
        project_id: Optional[str] = None,
        page_id: Optional[str] = None,
        region_id: Optional[str] = None,
        corrected_by: Optional[str] = None,
    ) -> TranslationFeedback:
        """Collect a human correction for active learning."""
        feedback = TranslationFeedback(
            feedback_id=str(uuid.uuid4()),
            source_text=source_text,
            machine_translation=machine_translation,
            human_correction=human_correction,
            source_lang=source_lang,
            target_lang=target_lang,
            engine_used=engine_used,
            region_type=region_type,
            character_tone=character_tone,
            confidence_score=confidence_score,
            project_id=project_id,
            page_id=page_id,
            region_id=region_id,
            corrected_by=corrected_by,
        )
        self._feedback_buffer.append(feedback)
        self._correction_count += 1

        if len(self._feedback_buffer) >= 50:
            self._flush_to_disk()

        logger.info(f"[ActiveLearning] Collected feedback #{self._correction_count}: {source_text[:30]}... → {human_correction[:30]}...")
        return feedback

    # ── Scoring Phase ──

    def compute_confidence(self, source_text: str, translation: str,
                           source_lang: str, target_lang: str,
                           engine: str) -> Dict[str, Any]:
        """
        Compute confidence score for a translation.
        Uses simple heuristics: length ratio, unknown-char ratio, engine weight.
        """
        # Length ratio heuristic (translation within 0.3x–3x of source is reasonable)
        len_ratio = len(translation) / max(1, len(source_text))
        len_score = 1.0 - abs(1.0 - min(3.0, max(0.33, len_ratio))) * 0.5

        # Unknown/placeholder character detection
        unknown_chars = sum(1 for c in translation if c in '�□■')
        char_score = 1.0 - (unknown_chars / max(1, len(translation))) * 5.0
        char_score = max(0.0, min(1.0, char_score))

        # Engine base weight
        lang_pair = f"{source_lang}→{target_lang}"
        engine_w = self._engine_weights.get(engine, {}).get(lang_pair,
                    self._engine_weights.get(engine, {}).get("default", 0.5))
        engine_score = min(1.0, engine_w)

        # Combined confidence
        confidence = (len_score * 0.3 + char_score * 0.4 + engine_score * 0.3)

        return {
            "confidence": round(confidence, 4),
            "factors": {
                "length_ratio": round(len_ratio, 2),
                "unknown_chars": unknown_chars,
                "engine_weight": round(engine_score, 2),
            },
            "needs_review": confidence < self.LOW_CONFIDENCE_THRESHOLD,
        }

    # ── Retraining Phase (weekly) ──

    def update_engine_weights(self):
        """
        Update engine routing weights based on accumulated feedback.
        Called weekly by Celery Beat scheduler.
        """
        if not self._feedback_buffer:
            logger.info("[ActiveLearning] No feedback to process for weight update")
            return

        # Group corrections by engine + language pair
        corrections: Dict[str, Dict[str, List[float]]] = {}
        for fb in self._feedback_buffer:
            key = fb.engine_used
            lang_pair = f"{fb.source_lang}→{fb.target_lang}"
            if key not in corrections:
                corrections[key] = {}
            if lang_pair not in corrections[key]:
                corrections[key][lang_pair] = []

            # Compute correction quality: was human correction very different from MT?
            # Higher difference = lower engine quality for this pair
            similarity = self._text_similarity(fb.machine_translation, fb.human_correction)
            corrections[key][lang_pair].append(similarity)

        # Update weights: average similarity across all corrections
        for engine, lang_pairs in corrections.items():
            if engine not in self._engine_weights:
                self._engine_weights[engine] = {}
            for lang_pair, scores in lang_pairs.items():
                avg_similarity = sum(scores) / len(scores)
                # Weight = 1 - avg_similarity inverted: low similarity → low weight
                new_weight = max(0.1, min(1.0, avg_similarity))
                old_weight = self._engine_weights[engine].get(lang_pair, 0.5)
                # EMA smoothing
                self._engine_weights[engine][lang_pair] = old_weight * 0.7 + new_weight * 0.3
                logger.info(
                    f"[ActiveLearning] {engine}/{lang_pair}: "
                    f"weight {old_weight:.2f} → {self._engine_weights[engine][lang_pair]:.2f} "
                    f"(avg_similarity={avg_similarity:.2f}, n={len(scores)})"
                )

        # Clear buffer after successful update
        self._feedback_buffer.clear()
        logger.info(f"[ActiveLearning] Weights updated. Total corrections processed: {self._correction_count}")

    def get_engine_weight(self, engine: str, source_lang: str, target_lang: str) -> float:
        """Get current learned weight for an engine + language pair."""
        lang_pair = f"{source_lang}→{target_lang}"
        return self._engine_weights.get(engine, {}).get(
            lang_pair,
            self._engine_weights.get(engine, {}).get("default", 0.5)
        )

    def get_all_weights(self) -> Dict:
        """Export all current engine weights for monitoring."""
        return {
            "engine_weights": self._engine_weights,
            "correction_count": self._correction_count,
            "buffer_size": len(self._feedback_buffer),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }

    # ── Helpers ──

    def _text_similarity(self, text1: str, text2: str) -> float:
        """Compute simple character-level Jaccard similarity."""
        if not text1 and not text2:
            return 1.0
        s1 = set(text1)
        s2 = set(text2)
        if not s1 and not s2:
            return 1.0
        intersection = s1 & s2
        union = s1 | s2
        return len(intersection) / len(union) if union else 0.0

    def _flush_to_disk(self):
        """Persist feedback buffer to disk."""
        try:
            data = {
                "correction_count": self._correction_count,
                "feedback": [
                    {
                        "feedback_id": fb.feedback_id,
                        "source_text": fb.source_text,
                        "machine_translation": fb.machine_translation,
                        "human_correction": fb.human_correction,
                        "source_lang": fb.source_lang,
                        "target_lang": fb.target_lang,
                        "engine_used": fb.engine_used,
                        "confidence_score": fb.confidence_score,
                        "character_tone": fb.character_tone,
                        "created_at": fb.created_at,
                    }
                    for fb in self._feedback_buffer
                ],
            }
            os.makedirs(os.path.dirname(self.storage_path), exist_ok=True)
            with open(self.storage_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            logger.info(f"[ActiveLearning] Flushed {len(self._feedback_buffer)} feedbacks to {self.storage_path}")
        except Exception as e:
            logger.error(f"[ActiveLearning] Failed to flush feedback: {e}")


# Singleton instance for the service
pipeline = ActiveLearningPipeline()


# ── Celery Beat Task (weekly retraining) ──
# Register with Celery:
#   @celery_app.on_after_configure.connect
#   def setup_periodic_tasks(sender, **kwargs):
#       sender.add_periodic_task(
#           crontab(hour=3, day_of_week=1),  # Every Monday at 3 AM
#           run_active_learning_retraining.s(),
#       )
#
# @celery_app.task
# def run_active_learning_retraining():
#     from .active_learning import pipeline
#     pipeline.update_engine_weights()
