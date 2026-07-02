from __future__ import annotations
"""
导入智能预处理 API（PRD 2.1.3）

POST /pages/{page_id}/preprocess — 对上传页面执行智能预处理
  · 倾斜校正（≥3°触发）
  · 黑边/白边自动裁切
  · 感知哈希重复检测（与同章节上一页比对）
  · 过暗/过曝曝光优化

真实 CV 算法实现（cv2/numpy），处理后若发生修改则写回 processed_url，
预处理结果保存到 pages.preprocessing_result。
"""
import asyncio
import json
import logging
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Body
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from common.core.database import get_db
from common.core.security import get_current_user
from common.models.page import Page
from ..processors.preprocessor import ImagePreprocessor

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/pages", tags=["Preprocessing"])


class PreprocessOptions(BaseModel):
    auto_rotate: bool = Field(default=True, description="自动倾斜校正（≥3°触发）")
    auto_crop: bool = Field(default=True, description="自动裁切黑边/白边")
    duplicate_check: bool = Field(default=True, description="感知哈希重复检测")
    exposure_fix: bool = Field(default=True, description="过暗/过曝自动优化")


class PreprocessResponse(BaseModel):
    task_id: str
    status: str
    page_id: str
    results: dict = {}
    processed_url: Optional[str] = None
    message: Optional[str] = None


async def _prev_page_hash(db: AsyncSession, page: Page) -> Optional[int]:
    """取同章节内 sort_order 更小的最近一页的 dHash（存于其 preprocessing_result.duplicate_check.phash）。"""
    result = await db.execute(
        select(Page)
        .where(Page.chapter_id == page.chapter_id)
        .where(Page.sort_order < page.sort_order)
        .order_by(Page.sort_order.desc())
        .limit(1)
    )
    prev = result.scalar_one_or_none()
    if not prev or not prev.preprocessing_result:
        return None
    try:
        pr = prev.preprocessing_result
        if isinstance(pr, str):
            pr = json.loads(pr)
        phash_hex = pr.get("duplicate_check", {}).get("phash")
        return int(phash_hex, 16) if phash_hex else None
    except Exception:
        return None


@router.post("/{page_id}/preprocess", response_model=PreprocessResponse, summary="导入智能预处理")
async def preprocess_page(
    page_id: str,
    options: PreprocessOptions = Body(default=PreprocessOptions()),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """对上传的漫画页面执行智能预处理（真实算法）。"""
    result = await db.execute(select(Page).where(Page.page_id == page_id))
    page = result.scalar_one_or_none()
    if not page:
        raise HTTPException(status_code=404, detail="页面不存在")

    if not page.original_url:
        raise HTTPException(status_code=400, detail="页面缺少原图，无法预处理")

    task_id = str(uuid.uuid4())

    # 重复检测：取上一页哈希做比对
    compare_hash = None
    if options.duplicate_check:
        compare_hash = await _prev_page_hash(db, page)

    try:
        # CV 计算是 CPU 密集型同步操作，放到 threadpool 避免阻塞事件循环
        outcome = await asyncio.to_thread(
            ImagePreprocessor.run,
            page.original_url,
            page_id,
            auto_rotate=options.auto_rotate,
            auto_crop=options.auto_crop,
            exposure_fix=options.exposure_fix,
            compare_hash=compare_hash,
        )

        preprocess_results = outcome.get("results", {})
        processed_url = outcome.get("processed_url")

        # 写回 processed_url（若发生修改）
        if processed_url:
            page.processed_url = processed_url

        page.preprocessing_result = json.dumps(preprocess_results, ensure_ascii=False)
        await db.commit()

        return PreprocessResponse(
            task_id=task_id,
            status="completed",
            page_id=page_id,
            results=preprocess_results,
            processed_url=processed_url,
            message="预处理完成",
        )

    except Exception as e:
        logger.error(f"Preprocessing failed for page {page_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"预处理失败: {str(e)}")
