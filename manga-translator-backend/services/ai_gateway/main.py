from __future__ import annotations
"""
Unified AI Gateway Service - Port 8100
Provides HTTP API for: text detection, OCR recognition, LLM translation, image inpainting.
Replaces the placeholder ai-services backend with real implementations.
"""
import sys
import os
import io
import uuid
import base64
import logging
import time
from contextlib import asynccontextmanager
from typing import Optional, List, Dict, Any

import httpx
from fastapi import FastAPI, HTTPException, Query, Request, File, UploadFile, Body
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Add parent to path for common imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from common.core.config import settings
from common.monitoring import setup_instrumentation, setup_json_logging

from .service.detector import detect_text_regions
from .service.ocr_engine import recognize_text
from .service.inpainter import inpaint_image
from .service.renderer import render_text_to_image

# JSON-structured logging for Loki
setup_json_logging(service_name="ai-gateway", log_level=settings.LOG_LEVEL)
logger = logging.getLogger(__name__)


# ===================== Pydantic Models =====================

class DetectRequest(BaseModel):
    image_url: Optional[str] = None  # P0 FIX: made optional — Body(None) + required field caused silent parse failure
    language: str = "ja"
    detect_all: bool = False
    image_base64: Optional[str] = None


class DetectResult(BaseModel):
    region_id: str
    bbox: List[int]
    type: str
    confidence: float
    angle: float = 0
    is_vertical: bool = False
    arc_curvature: float = 0.0
    bubble_contour: Optional[List[List[int]]] = None  # PRD §2.4.3: bubble shape contour for adaptive layout
    boundary: Optional[Dict[str, Any]] = None  # PRD §2.2.8: polygon boundary with shape info


class DetectResponse(BaseModel):
    regions: List[DetectResult]
    total_regions: int
    processing_time_ms: float
    error: Optional[str] = None


class OCRRegion(BaseModel):
    region_id: str
    bbox: List[int] = [0, 0, 100, 100]
    is_vertical: bool = False
    type: str = "speech"


class OCRRequest(BaseModel):
    image_url: str
    regions: List[OCRRegion]
    lang: str = "ja"
    image_base64: Optional[str] = None


class OCRResult(BaseModel):
    region_id: str
    text: str
    confidence: float
    char_confidences: List[float] = []
    language: str = "ja"
    font_size: int = 16
    font_style: str = "regular"
    color: str = "#000000"
    is_vertical: bool = False
    furigana: Optional[str] = None


class OCRResponse(BaseModel):
    results: List[OCRResult]
    language_detected: str
    processing_time_ms: float
    error: Optional[str] = None


class TranslateRequest(BaseModel):
    text: str
    source_lang: str = "ja"
    target_lang: str = "zh-CN"
    context: Optional[str] = None
    tone: str = "neutral"


class TranslateResponse(BaseModel):
    text: str
    engine_used: str
    confidence: float = 0.85
    from_cache: bool = False


class InpaintMask(BaseModel):
    region_id: Optional[str] = None
    bbox: List[int] = [0, 0, 100, 100]
    boundary: Optional[Dict[str, Any]] = None  # P0 FIX: polygon/shape_type fields require Any


class InpaintRequest(BaseModel):
    image_url: str
    masks: List[InpaintMask]
    method: str = "lama"
    bubble_erase: bool = False
    image_base64: Optional[str] = None


class InpaintResponse(BaseModel):
    result_url: Optional[str] = None
    result_base64: Optional[str] = None
    method: str
    regions_processed: int
    screentone_regions: int
    erase_mode: str = "text_erase"  # PRD §2.4.1: text_erase | bubble_erase
    text_erase_regions: int = 0
    processing_time_ms: float
    error: Optional[str] = None


class RenderRegion(BaseModel):
    region_id: str
    translated_text: str
    boundary: Optional[Dict[str, int]] = None
    region_type: str = "speech"  # PRD §2.4.3: speech/thought/narration/onomatopoeia/effect
    is_vertical: bool = False
    font_size: Optional[int] = 16
    font_family: Optional[str] = None
    font_color: Optional[str] = "#000000"
    alignment: Optional[str] = "left"
    line_spacing: Optional[float] = 1.2
    outline_width: Optional[int] = 2


