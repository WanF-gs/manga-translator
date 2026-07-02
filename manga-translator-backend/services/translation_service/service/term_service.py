from __future__ import annotations
"""
Term management business logic.
"""
import uuid
from typing import Dict, Any, List, Tuple, Optional

from sqlalchemy.ext.asyncio import AsyncSession

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from common.models.term_entry import TermEntry
from ..repository.term_repo import TermRepository


class TermService:
    """Term CRUD and matching service."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.repo = TermRepository(db)

    async def list_terms(
        self,
        user_id: str,
        page: int = 1,
        page_size: int = 20,
        scope: str = None,
        category: str = None,
        keyword: str = None,
        project_id: str = None,
    ) -> Tuple[List[Dict], int]:
        """List terms with filtering."""
        terms, total = await self.repo.list_terms(
            user_id=user_id,
            page=page,
            page_size=page_size,
            scope=scope,
            category=category,
            keyword=keyword,
            project_id=project_id,
        )
        items = [{
            "term_id": str(t.term_id),
            "source_text": t.source_text,
            "target_text": t.target_text,
            "note": t.note,
            "category": t.category,
            "scope": t.scope,
            "project_id": str(t.project_id) if t.project_id else None,
        } for t in terms]
        return items, total

    async def create_term(self, user_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a new term."""
        term = TermEntry(
            term_id=uuid.uuid4(),
            user_id=user_id,
            project_id=data.get("project_id"),
            source_text=data.get("source_text", ""),
            target_text=data.get("target_text", ""),
            note=data.get("note"),
            category=data.get("category"),
            scope=data.get("scope", "account"),
        )
        self.db.add(term)
        await self.db.flush()
        return {
            "term_id": str(term.term_id),
            "source_text": term.source_text,
            "target_text": term.target_text,
            "scope": term.scope,
        }

    async def update_term(self, term_id: str, user_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Update a term."""
        term = await self.repo.find_by_id(term_id, user_id)
        if not term:
            raise ValueError("Term not found")
        for field in ["source_text", "target_text", "note", "category", "scope"]:
            if field in data:
                setattr(term, field, data[field])
        await self.db.flush()
        return {"term_id": str(term.term_id), "source_text": term.source_text, "target_text": term.target_text}

    async def delete_term(self, term_id: str, user_id: str) -> None:
        """Delete a term."""
        term = await self.repo.find_by_id(term_id, user_id)
        if not term:
            raise ValueError("Term not found")
        await self.db.delete(term)
        await self.db.flush()

    async def get_terms_for_translation(self, project_id: str = None) -> List[Dict]:
        """Get all terms applicable for translation (account-level + project-level)."""
        terms = await self.repo.get_terms_for_project(project_id)
        return [
            {"source_text": t.source_text, "target_text": t.target_text}
            for t in terms
            if t.source_text and t.target_text
        ]
