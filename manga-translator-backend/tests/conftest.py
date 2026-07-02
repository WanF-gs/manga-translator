"""
Pytest configuration and shared fixtures for manga-translator-backend tests.
"""
import os
import sys
import asyncio
from typing import AsyncGenerator, Dict

import pytest
import httpx
from httpx import ASGITransport

# Add services path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "services"))


# ===================== Async Test Configuration =====================

# NOTE: Do NOT define a custom event_loop fixture here.
# pytest-asyncio auto mode (--asyncio-mode=auto) manages the event loop.
# A custom event_loop fixture would override pytest-asyncio's built-in one
# and cause async fixtures (like async_client) to fail in sync test functions.


# ===================== Mock API Client Fixtures =====================

@pytest.fixture
async def async_client() -> AsyncGenerator[httpx.AsyncClient, None]:
    """Create an async HTTP client for testing."""
    base_url = os.getenv("API_BASE", "http://localhost:8080")
    async with httpx.AsyncClient(base_url=base_url, timeout=httpx.Timeout(30.0)) as client:
        yield client


@pytest.fixture
async def auth_client() -> AsyncGenerator[httpx.AsyncClient, None]:
    """Create an authenticated async HTTP client by logging in first.

    This fixture solves the 38/45 test cases that fail with 401 because
    they lacked an auth token. It logs in with known-good test credentials
    and attaches the resulting Bearer token to all subsequent requests.
    """
    base_url = os.getenv("API_BASE", "http://localhost:8080")
    # Use the same credentials that E2E tests verify as working
    test_email = os.getenv("TEST_EMAIL", "3452483881@qq.com")
    test_password = os.getenv("TEST_PASSWORD", "123789")
    async with httpx.AsyncClient(base_url=base_url, timeout=httpx.Timeout(30.0)) as client:
        # Attempt login to obtain access token
        login_body = {
            "account": test_email,
            "password": test_password,
        }
        try:
            resp = await client.post("/api/v1/auth/login", json=login_body)
            data = resp.json()
            token = (
                (data.get("data") or {}).get("tokens", {}).get("access_token")
                or (data.get("data") or {}).get("access_token")
                or data.get("access_token")
            )
            if token:
                client.headers["Authorization"] = f"Bearer {token}"
        except Exception:
            # If login fails, proceed without auth — tests will report 401
            pass
        yield client


# ===================== Test User Credentials =====================

@pytest.fixture
def test_user() -> Dict[str, str]:
    """Default test user credentials."""
    return {
        "email": "test_user@manga-translator.test",
        "password": "TestPass123!",
        "name": "Test User",
    }


@pytest.fixture
def test_admin() -> Dict[str, str]:
    """Test admin credentials."""
    return {
        "email": "admin@manga-translator.test",
        "password": "AdminPass123!",
        "name": "Admin User",
    }


# ===================== Mock Transport for Unit Tests =====================

@pytest.fixture
def mock_ai_gateway_transport():
    """Mock AI Gateway HTTP transport for unit testing without external dependencies."""
    from unittest.mock import AsyncMock, MagicMock

    mock = httpx.MockTransport()

    async def mock_handler(request: httpx.Request) -> httpx.Response:
        url_path = str(request.url)
        if "/detector/detect" in url_path:
            return httpx.Response(200, json={
                "regions": [
                    {"region_id": "r1", "bbox": [10, 10, 100, 50], "type": "speech", "confidence": 0.95, "angle": 0, "is_vertical": False},
                    {"region_id": "r2", "bbox": [10, 80, 200, 40], "type": "narration", "confidence": 0.90, "angle": 0, "is_vertical": False},
                ],
                "total_regions": 2,
                "processing_time_ms": 150.0,
            })
        elif "/ocr/recognize" in url_path:
            return httpx.Response(200, json={
                "results": [
                    {"region_id": "r1", "text": "こんにちは", "confidence": 0.92, "char_confidences": [0.9, 0.95, 0.93, 0.91, 0.92]},
                    {"region_id": "r2", "text": "テスト文字", "confidence": 0.88, "char_confidences": [0.85, 0.90, 0.89, 0.87, 0.88]},
                ],
                "language_detected": "ja",
                "processing_time_ms": 200.0,
            })
        elif "/llm/translate" in url_path:
            return httpx.Response(200, json={
                "text": "你好",
                "engine_used": "google",
                "confidence": 0.85,
                "from_cache": False,
            })
        elif "/inpaint/inpaint" in url_path:
            return httpx.Response(200, json={
                "result_url": "http://mock/inpainted.png",
                "method": "telea",
                "regions_processed": 2,
                "screentone_regions": 0,
                "processing_time_ms": 300.0,
            })
        elif "/render/render" in url_path:
            return httpx.Response(200, json={
                "result_base64": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk",
                "regions_rendered": 2,
                "warnings": [],
                "processing_time_ms": 120.0,
            })
        else:
            return httpx.Response(404, json={"detail": "Not Found"})

    mock.handle_request = mock_handler
    return mock


# ===================== Test Database Helpers =====================

@pytest.fixture
def test_db_url():
    """Return a test database URL (uses SQLite in-memory for unit tests)."""
    return os.getenv(
        "TEST_DATABASE_URL",
        "postgresql+asyncpg://manga_user:manga_pass@localhost:5432/manga_translator_test",
    )


# ===================== Common Test Assertions =====================

def assert_success_response(data: dict, expected_code: int = 0):
    """Assert standard API success response format."""
    assert data.get("code") == expected_code, f"Expected code {expected_code}, got {data.get('code')}"
    assert "message" in data


def assert_error_response(data: dict):
    """Assert standard API error response format."""
    assert data.get("code", 0) != 0, "Expected non-zero error code"


def assert_paginated_response(data: dict):
    """Assert standard paginated response format."""
    assert "items" in data.get("data", {})
    assert "total" in data.get("data", {})
    assert "page" in data.get("data", {})
    assert "page_size" in data.get("data", {})