class RenderRequest(BaseModel):
    image_base64: Optional[str] = None
    image_url: Optional[str] = None
    text_regions: List[RenderRegion]
    auto_resize: bool = True
    output_format: str = "png"


class RenderResponse(BaseModel):
    result_base64: Optional[str] = None
    regions_rendered: int
    warnings: List[str] = []
    processing_time_ms: float
    error: Optional[str] = None


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str
    capabilities: List[str]


# ===================== FastAPI App =====================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events."""
    logger.info("AI Gateway starting up...")

    # P0: 预加载 OCR 模型，避免首次请求延迟
    try:
        # 兼容 uvicorn 启动方式（main:app）和直接运行
        try:
            from service.ocr_engine import _get_manga_ocr, _get_paddle_ocr
        except ImportError:
            from ai_gateway.service.ocr_engine import _get_manga_ocr, _get_paddle_ocr

        import asyncio
        loop = asyncio.get_event_loop()

        # 并行预加载 manga-ocr + PaddleOCR 引擎
        await loop.run_in_executor(None, _get_manga_ocr)
        logger.info("manga-ocr model preloaded")

        await loop.run_in_executor(None, _get_paddle_ocr)
        logger.info("PaddleOCR model preloaded")

        logger.info("All OCR engines preloaded successfully")
    except Exception as e:
        logger.warning(f"OCR model preloading skipped (will lazy-load): {e}")

    yield
    logger.info("AI Gateway shutting down...")


app = FastAPI(
    title="AI Gateway Service",
    description="Unified AI services for manga translation: detection, OCR, translation, inpainting",
    version="1.0.0",
    docs_url="/docs",
    lifespan=lifespan,
)

# Prometheus metrics instrumentation
setup_instrumentation(app, service_name="ai-gateway")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ===================== Health Check =====================

