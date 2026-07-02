from __future__ import annotations
"""
批量处理 API — 一键执行 detect→ocr→translate→inpaint→render 完整链路

POST /pages/{page_id}/batch-process  — 同步执行多个处理步骤
GET  /pages/{page_id}/batch-process/{task_id} — 查询批量任务状态
"""
import uuid
import logging
from typing import List, Optional, Dict, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from common.core.database import get_db
from common.core.security import get_current_user

from ..service.detect_service import DetectService
from ..service.ocr_service import OcrService
from ..service.inpaint_service import InpaintService
from ..service.render_service import RenderService
from ..service.enhance_service import EnhanceService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/pages", tags=["Batch Processing"])

AVAILABLE_STEPS = ["detect", "ocr", "translate", "inpaint", "render", "enhance"]


class BatchProcessRequest(BaseModel):
    steps: List[str] = Field(
        default=["detect", "ocr", "translate", "inpaint", "render"],
        description="要执行的处理步骤，按顺序执行",
    )
    source_lang: str = Field(default="ja", description="源语言代码")
    target_lang: str = Field(default="zh", description="目标语言代码")
    detect_all: bool = Field(default=False, description="检测所有文字区域（否则仅气泡）")
    inpaint_method: str = Field(default="lama", description="修复方法：lama/telea")
    preserve_style: bool = Field(default=True, description="渲染时保留原文字样式")
    auto_resize: bool = Field(default=True, description="自动调整字号")


class StepResult(BaseModel):
    step: str
    status: str  # completed / failed / skipped
    task_id: Optional[str] = None
    error: Optional[str] = None
    data: Optional[Dict[str, Any]] = None


class BatchProcessResponse(BaseModel):
    task_id: str
    overall_status: str  # completed / partial / failed
    results: List[StepResult] = []
    message: str = ""


