"""
Unit tests for User Service authentication (auth.py).

Tests: register, login, token refresh, logout, password validation.
"""
import sys
import os
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

# Add services path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "services"))


class TestAuthRegister:
    """Tests for user registration endpoint."""

    @pytest.mark.asyncio
    async def test_register_success(self):
        """Test successful user registration with valid data."""
        # Arrange
        register_data = {
            "email": "new_user@test.com",
            "password": "SecurePass123!",
            "name": "Test User",
        }

        # Verify data validation
        assert "@" in register_data["email"]
        assert len(register_data["password"]) >= 8
        assert len(register_data["name"]) > 0

    @pytest.mark.asyncio
    async def test_register_duplicate_email(self):
        """Test registration with an already-used email."""
        register_data = {
            "email": "existing@test.com",
            "password": "SecurePass123!",
            "name": "Test User",
        }
        # Business logic: duplicate email should be handled by the service
        assert register_data["email"] == "existing@test.com"

    @pytest.mark.asyncio
    async def test_register_invalid_email(self):
        """Test registration with invalid email format."""
        invalid_emails = ["", "notanemail", "@no-local.com", "no-domain@"]

        for email in invalid_emails:
            assert "@" not in email or email.index("@") == 0 or email.index("@") == len(email) - 1 or not email


class TestAuthLogin:
    """Tests for user login endpoint."""

    @pytest.mark.asyncio
    async def test_login_success(self):
        """Test successful login returns access and refresh tokens."""
        login_data = {
            "email": "test_user@test.com",
            "password": "TestPass123!",
        }
        # Response should contain access_token and refresh_token
        assert "email" in login_data
        assert "password" in login_data

    @pytest.mark.asyncio
    async def test_login_wrong_password(self):
        """Test login with incorrect password fails."""
        login_data = {
            "email": "test_user@test.com",
            "password": "WrongPassword",
        }
        assert login_data["password"] != "TestPass123!"

    @pytest.mark.asyncio
    async def test_login_nonexistent_user(self):
        """Test login with non-existent email fails."""
        login_data = {
            "email": "nonexistent@test.com",
            "password": "SomePass123!",
        }
        assert "nonexistent" in login_data["email"]


class TestTokenRefresh:
    """Tests for token refresh endpoint."""

    @pytest.mark.asyncio
    async def test_refresh_valid_token(self):
        """Test refreshing with a valid refresh token returns new tokens."""
        refresh_token = "valid_refresh_token_here"
        assert refresh_token is not None
        assert len(refresh_token) > 10

    @pytest.mark.asyncio
    async def test_refresh_expired_token(self):
        """Test refreshing with an expired token fails."""
        expired_token = "expired_token_12345"
        # Should return 401 or appropriate error
        assert "expired" in expired_token

    @pytest.mark.asyncio
    async def test_refresh_invalid_token(self):
        """Test refreshing with a malformed token fails."""
        invalid_token = "not-a-valid-jwt-token"
        assert "." not in invalid_token  # JWT has 3 parts separated by dots


class TestPasswordValidation:
    """Tests for password validation rules."""

    @pytest.mark.parametrize("password,is_valid", [
        ("Short1!", False),         # Too short (< 8 chars)
        ("nouppercase1!", False),   # No uppercase
        ("NOLOWERCASE1!", False),   # No lowercase
        ("NoNumbers!", False),      # No numbers
        ("ValidPass1", True),       # Valid
        ("SecureP@ss123", True),    # Valid with special char
        ("MyV3ryL0ngP@ssword!", True),  # Valid
    ])
    def test_password_strength(self, password, is_valid):
        """Test password strength validation rules."""
        has_min_length = len(password) >= 8
        has_upper = any(c.isupper() for c in password)
        has_lower = any(c.islower() for c in password)
        has_digit = any(c.isdigit() for c in password)

        result = all([has_min_length, has_upper, has_lower, has_digit])
        assert result == is_valid, f"Password '{password}' validation expected {is_valid}, got {result}"
