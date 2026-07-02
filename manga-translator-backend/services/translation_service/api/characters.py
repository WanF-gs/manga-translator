from __future__ import annotations
"""Character Engine API - CRUD, tone types, detection, font/voice binding (v3.0)."""
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, update
from typing import Optional
import uuid, sys, os

_cur = os.path.dirname(os.path.abspath(__file__))
_svc = os.path.dirname(os.path.dirname(_cur))
if _svc not in sys.path:
    sys.path.insert(0, _svc)

from common.core.database import get_db
from common.core.dependencies import get_current_user
from common.core.response import success_response, paginated_response, created_response
from common.core.exceptions import ResourceNotFound
from common.models.character import Character
from common.models.text_region import TextRegion

router = APIRouter()

TONE_TYPES = ["tsundere", "hotblooded", "calm", "cold", "loli", "genki", "lazy", "chuunibyou", "natural", "bellyblack", "custom"]

@router.get("")
async def list_characters(
    project_id: Optional[str] = Query(None),
    tone_type: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """List characters, optionally filtered by project and tone type."""
    query = select(Character)
    if project_id:
        query = query.where(Character.project_id == project_id)
    if tone_type:
        query = query.where(Character.tone_type == tone_type)
    query = query.order_by(Character.sort_order, Character.created_at.desc())

    characters = (await db.execute(query)).scalars().all()
    return success_response(data={"characters": [_char_to_dict(c) for c in characters], "tone_types": TONE_TYPES})

@router.post("")
async def create_character(
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Create a new character."""
    name = body.get("name", "").strip()
    if not name or len(name) > 200:
        raise HTTPException(400, "Character name required (1-200 chars)")

    character = Character(
        project_id=uuid.UUID(body["project_id"]),
        name=name,
        tone_type=body.get("tone_type", "custom"),
        custom_tone_params=body.get("custom_tone_params"),
        catchphrase=body.get("catchphrase"),
        honorific_level=body.get("honorific_level"),
        gender=body.get("gender"),
        visual_features=body.get("visual_features"),
        voice_id=body.get("voice_id"),
        font_id=uuid.UUID(body["font_id"]) if body.get("font_id") else None,
        sort_order=body.get("sort_order", 0),
    )
    db.add(character)
    await db.flush()
    return created_response(data=_char_to_dict(character))

@router.get("/{character_id}")
async def get_character(
    character_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    char = (await db.execute(select(Character).where(Character.character_id == character_id))).scalar_one_or_none()
    if not char:
        raise ResourceNotFound("Character", character_id)
    return success_response(data=_char_to_dict(char))

@router.put("/{character_id}")
async def update_character(
    character_id: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    char = (await db.execute(select(Character).where(Character.character_id == character_id))).scalar_one_or_none()
    if not char:
        raise ResourceNotFound("Character", character_id)

    updatable = ["name", "tone_type", "custom_tone_params", "catchphrase", "honorific_level", "gender", "visual_features", "voice_id", "font_id", "sort_order"]
    for key in updatable:
        if key in body:
            val = body[key]
            if key == "font_id" and val:
                val = uuid.UUID(val)
            setattr(char, key, val)
    await db.flush()
    return success_response(data=_char_to_dict(char))

@router.delete("/{character_id}")
async def delete_character(
    character_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    char = (await db.execute(select(Character).where(Character.character_id == character_id))).scalar_one_or_none()
    if not char:
        raise ResourceNotFound("Character", character_id)
    await db.delete(char)
    return success_response(message="Character deleted")

@router.post("/auto-detect")
async def auto_detect_characters(
    project_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Auto-detect characters based on text region patterns (heuristic-based)."""
    from common.models.page import Page
    from common.models.chapter import Chapter

    # 取该作品所有章节 → 页面 → 文字区域（显式子查询，模型无 ORM relationship）
    chapter_ids = select(Chapter.chapter_id).where(Chapter.project_id == uuid.UUID(project_id))
    page_ids = select(Page.page_id).where(Page.chapter_id.in_(chapter_ids))
    regions = (await db.execute(
        select(TextRegion).where(TextRegion.page_id.in_(page_ids))
    )).scalars().all()
    
    # Simplified heuristic: group regions by speaker patterns
    speakers = {}
    for r in regions:
        if r.original_text:
            prefix = r.original_text[:3]
            speakers.setdefault(prefix, []).append(r)

    detected = []
    for prefix, regs in speakers.items():
        if len(regs) >= 3:
            existing = (await db.execute(select(Character).where(Character.project_id == project_id, Character.visual_features.contains([prefix])))).scalar_one_or_none()
            if not existing:
                char = Character(
                    project_id=uuid.UUID(project_id),
                    name=f"检测角色_{len(detected)+1}",
                    tone_type="custom",
                    visual_features=[prefix],
                )
                db.add(char)
                detected.append(char)
    
    await db.flush()
    return success_response(data={"detected": [_char_to_dict(c) for c in detected], "count": len(detected)})

def _char_to_dict(c: Character) -> dict:
    return {
        "character_id": str(c.character_id),
        "project_id": str(c.project_id),
        "name": c.name,
        "tone_type": c.tone_type,
        "custom_tone_params": c.custom_tone_params,
        "catchphrase": c.catchphrase,
        "honorific_level": c.honorific_level,
        "gender": c.gender,
        "visual_features": c.visual_features,
        "voice_id": c.voice_id,
        "font_id": str(c.font_id) if c.font_id else None,
        "sort_order": c.sort_order,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
    }