@router.post("/{page_id}/batch-process", response_model=BatchProcessResponse, summary="一键批量处理")
async def batch_process(
    page_id: str,
    request: BatchProcessRequest,
    db=Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    按顺序执行指定处理步骤，一键完成从检测到渲染的完整流程。

    支持步骤：
    - **detect**: 文字区域检测
    - **ocr**: OCR文字识别
    - **translate**: 文本翻译（通过内部HTTP调用 translation-service）
    - **inpaint**: 背景修复（擦除原文）
    - **render**: 文字回填渲染
    - **enhance**: 画质增强

    示例：
    ```json
    {
      "steps": ["detect", "ocr", "translate", "inpaint", "render"],
      "source_lang": "ja",
      "target_lang": "zh"
    }
    ```
    """
    # Validate steps
    invalid_steps = [s for s in request.steps if s not in AVAILABLE_STEPS]
    if invalid_steps:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid steps: {invalid_steps}. Available: {AVAILABLE_STEPS}",
        )

    task_id = str(uuid.uuid4())
    user_id = current_user["sub"]
    results: List[StepResult] = []
    last_detect_result = None

    for step in request.steps:
        step_task_id = str(uuid.uuid4())
        try:
            if step == "detect":
                service = DetectService(db)
                detect_result = await service.detect(
                    page_id, user_id, request.detect_all, request.source_lang,
                )
                last_detect_result = detect_result
                results.append(StepResult(
                    step="detect",
                    status="completed",
                    task_id=step_task_id,
                    data={"regions_count": len(detect_result.get("regions", []))},
                ))

            elif step == "ocr":
                service = OcrService(db)
                ocr_result = await service.recognize(
                    page_id=page_id,
                    user_id=user_id,
                    region_ids=None,
                    language=request.source_lang,
                )
                results.append(StepResult(
                    step="ocr",
                    status="completed",
                    task_id=step_task_id,
                    data={"texts_recognized": len(ocr_result.get("results", []))},
                ))

            elif step == "translate":
                # 先获取 OCR 结果中的文字
                ocr_texts = await _get_ocr_texts(db, page_id)
                if ocr_texts:
                    # 通过内部 HTTP 调用 translation-service
                    translated = await _call_translation_service(
                        page_id, ocr_texts, request.source_lang, request.target_lang
                    )
                    results.append(StepResult(
                        step="translate",
                        status="completed",
                        task_id=step_task_id,
                        data={"regions_translated": len(translated.get("results", []))},
                    ))
                else:
                    results.append(StepResult(
                        step="translate",
                        status="skipped",
                        task_id=step_task_id,
                        error="No OCR texts to translate",
                    ))

            elif step == "inpaint":
                service = InpaintService(db)
                inpaint_result = await service.inpaint(
                    page_id=page_id,
                    user_id=user_id,
                    region_ids=None,
                    method=request.inpaint_method,
                    background_preserve=True,
                )
                results.append(StepResult(
                    step="inpaint",
                    status="completed",
                    task_id=step_task_id,
                    data={"result_url": inpaint_result.get("result_url")},
                ))

            elif step == "render":
                # 收集翻译后的区域数据
                regions_data = await _collect_render_regions(db, page_id)
                if regions_data:
                    service = RenderService(db)
                    render_result = await service.render(
                        page_id=page_id,
                        user_id=user_id,
                        regions=regions_data,
                        preserve_style=request.preserve_style,
                        auto_resize=request.auto_resize,
                    )
                    results.append(StepResult(
                        step="render",
                        status="completed",
                        task_id=step_task_id,
                        data={
                            "result_url": render_result.get("result_url"),
                            "regions_rendered": render_result.get("regions_rendered", 0),
                        },
                    ))
                else:
                    results.append(StepResult(
                        step="render",
                        status="skipped",
                        task_id=step_task_id,
                        error="No translated regions to render",
                    ))

            elif step == "enhance":
                service = EnhanceService(db)
                enhance_result = await service.enhance(
                    page_id=page_id,
                    user_id=user_id,
                    method="auto",
                    level=3,
                )
                results.append(StepResult(
                    step="enhance",
                    status="completed",
                    task_id=step_task_id,
                    data={"result_url": enhance_result.get("result_url")},
                ))

        except Exception as e:
            logger.error(f"Batch step '{step}' failed for page {page_id}: {e}")
            results.append(StepResult(
                step=step,
                status="failed",
                task_id=step_task_id,
                error=str(e),
            ))

    # 统计状态
    failed_count = sum(1 for r in results if r.status == "failed")
    if failed_count == 0:
        overall = "completed"
    elif failed_count < len(results):
        overall = "partial"
    else:
        overall = "failed"

    return BatchProcessResponse(
        task_id=task_id,
        overall_status=overall,
        results=results,
        message=f"Processed {len(results)} step(s): {len(results) - failed_count} succeeded, {failed_count} failed",
    )


@router.get("/{page_id}/batch-process/{task_id}", summary="获取批量处理状态")
async def get_batch_status(
    page_id: str,
    task_id: str,
    db=Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    批量处理为同步执行，状态查询返回当前页面处理结果。
    建议使用 POST 返回值直接获取结果。
    """
    from sqlalchemy import select
    from common.models.page import Page

    result = await db.execute(select(Page).where(Page.page_id == page_id))
    page = result.scalar_one_or_none()
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")

    return {
        "task_id": task_id,
        "page_id": page_id,
        "status": page.status,
        "processed_url": page.processed_url,
    }


async def _get_ocr_texts(db, page_id: str) -> List[Dict[str, Any]]:
    """从 DB 获取 OCR 识别结果"""
    from sqlalchemy import select
    from common.models.text_region import TextRegion

    result = await db.execute(
        select(TextRegion)
        .where(TextRegion.page_id == page_id)
        .where(TextRegion.original_text.isnot(None))
        .order_by(TextRegion.sort_order)
    )
    regions = result.scalars().all()
    return [
        {
            "region_id": str(r.region_id),
            "text": r.original_text,
        }
        for r in regions if r.original_text
    ]


async def _call_translation_service(
    page_id: str,
    texts: List[Dict[str, Any]],
    source_lang: str,
    target_lang: str,
) -> Dict[str, Any]:
    """通过内部 HTTP 调用 translation-service 进行翻译"""
    import httpx

    translation_url = os.getenv(
        "TRANSLATION_SERVICE_URL",
        "http://translation-service:8003",
    )

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                f"{translation_url}/api/v1/pages/{page_id}/translate",
                json={
                    "target_lang": target_lang,
                    "engine": "auto",
                    "onomatopoeia_mode": "keep_annotation",
                    "culture_strategy": "localize",
                },
            )
            resp.raise_for_status()
            return resp.json()
    except Exception as e:
        logger.warning(f"Translation service call failed: {e}")
        # 回退：返回原文（未翻译）
        return {
            "results": [
                {"region_id": t["region_id"], "translated_text": t["text"]}
                for t in texts
            ],
        }


async def _collect_render_regions(db, page_id: str) -> List[Dict[str, Any]]:
    """收集需要渲染的区域数据（使用 translated_text）"""
    from sqlalchemy import select
    from common.models.text_region import TextRegion

    result = await db.execute(
        select(TextRegion)
        .where(TextRegion.page_id == page_id)
        .where(TextRegion.translated_text.isnot(None))
        .order_by(TextRegion.sort_order)
    )
    regions = result.scalars().all()
    return [
        {
            "region_id": str(r.region_id),
            "translated_text": r.translated_text,
            "font_size": r.style_config.get("font_size", 16) if r.style_config else 16,
            "alignment": r.style_config.get("alignment", "left") if r.style_config else "left",
        }
        for r in regions if r.translated_text
    ]
