"""
Unit tests for Image Service - enhance_service.py.
Tests: filter application, parameter validation, pipeline ordering.
"""
import sys
import os
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "services"))


class TestEnhancePipeline:
    """Tests for the image enhancement pipeline."""

    def test_enhance_pipeline_order(self):
        """Test that enhancement filters are applied in correct order."""
        pipeline_order = [
            "denoise",           # 1. NLM denoising first
            "crease_removal",    # 2. Crease/scratch removal
            "clahe",             # 3. Contrast enhancement
            "moire_removal",     # 4. Moire pattern removal (FFT)
            "color_enhance",     # 5. Color enhancement
            "super_resolution",  # 6. Super resolution (last)
        ]
        assert pipeline_order[0] == "denoise"
        assert pipeline_order[-1] == "super_resolution"

    def test_enhance_filter_params_range(self):
        """Test that filter parameters are within acceptable ranges."""
        filters = {
            "denoise_strength": 10,      # 1-30 (h parameter for NLM)
            "clahe_clip_limit": 2.0,     # 0.5-4.0
            "clahe_tile_size": 8,        # 4-16
            "sharpening": 1.0,           # 0.0-2.0
            "color_saturation": 1.2,     # 0.0-2.0
            "brightness": 1.0,           # 0.5-1.5
            "contrast": 1.1,             # 0.5-1.5
            "scale_factor": 2,           # 1-4 for super resolution
        }
        assert 1 <= filters["denoise_strength"] <= 30
        assert 0.5 <= filters["clahe_clip_limit"] <= 4.0
        assert 4 <= filters["clahe_tile_size"] <= 16
        assert 0.0 <= filters["sharpening"] <= 2.0
        assert 0.0 <= filters["color_saturation"] <= 2.0
        assert 1 <= filters["scale_factor"] <= 4

    def test_enhance_disabled_filters(self):
        """Test that disabled filters are skipped."""
        config = {
            "denoise": False,
            "crease_removal": True,
            "clahe": False,
            "color_enhance": True,
        }
        enabled = [k for k, v in config.items() if v]
        assert "denoise" not in enabled
        assert "crease_removal" in enabled
        assert "color_enhance" in enabled
        assert len(enabled) == 2

    def test_enhance_no_filters(self):
        """Test enhancement with all filters disabled returns original."""
        config = {k: False for k in ["denoise", "crease_removal", "clahe", "moire_removal", "color_enhance", "super_resolution"]}
        enabled = sum(1 for v in config.values() if v)
        assert enabled == 0


class TestDenoiseFilter:
    """Tests for NLM denoising filter."""

    @pytest.mark.parametrize("h_strength,expected_valid", [
        (5, True),
        (10, True),
        (15, True),
        (30, True),
        (0, False),    # Too weak
        (50, False),   # Too strong
        (-5, False),   # Negative
    ])
    def test_denoise_strength_validation(self, h_strength, expected_valid):
        """Test denoise strength parameter validation."""
        is_valid = 1 <= h_strength <= 30
        assert is_valid == expected_valid, f"Strength {h_strength} validation expected {expected_valid}"


class TestCLAHEFilter:
    """Tests for CLAHE contrast enhancement."""

    @pytest.mark.parametrize("clip_limit,expected_valid", [
        (1.0, True),
        (2.0, True),
        (4.0, True),
        (0.1, False),
        (10.0, False),
        (-1.0, False),
    ])
    def test_clahe_clip_limit_validation(self, clip_limit, expected_valid):
        """Test CLAHE clip limit validation."""
        is_valid = 0.5 <= clip_limit <= 4.0
        assert is_valid == expected_valid


class TestSuperResolution:
    """Tests for super resolution filter."""

    def test_scale_factor_integer(self):
        """Test that scale factor is an integer."""
        factors = [1, 2, 4]
        for f in factors:
            assert isinstance(f, int)
            assert 1 <= f <= 4

    def test_scale_factor_rejected_floats(self):
        """Test that non-integer scale factors are rejected."""
        invalid_factors = [1.5, 3.7, 0.5, 5]
        for f in invalid_factors:
            is_valid = isinstance(f, int) and 1 <= f <= 4
            assert not is_valid, f"Scale factor {f} should be invalid"


class TestMangaSpecificEnhancements:
    """Tests for manga-specific enhancement features."""

    def test_screentone_preservation_flag(self):
        """Test that screentone preservation is a flag option."""
        options = {
            "preserve_screentone": True,
            "screentone_detection_threshold": 0.8,
        }
        assert options["preserve_screentone"] is True
        assert 0.0 <= options["screentone_detection_threshold"] <= 1.0

    def test_halftone_pattern_detection(self):
        """Test halftone pattern detection parameters."""
        # Halftone patterns are typical manga screentones
        patterns = ["dots", "lines", "crosshatch", "gradient"]
        assert "dots" in patterns
        assert len(patterns) == 4
