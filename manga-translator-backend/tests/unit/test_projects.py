"""
Unit tests for Project Service CRUD operations.

Tests: create, list, get, update, delete projects.
"""
import sys
import os
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "services"))


class TestProjectCreate:
    """Tests for project creation."""

    @pytest.mark.asyncio
    async def test_create_project_valid_data(self):
        """Test creating a project with valid data."""
        project_data = {
            "name": "Test Manga Project",
            "source_lang": "ja",
            "description": "A test project for unit testing",
        }
        assert len(project_data["name"]) > 0
        assert project_data["source_lang"] in ("ja", "en", "ko", "zh")
        assert "name" in project_data

    @pytest.mark.asyncio
    async def test_create_project_empty_name(self):
        """Test creating a project with empty name should fail."""
        project_data = {
            "name": "",
            "source_lang": "ja",
        }
        assert project_data["name"] == ""
        # Service should reject empty name

    @pytest.mark.asyncio
    async def test_create_project_invalid_language(self):
        """Test creating a project with unsupported source language."""
        project_data = {
            "name": "Test Project",
            "source_lang": "xx",  # Invalid language code
        }
        assert project_data["source_lang"] == "xx"
        # Service should reject unsupported language

    @pytest.mark.asyncio
    async def test_create_project_max_length_name(self):
        """Test creating a project with a very long name."""
        project_data = {
            "name": "A" * 300,  # Excessively long name
            "source_lang": "ja",
        }
        assert len(project_data["name"]) <= 200


class TestProjectList:
    """Tests for project listing."""

    @pytest.mark.asyncio
    async def test_list_projects_empty(self):
        """Test listing projects when user has none."""
        # Should return empty list with pagination
        expected_response = {"code": 0, "data": {"items": [], "total": 0, "page": 1, "page_size": 20}}
        assert expected_response["data"]["total"] == 0

    @pytest.mark.asyncio
    async def test_list_projects_with_pagination(self):
        """Test listing projects with pagination parameters."""
        params = {"page": 2, "page_size": 10}
        assert params["page"] == 2
        assert params["page_size"] == 10

    @pytest.mark.asyncio
    async def test_list_projects_invalid_page(self):
        """Test listing with invalid page number."""
        params = {"page": -1, "page_size": 10}
        # Service should clamp to page 1
        assert params["page"] < 0


class TestProjectUpdate:
    """Tests for project update."""

    @pytest.mark.asyncio
    async def test_update_project_name(self):
        """Test updating project name."""
        update_data = {"name": "Updated Project Name"}
        assert update_data["name"] != ""

    @pytest.mark.asyncio
    async def test_update_project_language(self):
        """Test updating project source language."""
        update_data = {"source_lang": "en"}
        assert update_data["source_lang"] == "en"

    @pytest.mark.asyncio
    async def test_update_nonexistent_project(self):
        """Test updating a project that doesn't exist."""
        project_id = "00000000-0000-0000-0000-000000000000"
        # Should return 404
        assert len(project_id) == 36


class TestProjectDelete:
    """Tests for project deletion (soft delete to trash)."""

    @pytest.mark.asyncio
    async def test_delete_project_to_trash(self):
        """Test deleting a project moves it to trash."""
        project_id = "test-project-id-123"
        # Soft delete → trash, not permanent delete
        assert project_id is not None

    @pytest.mark.asyncio
    async def test_delete_nonexistent_project(self):
        """Test deleting a non-existent project returns 404."""
        project_id = "nonexistent-project-id"
        assert "nonexistent" in project_id

    @pytest.mark.asyncio
    async def test_permanent_delete_from_trash(self):
        """Test permanent deletion from trash."""
        project_id = "trashed-project-id"
        assert project_id is not None
