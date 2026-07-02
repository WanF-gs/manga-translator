from __future__ import annotations
"""
Content Safety Moderation API — v3.0 P1 complete deployment.
Wired into image upload and text translation flows.
Part of PRD v3.0 §3.4 Content Safety.
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks

import sys, os, pathlib
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from common.clients.content_safety import content_safety_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/safety", tags=["Content Safety"])


@router.post("/check-image")
async def check_image_safety(image_url: str) -> dict:
    """
    Moderate an image for inappropriate content.
    Returns pass/block/review decision.
    """
    try:
        result = await content_safety_client.check_image(image_url)
        return {
            "code": 0,
            "message": "success",
            "data": {
                "safe": result.get("safe", True),
                "suggestion": result.get("suggestion", "pass"),
                "label": result.get("label", "normal"),
                "confidence": result.get("confidence", 0),
                "details": result.get("details", {}),
            }
        }
    except Exception as e:
        logger.warning(f"Content safety check failed (fail-open): {e}")
        return {
            "code": 0,
            "message": "Safety check skipped (service unavailable)",
            "data": {"safe": True, "suggestion": "pass", "label": "normal"}
        }


@router.post("/check-text")
async def check_text_safety(text: str, language: str = "auto") -> dict:
    """
    Moderate text content for inappropriate material.
    Works with translations and user-submitted content.
    """
    try:
        result = await content_safety_client.check_text(text)
        return {
            "code": 0,
            "message": "success",
            "data": {
                "safe": result.get("safe", True),
                "suggestion": result.get("suggestion", "pass"),
                "label": result.get("label", "normal"),
                "confidence": result.get("confidence", 0),
            }
        }
    except Exception as e:
        logger.warning(f"Text safety check failed (fail-open): {e}")
        return {
            "code": 0,
            "message": "Safety check skipped (service unavailable)",
            "data": {"safe": True, "suggestion": "pass", "label": "normal"}
        }


@router.post("/moderate-upload")
async def moderate_upload(
    image_url: str,
    text_content: Optional[str] = None,
    background_tasks: BackgroundTasks = None,
) -> dict:
    """
    Full content moderation for uploaded manga pages.
    Checks both image and optional text content.
    Stores audit result for content safety compliance.
    """
    try:
        result = await content_safety_client.moderate_upload(image_url, text_content)
        return {
            "code": 0,
            "message": "success",
            "data": {
                "safe": result.get("safe", True),
                "action": result.get("action", "allow"),
                "image": {
                    "safe": result.get("image", {}).get("safe", True),
                    "suggestion": result.get("image", {}).get("suggestion", "pass"),
                    "label": result.get("image", {}).get("label", "normal"),
                },
                "text": result.get("text", {}),
                "overall_confidence": result.get("overall_confidence", 0),
            }
        }
    except Exception as e:
        logger.warning(f"Full moderation failed (fail-open): {e}")
        return {
            "code": 0,
            "message": "Moderation skipped (service unavailable)",
            "data": {"safe": True, "action": "allow", "overall_confidence": 0}
        }
