from __future__ import annotations
"""
Content safety / moderation integration.
Supports Tencent Cloud CMS and Alibaba Cloud Green.
"""
import json
import hashlib
import hmac
import time
import logging
import base64
from typing import Dict, Any, Optional

import httpx

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from common.core.config import settings

logger = logging.getLogger(__name__)


class ContentSafetyClient:
    """Content moderation client supporting multiple providers."""

    def __init__(self):
        self.provider = os.getenv("CONTENT_SAFETY_PROVIDER", "tencent")
        # tencent, alibaba, none

    async def check_image(self, image_url: str) -> Dict[str, Any]:
        """
        Check image for inappropriate content.
        
        Returns:
            {
                "safe": bool,
                "suggestion": "pass" | "block" | "review",
                "label": "normal" | "porn" | "sexy" | "violence" | "bloody" | ...,
                "confidence": float 0-100,
                "details": str
            }
        """
        if self.provider == "tencent":
            return await self._check_tencent_image(image_url)
        elif self.provider == "alibaba":
            return await self._check_alibaba_image(image_url)
        else:
            return {"safe": True, "suggestion": "pass", "label": "normal", "confidence": 100, "details": "Content safety disabled"}

    async def check_text(self, text: str) -> Dict[str, Any]:
        """
        Check text for inappropriate content.
        
        Returns:
            {
                "safe": bool,
                "suggestion": "pass" | "block" | "review",
                "label": "normal" | "spam" | "ad" | "politics" | "abuse" | ...,
                "confidence": float,
            }
        """
        if self.provider == "tencent":
            return await self._check_tencent_text(text)
        elif self.provider == "alibaba":
            return await self._check_alibaba_text(text)
        else:
            return {"safe": True, "suggestion": "pass", "label": "normal", "confidence": 100, "details": "Content safety disabled"}

    async def moderate_upload(self, image_url: str, text_content: Optional[list] = None) -> Dict[str, Any]:
        """
        Combined moderation: check image + extracted text.
        
        Returns:
            {
                "safe": bool,
                "image_result": {...},
                "text_results": [...],
                "action": "allow" | "block" | "flag_for_review",
                "reasons": [...]
            }
        """
        results = {
            "safe": True,
            "image_result": None,
            "text_results": [],
            "action": "allow",
            "reasons": [],
        }

        # Check image
        image_result = await self.check_image(image_url)
        results["image_result"] = image_result

        if not image_result.get("safe", True):
            results["safe"] = False
            if image_result.get("suggestion") == "block":
                results["action"] = "block"
            else:
                results["action"] = "flag_for_review"
            results["reasons"].append(f"Image: {image_result.get('label', 'violation')}")

        # Check text content
        if text_content:
            for text in text_content:
                if text and len(text) > 2:
                    text_result = await self.check_text(text)
                    results["text_results"].append(text_result)
                    if not text_result.get("safe", True):
                        results["safe"] = False
                        if text_result.get("suggestion") == "block":
                            results["action"] = "block"
                        elif results["action"] == "allow":
                            results["action"] = "flag_for_review"
                        results["reasons"].append(f"Text: {text_result.get('label', 'violation')}")

        return results

    async def _check_tencent_image(self, image_url: str) -> Dict[str, Any]:
        """Use Tencent Cloud Image Moderation (IMS)."""
        secret_id = settings.TENCENT_SECRET_ID
        secret_key = settings.TENCENT_SECRET_KEY

        if not secret_id or not secret_key:
            return {"safe": True, "suggestion": "pass", "label": "normal", "confidence": 100}

        try:
            # Download image and convert to base64
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.get(image_url)
                resp.raise_for_status()
                img_b64 = base64.b64encode(resp.content).decode("utf-8")

            service = "ims"
            host = "ims.tencentcloudapi.com"
            endpoint = f"https://{host}"
            action = "ImageModeration"
            version = "2020-12-29"
            region = "ap-guangzhou"

            timestamp = int(time.time())
            date = time.strftime("%Y-%m-%d", time.gmtime(timestamp))

            payload = json.dumps({
                "FileContent": img_b64,
                "FileUrl": image_url,
            })

            # TC3-HMAC-SHA256 signing
            canonical_headers = f"content-type:application/json; charset=utf-8\nhost:{host}\n"
            signed_headers = "content-type;host"
            hashed_payload = hashlib.sha256(payload.encode("utf-8")).hexdigest()

            canonical_request = f"POST\n/\n\n{canonical_headers}\n{signed_headers}\n{hashed_payload}"
            credential_scope = f"{date}/{service}/tc3_request"
            string_to_sign = f"TC3-HMAC-SHA256\n{timestamp}\n{credential_scope}\n{hashlib.sha256(canonical_request.encode('utf-8')).hexdigest()}"

            def _sign(key, msg):
                return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()

            secret_date = _sign(("TC3" + secret_key).encode("utf-8"), date)
            secret_service = _sign(secret_date, service)
            secret_signing = _sign(secret_service, "tc3_request")
            signature = hmac.new(secret_signing, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()

            authorization = (
                f"TC3-HMAC-SHA256 Credential={secret_id}/{credential_scope}, "
                f"SignedHeaders={signed_headers}, Signature={signature}"
            )

            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.post(
                    endpoint,
                    content=payload,
                    headers={
                        "Authorization": authorization,
                        "Content-Type": "application/json; charset=utf-8",
                        "Host": host,
                        "X-TC-Action": action,
                        "X-TC-Version": version,
                        "X-TC-Timestamp": str(timestamp),
                        "X-TC-Region": region,
                    },
                )
                response.raise_for_status()
                data = response.json()
                resp_data = data.get("Response", {})

                if resp_data.get("Error"):
                    logger.warning(f"Tencent IMS error: {resp_data['Error']}")
                    return {"safe": True, "suggestion": "pass", "label": "normal", "confidence": 100}

                suggestion = resp_data.get("Suggestion", "Pass")
                label = resp_data.get("Label", "Normal")
                score = resp_data.get("Score", 0)

                safe = suggestion in ("Pass",)
                return {
                    "safe": safe,
                    "suggestion": suggestion.lower(),
                    "label": label.lower(),
                    "confidence": score,
                    "details": resp_data.get("SubLabel", ""),
                }
        except Exception as e:
            logger.warning(f"Tencent image moderation failed: {e}")
            return {"safe": True, "suggestion": "pass", "label": "normal", "confidence": 100, "error": str(e)}

    async def _check_tencent_text(self, text: str) -> Dict[str, Any]:
        """Use Tencent Cloud Text Moderation (TMS)."""
        secret_id = settings.TENCENT_SECRET_ID
        secret_key = settings.TENCENT_SECRET_KEY

        if not secret_id or not secret_key:
            return {"safe": True, "suggestion": "pass", "label": "normal", "confidence": 100}

        try:
            service = "tms"
            host = "tms.tencentcloudapi.com"
            endpoint = f"https://{host}"
            action = "TextModeration"
            version = "2020-12-29"
            region = "ap-guangzhou"

            timestamp = int(time.time())
            date = time.strftime("%Y-%m-%d", time.gmtime(timestamp))

            payload = json.dumps({"Content": base64.b64encode(text.encode("utf-8")).decode("utf-8")})

            canonical_headers = f"content-type:application/json; charset=utf-8\nhost:{host}\n"
            signed_headers = "content-type;host"
            hashed_payload = hashlib.sha256(payload.encode("utf-8")).hexdigest()

            canonical_request = f"POST\n/\n\n{canonical_headers}\n{signed_headers}\n{hashed_payload}"
            credential_scope = f"{date}/{service}/tc3_request"
            string_to_sign = f"TC3-HMAC-SHA256\n{timestamp}\n{credential_scope}\n{hashlib.sha256(canonical_request.encode('utf-8')).hexdigest()}"

            def _sign(key, msg):
                return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()

            secret_date = _sign(("TC3" + secret_key).encode("utf-8"), date)
            secret_service = _sign(secret_date, service)
            secret_signing = _sign(secret_service, "tc3_request")
            signature = hmac.new(secret_signing, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()

            authorization = (
                f"TC3-HMAC-SHA256 Credential={secret_id}/{credential_scope}, "
                f"SignedHeaders={signed_headers}, Signature={signature}"
            )

            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(
                    endpoint,
                    content=payload,
                    headers={
                        "Authorization": authorization,
                        "Content-Type": "application/json; charset=utf-8",
                        "Host": host,
                        "X-TC-Action": action,
                        "X-TC-Version": version,
                        "X-TC-Timestamp": str(timestamp),
                        "X-TC-Region": region,
                    },
                )
                response.raise_for_status()
                data = response.json()
                resp_data = data.get("Response", {})

                if resp_data.get("Error"):
                    return {"safe": True, "suggestion": "pass", "label": "normal", "confidence": 100}

                suggestion = resp_data.get("Suggestion", "Pass")
                label = resp_data.get("Label", "Normal")
                score = resp_data.get("Score", 0)

                safe = suggestion in ("Pass",)
                return {
                    "safe": safe,
                    "suggestion": suggestion.lower(),
                    "label": label.lower(),
                    "confidence": score,
                }
        except Exception as e:
            logger.warning(f"Tencent text moderation failed: {e}")
            return {"safe": True, "suggestion": "pass", "label": "normal", "confidence": 100}

    async def _check_alibaba_image(self, image_url: str) -> Dict[str, Any]:
        """Use Alibaba Cloud Green for image moderation."""
        # Placeholder for Alibaba Cloud integration
        return {"safe": True, "suggestion": "pass", "label": "normal", "confidence": 100, "details": "Alibaba integration TBD"}

    async def _check_alibaba_text(self, text: str) -> Dict[str, Any]:
        """Use Alibaba Cloud Green for text moderation."""
        return {"safe": True, "suggestion": "pass", "label": "normal", "confidence": 100, "details": "Alibaba integration TBD"}


# Global client
content_safety_client = ContentSafetyClient()