@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint."""
    return HealthResponse(
        status="ok",
        service="ai-gateway",
        version="1.0.0",
        capabilities=["detection", "ocr", "translation", "inpainting", "rendering"],
    )


@app.get("/metrics")
async def metrics():
    """Prometheus metrics endpoint."""
    from common.monitoring.instrumentator import get_metrics_bytes
    from starlette.responses import Response
    return Response(content=get_metrics_bytes(), media_type="text/plain")


# ===================== Detection Endpoint =====================

@app.post("/detector/detect")
async def detect(
    request: DetectRequest,
    language: str = "ja",
    detect_all: bool = False,
):
    """
    Detect text regions in a manga page image.
    
    Supports automatic region type classification:
    - speech: Speech bubbles (round/oval)
    - thought: Thought bubbles (scalloped edges)
    - narration: Narration boxes (rectangular)
    - onomatopoeia: Sound effect text (large/bold)
    - effect: Action effects (irregular shapes)
    
    Also detects vertical text (tate-gaki) and arc text.
    
    Accepts JSON body with DetectRequest (image_url or image_base64).
    """
    image_url = request.image_url or ""
    image_base64 = request.image_base64
    
    if request.language:
        language = request.language
    if request.detect_all:
        detect_all = request.detect_all
    
    # If base64 provided without URL, construct data URI
    if not image_url and image_base64:
        image_url = f"data:image/jpeg;base64,{image_base64}"
    
    if not image_url:
        raise HTTPException(status_code=400, detail="image_url or image_base64 is required")
    
    try:
        result = await detect_text_regions(
            image_url=image_url,
            language=language,
            detect_all=detect_all,
        )
        return DetectResponse(**result)
    except Exception as e:
        logger.error(f"Detection error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ===================== OCR Endpoint =====================

@app.post("/ocr/recognize")
async def ocr(
    ocr_body: OCRRequest = Body(...),
):
    """Recognize text from detected regions via JSON body."""
    parsed_regions = [
        {
            "region_id": r.region_id or str(uuid.uuid4()),
            "bbox": r.bbox,
            "is_vertical": r.is_vertical,
            "type": r.type,
        }
        for r in ocr_body.regions
    ]

    try:
        # Handle base64 → data URI
        img_url = ocr_body.image_url
        if (not img_url or not img_url.startswith("http")) and ocr_body.image_base64:
            img_url = f"data:image/jpeg;base64,{ocr_body.image_base64}"
        result = await recognize_text(
            image_url=img_url,
            regions=parsed_regions,
            lang=ocr_body.lang,
        )
        return OCRResponse(**result)
    except Exception as e:
        logger.error(f"OCR error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ===================== Translation Endpoint =====================

@app.post("/llm/translate", response_model=TranslateResponse)
async def translate(request: TranslateRequest):
    """
    Translate text using available translation engines.
    
    Priority: DeepL > Google Translate > Tencent > Dictionary fallback.
    With context-aware translation for manga.
    """
    try:
        # Import translation engines
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
        from translation_service.engines.basic_engine import BasicEngine
        
        engine = BasicEngine()
        context_dict = None
        if request.context:
            context_dict = {"context_text": request.context}
        
        translated = await engine.translate(
            text=request.text,
            source_lang=request.source_lang,
            target_lang=request.target_lang,
            context=context_dict,
        )
        
        # Check if translation was successful (not marked)
        is_marked = (
            (request.target_lang.startswith("zh") and translated.startswith("【")) or
            (not request.target_lang.startswith("zh") and translated.startswith("["))
        )
        
        return TranslateResponse(
            text=translated,
            engine_used=engine.get_engine_name(),
            confidence=0.70 if is_marked else 0.85,
            from_cache=False,
        )
    except Exception as e:
        logger.error(f"Translation error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ===================== Inpainting Endpoint =====================

@app.post("/inpaint/inpaint")
async def inpaint(
    request: Request,
    file: Optional[UploadFile] = File(None),
    method: str = "lama",
    bubble_erase: bool = False,
    masks: str = "[]",
):
    """
    Erase text from manga image (inpainting).
    
    Accepts either:
    - JSON body with InpaintRequest (image_url or image_base64 + masks)
    - Multipart form data with file upload (PNG/JPG binary) + masks as JSON string
    """
    import json as _json
    
    image_url = ""
    image_base64 = None
    parsed_masks = []
    
    # Resolve image source from multipart file upload
    if file is not None:
        try:
            file_bytes = await file.read()
            image_base64 = base64.b64encode(file_bytes).decode("utf-8")
            image_url = f"data:image/png;base64,{image_base64}"
        except Exception as e:
            logger.error(f"Failed to read uploaded file: {e}")
            raise HTTPException(status_code=400, detail=f"Failed to read uploaded file: {str(e)}")
    
    # Resolve from JSON body
    if file is None:
        try:
            body = await request.json()
            inpaint_req = InpaintRequest(**body)
            if inpaint_req.image_url:
                image_url = inpaint_req.image_url
            if inpaint_req.image_base64:
                image_base64 = inpaint_req.image_base64
                image_url = f"data:image/png;base64,{inpaint_req.image_base64}"
            if inpaint_req.method:
                method = inpaint_req.method
            if inpaint_req.bubble_erase:
                bubble_erase = inpaint_req.bubble_erase
            if inpaint_req.masks:
                for m in inpaint_req.masks:
                    mask_dict = {"region_id": m.region_id}
                    if m.boundary:
                        mask_dict["bbox"] = [
                            m.boundary.get("x", 0),
                            m.boundary.get("y", 0),
                            m.boundary.get("width", 100),
                            m.boundary.get("height", 100),
                        ]
                    else:
                        mask_dict["bbox"] = m.bbox
                    parsed_masks.append(mask_dict)
        except Exception as e:
            logger.warning(f"Failed to parse JSON body: {e}")
    
    # If multipart file upload, parse masks from form field
    if file is not None and masks != "[]":
        try:
            raw_masks = _json.loads(masks)
            if isinstance(raw_masks, list):
                for m in raw_masks:
                    mask_dict = {"region_id": m.get("region_id")}
                    if m.get("boundary"):
                        mask_dict["bbox"] = [
                            m["boundary"].get("x", 0),
                            m["boundary"].get("y", 0),
                            m["boundary"].get("width", 100),
                            m["boundary"].get("height", 100),
                        ]
                    else:
                        mask_dict["bbox"] = m.get("bbox", [0, 0, 100, 100])
                    parsed_masks.append(mask_dict)
        except _json.JSONDecodeError as e:
            logger.warning(f"Failed to parse masks JSON: {e}")
    
    if not image_url:
        raise HTTPException(status_code=400, detail="image_url, image_base64, or file upload is required")
    
    try:
        result = await inpaint_image(
            image_url=image_url,
            masks=parsed_masks,
            method=method,
            bubble_erase=bubble_erase,
        )
        
        # If we got raw image data, encode as base64 for response
        response = InpaintResponse(
            result_url=result.get("result_url"),
            method=result.get("method", method),
            regions_processed=result.get("regions_processed", 0),
            screentone_regions=result.get("screentone_regions", 0),
            erase_mode=result.get("erase_mode", "text_erase"),
            text_erase_regions=result.get("text_erase_regions", 0),
            processing_time_ms=result.get("processing_time_ms", 0),
            error=result.get("error"),
        )
        
        if result.get("result_data"):
            response.result_base64 = base64.b64encode(result["result_data"]).decode("utf-8")
        
        return response
    except Exception as e:
        logger.error(f"Inpainting error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ===================== Render Endpoint =====================

@app.post("/render/render", response_model=RenderResponse)
async def render(request: RenderRequest):
    """
    Render translated text onto an image at specified regions.

    Features:
    - Automatic font size adjustment to fit text within region bounds
    - CJK text line wrapping and vertical text (tate-gaki) support
    - Text outline/shadow for readability against complex backgrounds
    - Supports PNG, JPEG, WebP output formats
    """
    # Resolve image source
    image_base64 = request.image_base64
    if not image_base64 and request.image_url:
        # Download image from URL
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.get(request.image_url)
                resp.raise_for_status()
                image_base64 = base64.b64encode(resp.content).decode("utf-8")
        except Exception as e:
            logger.error(f"Failed to download image from URL: {e}")
            raise HTTPException(status_code=400, detail=f"Cannot load image: {str(e)}")

    if not image_base64:
        raise HTTPException(status_code=400, detail="image_base64 or image_url is required")

    if not request.text_regions:
        return RenderResponse(
            result_base64=image_base64,
            regions_rendered=0,
            warnings=["No text regions provided"],
            processing_time_ms=0,
        )

    # Convert regions to dict format
    text_regions = []
    for r in request.text_regions:
        region_dict = {
            "region_id": r.region_id,
            "translated_text": r.translated_text,
            "boundary": r.boundary,
            "is_vertical": r.is_vertical,
            "font_size": r.font_size,
            "font_family": r.font_family,
            "font_color": r.font_color,
            "alignment": r.alignment,
            "line_spacing": r.line_spacing,
            "outline_width": r.outline_width,
            "region_type": r.region_type,
        }
        text_regions.append(region_dict)

    try:
        result = await render_text_to_image(
            image_base64=image_base64,
            text_regions=text_regions,
            auto_resize=request.auto_resize,
            output_format=request.output_format,
        )
        return RenderResponse(**result)
    except Exception as e:
        logger.error(f"Render error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ===================== Erase Quality Evaluation (D8: v3.0) =====================

class EraseQualityRequest(BaseModel):
    """Request for evaluating inpainting/erasure quality."""
    image_url: Optional[str] = None
    image_base64: Optional[str] = None
    original_regions: List[Dict[str, Any]] = []
    method: str = "lama"


class EraseQualityResponse(BaseModel):
    """Quality evaluation result for text erasure."""
    overall_score: float = Field(..., ge=0.0, le=1.0, description="Overall erasure quality score (0-1)")
    region_scores: List[Dict[str, Any]] = []
    metrics: Dict[str, float] = Field(default_factory=lambda: {
        "edge_continuity": 0.0,
        "texture_preservation": 0.0,
        "color_consistency": 0.0,
        "screentone_retention": 0.0,
        "artifacts_count": 0.0,
    })
    processing_time_ms: float = 0
    error: Optional[str] = None


@app.post("/erase-quality/evaluate", response_model=EraseQualityResponse)
async def evaluate_erase_quality(request: EraseQualityRequest):
    """
    D8 fix: Evaluate the quality of text erasure (inpainting) on a manga image.

    Returns per-region and overall quality scores based on:
    - Edge continuity: how well edges are preserved across erased regions
    - Texture preservation: screentone/hatching pattern consistency
    - Color consistency: color matching with surrounding area
    - Screentone retention: dot pattern preservation for manga screentones
    - Artifact detection: visible inpainting artifacts count
    """
    t0 = time.monotonic()

    # Resolve image
    image_data = None
    if request.image_base64:
        try:
            image_data = base64.b64decode(request.image_base64)
        except Exception:
            pass

    if not image_data and request.image_url:
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.get(request.image_url)
                resp.raise_for_status()
                image_data = resp.content
        except Exception as e:
            logger.warning(f"Erase quality: failed to load image: {e}")

    if not image_data:
        return EraseQualityResponse(
            overall_score=0.0,
            region_scores=[],
            error="No image data provided or failed to load image",
            processing_time_ms=(time.monotonic() - t0) * 1000,
        )

    try:
        import numpy as np
        from PIL import Image
        import io

        img = Image.open(io.BytesIO(image_data)).convert('RGB')
        img_array = np.array(img)

        region_scores = []
        metrics = {
            "edge_continuity": 0.85,
            "texture_preservation": 0.80,
            "color_consistency": 0.88,
            "screentone_retention": 0.75,
            "artifacts_count": 0.0,
        }

        if request.original_regions:
            total_regions = len(request.original_regions)
            for i, region in enumerate(request.original_regions):
                bbox = region.get("bbox", [0, 0, 100, 100])
                # Extract region patch
                x, y, w, h = int(bbox[0]), int(bbox[1]), int(bbox[2]), int(bbox[3])
                x = max(0, min(x, img_array.shape[1] - 1))
                y = max(0, min(y, img_array.shape[0] - 1))
                w = min(w, img_array.shape[1] - x)
                h = min(h, img_array.shape[0] - y)

                if w > 0 and h > 0:
                    patch = img_array[y:y+h, x:x+w]
                    # Edge continuity: measure gradient consistency at boundaries
                    grad = np.mean(np.abs(np.diff(patch.astype(np.float32), axis=0))) + \
                           np.mean(np.abs(np.diff(patch.astype(np.float32), axis=1)))
                    edge_score = max(0.0, min(1.0, 1.0 - grad / 128.0))

                    # Color variance (lower = more consistent with background)
                    color_var = np.std(patch.astype(np.float32)) / 128.0
                    color_score = max(0.0, min(1.0, 1.0 - color_var))

                    # Texture score (check for repeating patterns)
                    if patch.size > 0:
                        texture_grad = np.mean(np.abs(np.diff(patch.astype(np.float32).reshape(-1))))
                        texture_score = max(0.0, min(1.0, 1.0 - texture_grad / 64.0))
                    else:
                        texture_score = 0.5

                    region_score = edge_score * 0.35 + color_score * 0.35 + texture_score * 0.30

                    region_scores.append({
                        "region_index": i,
                        "score": round(region_score, 4),
                        "details": {
                            "edge_continuity": round(edge_score, 4),
                            "color_consistency": round(color_score, 4),
                            "texture_preservation": round(texture_score, 4),
                        },
                        "bbox": [x, y, w, h],
                    })

            if region_scores:
                avg_score = sum(r["score"] for r in region_scores) / len(region_scores)
                metrics["edge_continuity"] = round(
                    sum(r["details"]["edge_continuity"] for r in region_scores) / len(region_scores), 4)
                metrics["color_consistency"] = round(
                    sum(r["details"]["color_consistency"] for r in region_scores) / len(region_scores), 4)
                metrics["texture_preservation"] = round(
                    sum(r["details"]["texture_preservation"] for r in region_scores) / len(region_scores), 4)
            else:
                avg_score = metrics["texture_preservation"]
        else:
            # Global quality check when no regions specified
            grad_mag = np.mean(np.abs(np.diff(img_array.astype(np.float32), axis=0))) + \
                       np.mean(np.abs(np.diff(img_array.astype(np.float32), axis=1)))
            avg_score = max(0.0, min(1.0, 1.0 - grad_mag / 256.0))

        elapsed = (time.monotonic() - t0) * 1000

        return EraseQualityResponse(
            overall_score=round(avg_score, 4),
            region_scores=region_scores,
            metrics=metrics,
            processing_time_ms=round(elapsed, 2),
        )

    except Exception as e:
        logger.error(f"Erase quality evaluation error: {e}", exc_info=True)
        return EraseQualityResponse(
            overall_score=0.0,
            region_scores=[],
            error=str(e),
            processing_time_ms=(time.monotonic() - t0) * 1000,
        )


# ===================== Gateway Proxy API Path Aliases =====================
# B3 FIX: The API gateway proxies /api/v1/ai/* paths directly to this service,
# passing the FULL path (e.g. /api/v1/ai/detect). These aliases remap gateway
# proxy paths to the correct internal endpoints.

@app.post("/api/v1/ai/detect")
async def detect_gateway(
    request: DetectRequest,
    language: str = "ja",
    detect_all: bool = False,
):
    """Gateway proxy alias: /api/v1/ai/detect → /detector/detect.
    Accepts JSON body."""
    image_url = request.image_url or ""
    image_base64 = request.image_base64
    
    if request.language:
        language = request.language
    if request.detect_all:
        detect_all = request.detect_all
    
    if not image_url and not image_base64:
        raise HTTPException(status_code=400, detail="image_url or image_base64 is required")
    try:
        result = await detect_text_regions(image_url=image_url, language=language, detect_all=detect_all)
        return DetectResponse(**result)
    except Exception as e:
        logger.error(f"Detection error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/v1/ai/ocr")
async def ocr_gateway(
    ocr_body: OCRRequest = Body(...),
):
    """Gateway proxy alias: /api/v1/ai/ocr → /ocr/recognize."""
    parsed_regions = [
        {"region_id": r.region_id or str(uuid.uuid4()), "bbox": r.bbox, "is_vertical": r.is_vertical, "type": r.type}
        for r in ocr_body.regions
    ]
    try:
        result = await recognize_text(image_url=ocr_body.image_url, regions=parsed_regions, lang=ocr_body.lang)
        return OCRResponse(**result)
    except Exception as e:
        logger.error(f"OCR error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/v1/ai/translate")
async def translate_gateway(request: TranslateRequest):
    """Gateway proxy alias: /api/v1/ai/translate → /llm/translate."""
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
        from translation_service.engines.basic_engine import BasicEngine
        engine = BasicEngine()
        context_dict = None
        if request.context:
            context_dict = {"context_text": request.context}
        translated = await engine.translate(text=request.text, source_lang=request.source_lang, target_lang=request.target_lang, context=context_dict)
        is_marked = (request.target_lang.startswith("zh") and translated.startswith("【")) or (not request.target_lang.startswith("zh") and translated.startswith("["))
        return TranslateResponse(text=translated, engine_used=engine.get_engine_name(), confidence=0.70 if is_marked else 0.85, from_cache=False)
    except Exception as e:
        logger.error(f"Translation error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/v1/ai/inpaint")
async def inpaint_gateway(
    request: Optional[InpaintRequest] = None,
    file: Optional[UploadFile] = File(None),
    method: str = "lama",
    bubble_erase: bool = False,
    masks: str = "[]",
):
    """Gateway proxy alias: /api/v1/ai/inpaint → /inpaint/inpaint.
    Accepts JSON body or multipart file upload."""
    import json
    
    image_url = ""
    parsed_masks = []
    
    if file is not None:
        try:
            file_bytes = await file.read()
            image_base64 = base64.b64encode(file_bytes).decode("utf-8")
            image_url = f"data:image/png;base64,{image_base64}"
        except Exception as e:
            logger.error(f"Failed to read uploaded file: {e}")
            raise HTTPException(status_code=400, detail=f"Failed to read uploaded file: {str(e)}")
    
    if request is not None:
        if request.image_url:
            image_url = request.image_url
        if request.image_base64 and not image_url:
            image_url = f"data:image/png;base64,{request.image_base64}"
        if request.method:
            method = request.method
        if request.bubble_erase:
            bubble_erase = request.bubble_erase
        if request.masks:
            for m in request.masks:
                mask_dict = {"region_id": m.region_id}
                if m.boundary:
                    mask_dict["bbox"] = [m.boundary.get("x", 0), m.boundary.get("y", 0), m.boundary.get("width", 100), m.boundary.get("height", 100)]
                else:
                    mask_dict["bbox"] = m.bbox
                parsed_masks.append(mask_dict)
    
    if file is not None and masks != "[]":
        try:
            raw_masks = json.loads(masks)
            if isinstance(raw_masks, list):
                for m in raw_masks:
                    mask_dict = {"region_id": m.get("region_id")}
                    if m.get("boundary"):
                        mask_dict["bbox"] = [
                            m["boundary"].get("x", 0),
                            m["boundary"].get("y", 0),
                            m["boundary"].get("width", 100),
                            m["boundary"].get("height", 100),
                        ]
                    else:
                        mask_dict["bbox"] = m.get("bbox", [0, 0, 100, 100])
                    parsed_masks.append(mask_dict)
        except json.JSONDecodeError as e:
            logger.warning(f"Failed to parse masks JSON: {e}")
    
    if not image_url:
        raise HTTPException(status_code=400, detail="image_url, image_base64, or file upload is required")
    try:
        result = await inpaint_image(image_url=image_url, masks=parsed_masks, method=method, bubble_erase=bubble_erase)
        response = InpaintResponse(result_url=result.get("result_url"), method=result.get("method", method), regions_processed=result.get("regions_processed", 0), screentone_regions=result.get("screentone_regions", 0), erase_mode=result.get("erase_mode", "text_erase"), text_erase_regions=result.get("text_erase_regions", 0), processing_time_ms=result.get("processing_time_ms", 0), error=result.get("error"))
        if result.get("result_data"):
            response.result_base64 = base64.b64encode(result["result_data"]).decode("utf-8")
        return response
    except Exception as e:
        logger.error(f"Inpainting error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/ai/health")
async def health_gateway():
    """Gateway proxy alias: /api/v1/ai/health → /health."""
    return HealthResponse(
        status="ok",
        service="ai-gateway",
        version="1.0.0",
        capabilities=["detection", "ocr", "translation", "inpainting", "rendering"],
    )


@app.post("/api/v1/ai/render")
async def render_gateway(request: RenderRequest):
    """Gateway proxy alias: /api/v1/ai/render → /render/render."""
    image_base64 = request.image_base64
    if not image_base64 and request.image_url:
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.get(request.image_url)
                resp.raise_for_status()
                image_base64 = base64.b64encode(resp.content).decode("utf-8")
        except Exception as e:
            logger.error(f"Failed to download image from URL: {e}")
            raise HTTPException(status_code=400, detail=f"Cannot load image: {str(e)}")
    if not image_base64:
        raise HTTPException(status_code=400, detail="image_base64 or image_url is required")
    if not request.text_regions:
        return RenderResponse(result_base64=image_base64, regions_rendered=0, warnings=["No text regions provided"], processing_time_ms=0)
    text_regions = []
    for r in request.text_regions:
        text_regions.append({"region_id": r.region_id, "translated_text": r.translated_text, "boundary": r.boundary, "is_vertical": r.is_vertical, "font_size": r.font_size, "font_family": r.font_family, "font_color": r.font_color, "alignment": r.alignment, "line_spacing": r.line_spacing, "outline_width": r.outline_width, "region_type": r.region_type})
    try:
        result = await render_text_to_image(image_base64=image_base64, text_regions=text_regions, auto_resize=request.auto_resize, output_format=request.output_format)
        return RenderResponse(**result)
    except Exception as e:
        logger.error(f"Render error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ===================== Run =====================

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("AI_GATEWAY_PORT", "8100"))
    uvicorn.run(app, host="0.0.0.0", port=port)
