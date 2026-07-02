from __future__ import annotations
"""
Undo/Redo service.
Maintains per-page undo/redo stacks with 20-step limit.
"""
import uuid
import logging
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional

from sqlalchemy import select, delete, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from common.models.page import Page
from common.models.text_region import TextRegion
from common.models.operation_history import OperationHistory as OpHistory

logger = logging.getLogger(__name__)


class UndoRedoService:
    """Per-page undo/redo with 20-step history limit."""

    MAX_HISTORY = 20  # Maximum undo steps per page

    def __init__(self, db: AsyncSession):
        self.db = db

    async def record_operation(
        self,
        page_id: str,
        user_id: str,
        operation_type: str,
        description: str = "",
    ) -> Optional[str]:
        """
        Record current page state as a snapshot before an operation.
        Call this BEFORE performing the operation.
        
        Returns history_id or None if recording failed.
        """
        try:
            # Get current page state
            page_result = await self.db.execute(
                select(Page).where(Page.page_id == page_id)
            )
            page = page_result.scalar_one_or_none()
            if not page:
                return None

            # Get current text regions state
            regions_result = await self.db.execute(
                select(TextRegion)
                .where(TextRegion.page_id == page_id)
                .order_by(TextRegion.sort_order.asc())
            )
            regions = list(regions_result.scalars().all())

            # Build snapshots
            snapshot_before = {
                "status": page.status,
                "processed_url": page.processed_url,
                "original_url": page.original_url,
                "translation_result": page.translation_result,
                "preprocessing_result": page.preprocessing_result,
            }

            regions_snapshot = {}
            for r in regions:
                regions_snapshot[str(r.region_id)] = {
                    "original_text": r.original_text,
                    "translated_text": r.translated_text,
                    "boundary": r.boundary,
                    "type": r.type,
                    "confidence": r.confidence,
                    "is_locked": r.is_locked,
                    "style_config": r.style_config,
                    "sort_order": r.sort_order,
                }

            # Check current undo count for this page
            count_result = await self.db.execute(
                select(func.count(OpHistory.history_id)).where(
                    and_(
                        OpHistory.page_id == page_id,
                        OpHistory.is_undone == False,
                    )
                )
            )
            count = count_result.scalar() or 0

            # Create history record
            history = OpHistory(
                page_id=uuid.UUID(page_id),
                user_id=uuid.UUID(user_id),
                operation_type=operation_type,
                snapshot_before=snapshot_before,
                snapshot_after=None,  # Will be filled when undo is called
                regions_snapshot=regions_snapshot,
                description=description or f"{operation_type} operation",
                undo_stack_position=count,
                is_undone=False,
            )
            self.db.add(history)
            await self.db.flush()

            # Clear redo stack (any undone operations become invalid after new operation)
            await self.db.execute(
                delete(OpHistory).where(
                    and_(
                        OpHistory.page_id == page_id,
                        OpHistory.is_undone == True,
                    )
                )
            )

            # Prune old history if > MAX_HISTORY
            await self._prune_history(page_id)

            await self.db.commit()
            return str(history.history_id)
        except Exception as e:
            logger.error(f"Failed to record operation: {e}", exc_info=True)
            await self.db.rollback()
            return None

    async def undo(self, page_id: str, user_id: str) -> Dict[str, Any]:
        """
        Undo the last operation on a page.
        Restores the page and text_regions to the state before the last operation.
        
        Returns:
            {success: bool, history_id: str, operation_type: str, message: str}
        """
        try:
            # Find the latest non-undone operation for this page
            result = await self.db.execute(
                select(OpHistory)
                .where(
                    and_(
                        OpHistory.page_id == page_id,
                        OpHistory.is_undone == False,
                    )
                )
                .order_by(OpHistory.undo_stack_position.desc())
                .limit(1)
            )
            history = result.scalar_one_or_none()

            if not history:
                return {"success": False, "message": "Nothing to undo"}

            # Get current page state to save as snapshot_after
            page_result = await self.db.execute(
                select(Page).where(Page.page_id == page_id)
            )
            page = page_result.scalar_one_or_none()
            if not page:
                return {"success": False, "message": "Page not found"}

            # Save current state to snapshot_after
            history.snapshot_after = {
                "status": page.status,
                "processed_url": page.processed_url,
                "original_url": page.original_url,
                "translation_result": page.translation_result,
                "preprocessing_result": page.preprocessing_result,
            }

            # Restore page state from snapshot_before
            before = history.snapshot_before or {}
            page.status = before.get("status", "pending")
            page.processed_url = before.get("processed_url")
            page.translation_result = before.get("translation_result")
            page.preprocessing_result = before.get("preprocessing_result")

            # Restore text regions
            regions_snapshot = history.regions_snapshot or {}
            for region_id, state in regions_snapshot.items():
                region_result = await self.db.execute(
                    select(TextRegion).where(TextRegion.region_id == region_id)
                )
                region = region_result.scalar_one_or_none()
                if region:
                    region.original_text = state.get("original_text")
                    region.translated_text = state.get("translated_text")
                    region.boundary = state.get("boundary")
                    region.type = state.get("type", region.type)
                    region.confidence = state.get("confidence")
                    region.is_locked = state.get("is_locked", False)
                    region.style_config = state.get("style_config")
                    region.sort_order = state.get("sort_order", region.sort_order)

            # Mark as undone (moves to redo stack)
            history.is_undone = True

            await self.db.commit()

            return {
                "success": True,
                "history_id": str(history.history_id),
                "operation_type": history.operation_type,
                "message": f"Undid {history.operation_type}: {history.description}",
            }
        except Exception as e:
            logger.error(f"Undo failed: {e}", exc_info=True)
            await self.db.rollback()
            return {"success": False, "message": str(e)}

    async def redo(self, page_id: str, user_id: str) -> Dict[str, Any]:
        """
        Redo the last undone operation.
        Restores the page to the state saved in snapshot_after.
        """
        try:
            # Find the latest undone operation (the redo stack)
            result = await self.db.execute(
                select(OpHistory)
                .where(
                    and_(
                        OpHistory.page_id == page_id,
                        OpHistory.is_undone == True,
                    )
                )
                .order_by(OpHistory.undo_stack_position.desc())
                .limit(1)
            )
            history = result.scalar_one_or_none()

            if not history:
                return {"success": False, "message": "Nothing to redo"}

            if not history.snapshot_after:
                return {"success": False, "message": "No redo state available"}

            # Restore page state from snapshot_after
            page_result = await self.db.execute(
                select(Page).where(Page.page_id == page_id)
            )
            page = page_result.scalar_one_or_none()
            if not page:
                return {"success": False, "message": "Page not found"}

            after = history.snapshot_after
            page.status = after.get("status", "pending")
            page.processed_url = after.get("processed_url")
            page.translation_result = after.get("translation_result")
            page.preprocessing_result = after.get("preprocessing_result")

            # Mark as not undone (back in undo stack)
            history.is_undone = False

            await self.db.commit()

            return {
                "success": True,
                "history_id": str(history.history_id),
                "operation_type": history.operation_type,
                "message": f"Redid {history.operation_type}: {history.description}",
            }
        except Exception as e:
            logger.error(f"Redo failed: {e}", exc_info=True)
            await self.db.rollback()
            return {"success": False, "message": str(e)}

    async def get_history(
        self, page_id: str, user_id: str, limit: int = 20
    ) -> List[Dict[str, Any]]:
        """Get operation history for a page."""
        result = await self.db.execute(
            select(OpHistory)
            .where(OpHistory.page_id == page_id)
            .order_by(OpHistory.undo_stack_position.desc())
            .limit(limit)
        )
        histories = result.scalars().all()

        return [
            {
                "history_id": str(h.history_id),
                "operation_type": h.operation_type,
                "description": h.description,
                "is_undone": h.is_undone,
                "created_at": h.created_at.isoformat() if h.created_at else None,
            }
            for h in histories
        ]

    async def can_undo(self, page_id: str, user_id: str) -> bool:
        """Check if undo is available."""
        result = await self.db.execute(
            select(func.count(OpHistory.history_id)).where(
                and_(
                    OpHistory.page_id == page_id,
                    OpHistory.is_undone == False,
                )
            )
        )
        count = result.scalar() or 0
        return count > 0

    async def can_redo(self, page_id: str, user_id: str) -> bool:
        """Check if redo is available."""
        result = await self.db.execute(
            select(func.count(OpHistory.history_id)).where(
                and_(
                    OpHistory.page_id == page_id,
                    OpHistory.is_undone == True,
                )
            )
        )
        count = result.scalar() or 0
        return count > 0

    async def _prune_history(self, page_id: str) -> None:
        """Keep only the latest MAX_HISTORY undo entries, delete oldest."""
        # Count current entries
        result = await self.db.execute(
            select(func.count(OpHistory.history_id)).where(
                and_(
                    OpHistory.page_id == page_id,
                    OpHistory.is_undone == False,
                )
            )
        )
        count = result.scalar() or 0

        if count > self.MAX_HISTORY:
            # Find the excess entries (oldest)
            excess_result = await self.db.execute(
                select(OpHistory.history_id)
                .where(
                    and_(
                        OpHistory.page_id == page_id,
                        OpHistory.is_undone == False,
                    )
                )
                .order_by(OpHistory.undo_stack_position.asc())
                .limit(count - self.MAX_HISTORY)
            )
            excess_ids = [row[0] for row in excess_result.fetchall()]

            if excess_ids:
                await self.db.execute(
                    delete(OpHistory).where(OpHistory.history_id.in_(excess_ids))
                )
                logger.info(f"Pruned {len(excess_ids)} old history entries for page {page_id}")
