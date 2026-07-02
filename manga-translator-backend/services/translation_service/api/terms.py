from __future__ import annotations
"""
Term management API routes.
"""
import csv
import io
from fastapi import APIRouter, Depends, File, Query, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from common.core.database import get_db
from common.core.response import success_response, created_response, error_response, paginated_response
from common.core.security import get_current_user

from ..service.term_service import TermService

router = APIRouter()


@router.get("")
async def list_terms(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    scope: str = Query(None),
    category: str = Query(None),
    keyword: str = Query(None),
    project_id: str = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """List terms with filtering."""
    service = TermService(db)
    items, total = await service.list_terms(
        user_id=current_user["sub"],
        page=page,
        page_size=page_size,
        scope=scope,
        category=category,
        keyword=keyword,
        project_id=project_id,
    )
    return paginated_response(items=items, page=page, page_size=page_size, total=total)


@router.post("")
async def create_term(
    request_data: dict,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Create a new term entry."""
    service = TermService(db)
    try:
        result = await service.create_term(current_user["sub"], request_data)
        return created_response(data=result, message="Term created")
    except Exception as e:
        return error_response(code=1001, message=str(e))


@router.put("/{term_id}")
async def update_term(
    term_id: str,
    request_data: dict,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Update a term entry."""
    service = TermService(db)
    try:
        result = await service.update_term(term_id, current_user["sub"], request_data)
        return success_response(data=result, message="Term updated")
    except Exception as e:
        return error_response(code=1001, message=str(e))


@router.delete("/{term_id}")
async def delete_term(
    term_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Delete a term entry."""
    service = TermService(db)
    try:
        await service.delete_term(term_id, current_user["sub"])
        return success_response(message="Term deleted")
    except Exception as e:
        return error_response(code=1002, message=str(e), status_code=404)


@router.post("/import")
async def import_terms(
    file: UploadFile = File(..., description="CSV file with source_text,target_text columns"),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Import terms from CSV file."""
    if not file.filename or not file.filename.lower().endswith('.csv'):
        return error_response(code=4003, message="Only CSV files are supported", status_code=415)
    
    try:
        content = await file.read()
        text = content.decode('utf-8-sig')
        reader = csv.DictReader(io.StringIO(text))
        
        service = TermService(db)
        imported = 0
        for row in reader:
            source = row.get('source_text', '').strip()
            target = row.get('target_text', '').strip()
            if source and target:
                try:
                    await service.create_term(current_user["sub"], {
                        "source_text": source,
                        "target_text": target,
                        "note": row.get('note', '').strip() or None,
                        "category": row.get('category', '').strip() or None,
                    })
                    imported += 1
                except Exception:
                    pass  # Skip duplicates
        
        await db.commit()
        return created_response(data={"imported": imported}, message=f"Imported {imported} terms")
    except Exception as e:
        return error_response(code=1001, message=f"Import failed: {str(e)}")


@router.get("/export")
async def export_terms(
    scope: str = Query(None),
    project_id: str = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Export terms as CSV file."""
    service = TermService(db)
    try:
        items, _ = await service.list_terms(
            user_id=current_user["sub"],
            page=1,
            page_size=10000,
            scope=scope,
            project_id=project_id,
        )
        
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=["source_text", "target_text", "note", "category"])
        writer.writeheader()
        for item in items:
            writer.writerow({
                "source_text": item.get("source_text", ""),
                "target_text": item.get("target_text", ""),
                "note": item.get("note", ""),
                "category": item.get("category", ""),
            })
        
        output.seek(0)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=terms_export.csv"}
        )
    except Exception as e:
        return error_response(code=1001, message=f"Export failed: {str(e)}")
