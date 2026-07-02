from __future__ import annotations
"""
Redis-based progress tracking for batch pipeline operations.
"""
import json
import time
import logging
from typing import Dict, Any, Optional
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# Redis key prefixes
KEY_PREFIX = "batch"
KEY_PAGE_PREFIX = "page"

# TTL for progress data (1 hour)
PROGRESS_TTL = 3600

# Pipeline steps and their weight
PIPELINE_STEPS = {
    "detect": {"order": 1, "label": "文字检测", "weight": 20},
    "ocr": {"order": 2, "label": "OCR识别", "weight": 20},
    "translate": {"order": 3, "label": "翻译", "weight": 20},
    "inpaint": {"order": 4, "label": "背景修复", "weight": 20},
    "render": {"order": 5, "label": "文字渲染", "weight": 20},
}


def _get_redis():
    """Get Redis client."""
    try:
        from common.core.redis import redis_client
        return redis_client
    except Exception:
        return None


class ProgressTracker:
    """Track batch processing progress in Redis."""

    def __init__(self, batch_id: str):
        self.batch_id = batch_id
        self._key = f"{KEY_PREFIX}:{batch_id}:progress"

    def _get_data(self) -> Dict[str, Any]:
        """Get progress data from Redis."""
        r = _get_redis()
        if r is None:
            return self._default_data()
        try:
            data = r.get(self._key)
            if data:
                return json.loads(data)
        except Exception as e:
            logger.warning(f"Failed to get progress: {e}")
        return self._default_data()

    def _save_data(self, data: Dict[str, Any]):
        """Save progress data to Redis."""
        r = _get_redis()
        if r is None:
            return
        try:
            data["updated_at"] = datetime.now(timezone.utc).isoformat()
            r.setex(self._key, PROGRESS_TTL, json.dumps(data))
        except Exception as e:
            logger.warning(f"Failed to save progress: {e}")

    def _default_data(self) -> Dict[str, Any]:
        """Default progress data structure."""
        return {
            "batch_id": self.batch_id,
            "status": "pending",  # pending, running, paused, completed, failed, cancelled
            "total_pages": 0,
            "completed_pages": 0,
            "failed_pages": 0,
            "current_step": "detect",
            "current_page": None,
            "step_progress": 0,  # 0-100 within current step
            "overall_progress": 0,  # 0-100 overall
            "errors": [],
            "started_at": None,
            "paused_at": None,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": None,
        }

    def initialize(self, total_pages: int, operations: list = None):
        """Initialize a new batch progress record."""
        data = self._default_data()
        data["total_pages"] = total_pages
        data["operations"] = operations or list(PIPELINE_STEPS.keys())
        data["status"] = "running"
        data["started_at"] = datetime.now(timezone.utc).isoformat()
        self._save_data(data)

    def get(self) -> Dict[str, Any]:
        """Get current progress."""
        return self._get_data()

    def update_page_progress(self, page_id: str, step: str, status: str = "completed"):
        """Update progress for a specific page."""
        data = self._get_data()
        
        if status == "completed":
            data["current_page"] = page_id
            
            # Calculate step progress
            step_info = PIPELINE_STEPS.get(step, {})
            data["current_step"] = step
            data["step_progress"] = min(100, int((data["completed_pages"] / max(data["total_pages"], 1)) * 100))
            
            # Calculate overall progress
            overall = 0
            for s, info in PIPELINE_STEPS.items():
                s_idx = list(PIPELINE_STEPS.keys()).index(s)
                current_idx = list(PIPELINE_STEPS.keys()).index(step)
                
                if s_idx < current_idx:
                    overall += info["weight"]  # Completed steps = full weight
                elif s_idx == current_idx:
                    overall += int(info["weight"] * data["step_progress"] / 100)  # Current step proportional
                # Future steps = 0
            
            data["overall_progress"] = overall
            
        elif status == "failed":
            data["failed_pages"] += 1
            error_entry = {
                "page_id": page_id,
                "step": step,
                "time": datetime.now(timezone.utc).isoformat(),
            }
            if len(data["errors"]) < 100:
                data["errors"].append(error_entry)
        
        self._save_data(data)

    def mark_step_complete(self, step: str, pages_completed: int):
        """Mark a pipeline step as complete."""
        data = self._get_data()
        data["completed_pages"] = pages_completed
        data["current_step"] = step
        data["step_progress"] = 100
        
        # Calculate overall progress
        step_order = PIPELINE_STEPS.get(step, {}).get("order", 1)
        overall = step_order * 20
        data["overall_progress"] = min(overall, 100)
        
        self._save_data(data)

    def mark_complete(self):
        """Mark entire batch as complete."""
        data = self._get_data()
        data["status"] = "completed"
        data["overall_progress"] = 100
        data["step_progress"] = 100
        data["completed_pages"] = data.get("total_pages", 0)
        self._save_data(data)

    def mark_failed(self, error: str):
        """Mark batch as failed."""
        data = self._get_data()
        data["status"] = "failed"
        data["errors"].append({
            "error": error,
            "time": datetime.now(timezone.utc).isoformat(),
        })
        self._save_data(data)

    def set_pause_flag(self) -> bool:
        """Set pause flag. Returns True if successfully paused."""
        r = _get_redis()
        if r is None:
            return False
        try:
            pause_key = f"{KEY_PREFIX}:{self.batch_id}:pause"
            r.setex(pause_key, PROGRESS_TTL, "1")
            
            data = self._get_data()
            data["status"] = "paused"
            data["paused_at"] = datetime.now(timezone.utc).isoformat()
            self._save_data(data)
            return True
        except Exception:
            return False

    def clear_pause_flag(self) -> bool:
        """Clear pause flag. Returns True if successfully resumed."""
        r = _get_redis()
        if r is None:
            return False
        try:
            pause_key = f"{KEY_PREFIX}:{self.batch_id}:pause"
            r.delete(pause_key)
            
            data = self._get_data()
            data["status"] = "running"
            data["paused_at"] = None
            self._save_data(data)
            return True
        except Exception:
            return False

    def is_paused(self) -> bool:
        """Check if batch is paused."""
        r = _get_redis()
        if r is None:
            return False
        try:
            pause_key = f"{KEY_PREFIX}:{self.batch_id}:pause"
            return r.exists(pause_key) > 0
        except Exception:
            return False

    def is_cancelled(self) -> bool:
        """Check if batch is cancelled."""
        r = _get_redis()
        if r is None:
            return False
        try:
            cancel_key = f"{KEY_PREFIX}:{self.batch_id}:cancel"
            return r.exists(cancel_key) > 0
        except Exception:
            return False

    def cancel(self):
        """Mark batch as cancelled."""
        r = _get_redis()
        if r is not None:
            try:
                cancel_key = f"{KEY_PREFIX}:{self.batch_id}:cancel"
                r.setex(cancel_key, PROGRESS_TTL, "1")
            except Exception:
                pass
        
        data = self._get_data()
        data["status"] = "cancelled"
        self._save_data(data)


class PageProgressTracker:
    """Track progress for a single page."""
    
    def __init__(self, page_id: str):
        self.page_id = page_id
        self._key = f"{KEY_PAGE_PREFIX}:{page_id}:progress"
    
    def set(self, step: str, status: str, progress: float = 0):
        """Set page progress."""
        r = _get_redis()
        if r is None:
            return
        try:
            data = {
                "page_id": self.page_id,
                "step": step,
                "status": status,
                "progress": progress,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            r.setex(self._key, PROGRESS_TTL, json.dumps(data))
        except Exception:
            pass
    
    def get(self) -> Dict[str, Any]:
        """Get page progress."""
        r = _get_redis()
        if r is None:
            return {"page_id": self.page_id, "status": "unknown"}
        try:
            data = r.get(self._key)
            return json.loads(data) if data else {"page_id": self.page_id, "status": "unknown"}
        except Exception:
            return {"page_id": self.page_id, "status": "unknown"}
