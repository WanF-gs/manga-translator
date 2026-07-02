from __future__ import annotations
"""开放平台外部 API - /api/v1/external/*

对外开放核心 AI 能力（检测/OCR/翻译），以 API Key 鉴权（X-API-Key: msk_xxx）。
每个端点透传到 AI 网关的对应能力，返回结构化结果。

PRD §2.24 / §5.3.14：
    POST /api/v1/external/detect    文本检测
    POST /api/v1/external/ocr       OCR 识别
    POST /api/v1/external/translate 翻译
鉴权见 common/core/api_key_auth.py，网关放行见 gateway auth SkipPaths。
"""
import os
import sys
import logging
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
import httpx

_cur = os.path.dirname(os.path.abspath(__file__))
_svc = os.path.dirname(os.path.dirname(_cur))
if _svc not in sys.path:
    sys.path.insert(0, _svc)

from common.core.api_key_auth import require_api_key
from common.core.config import settings
from common.core.response import success_response

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/external", tags=["Open Platform"])

# AI 网关基址（REST）。默认走内网服务名，本地开发回落 localhost。
AI_BASE = os.getenv("AI_SERVICE_BASE_URL", getattr(settings, "AI_SERVICE_BASE_URL", "http://ai-gateway:8100"))


async def _proxy(path: str, payload: dict) -> dict:
    """转发到 AI 网关并返回其 JSON。网关不可用时抛 503。"""
    url = AI_BASE.rstrip("/") + path
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(url, json=payload)
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPStatusError as e:
        logger.warning(f"AI gateway {path} returned {e.response.status_code}")
        raise HTTPException(status_code=502, detail=f"AI 能力返回错误: {e.response.status_code}")
    except Exception as e:
        logger.warning(f"AI gateway {path} unreachable: {e}")
        raise HTTPException(status_code=503, detail="AI 能力暂不可用")


# ──────────────── 请求模型 ────────────────

class ExternalDetectRequest(BaseModel):
    image_url: Optional[str] = None
    image_base64: Optional[str] = None
    language: str = "ja"
    detect_all: bool = False


class ExternalOCRRegion(BaseModel):
    region_id: Optional[str] = None
    bbox: List[int] = [0, 0, 100, 100]
    is_vertical: bool = False
    type: str = "speech"


class ExternalOCRRequest(BaseModel):
    image_url: str
    regions: List[ExternalOCRRegion]
    lang: str = "ja"


class ExternalTranslateRequest(BaseModel):
    text: str = Field(..., min_length=1)
    source_lang: str = "ja"
    target_lang: str = "zh-CN"
    context: Optional[str] = None
    tone: str = "neutral"


# ──────────────── 端点 ────────────────

@router.post("/detect")
async def external_detect(
    body: ExternalDetectRequest,
    auth: dict = Depends(require_api_key("detect")),
):
    """外部文本检测 API。鉴权：X-API-Key（需 detect 权限）。"""
    if not body.image_url and not body.image_base64:
        raise HTTPException(status_code=400, detail="image_url 或 image_base64 必填")
    result = await _proxy("/api/v1/ai/detect", body.model_dump(exclude_none=True))
    return success_response(data=result)


@router.post("/ocr")
async def external_ocr(
    body: ExternalOCRRequest,
    auth: dict = Depends(require_api_key("ocr")),
):
    """外部 OCR API。鉴权：X-API-Key（需 ocr 权限）。"""
    if not body.regions:
        raise HTTPException(status_code=400, detail="regions 不能为空")
    result = await _proxy("/api/v1/ai/ocr", body.model_dump(exclude_none=True))
    return success_response(data=result)


@router.post("/translate")
async def external_translate(
    body: ExternalTranslateRequest,
    auth: dict = Depends(require_api_key("translate")),
):
    """外部翻译 API。鉴权：X-API-Key（需 translate 权限）。"""
    result = await _proxy("/api/v1/ai/translate", body.model_dump(exclude_none=True))
    return success_response(data=result)
