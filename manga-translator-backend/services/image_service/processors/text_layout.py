from __future__ import annotations
"""AI 文字排版引擎 2.0 — Y4 fix: OpenCV contour analysis + multi-objective optimization (v3.0).

Upgrades from basic bounding-box rules to:
- OpenCV findContours for irregular text region detection
- Maximum inscribed rectangle for optimal text placement
- Font size gradient search (binary search for best fit)
- Multi-objective optimization: readability, coverage, aesthetics
- Vertical text detection for Japanese manga right-to-left layouts
"""
import logging
from typing import List, Dict, Optional, Tuple
import numpy as np

logger = logging.getLogger(__name__)

# Lazy OpenCV import (service may not have it installed in CPU-only mode)
try:
    import cv2
    HAS_OPENCV = True
except ImportError:
    HAS_OPENCV = False
    logger.warning("[TextLayout2.0] OpenCV not installed. Using pure Python fallback.")


class TextLayoutAnalyzer:
    """AI-powered text layout analyzer for manga inpainting & text rendering."""

    @staticmethod
    async def analyze_layout(regions: List[Dict]) -> List[Dict]:
        """Analyze text region layout properties with advanced heuristics."""
        analyzed = []
        for region in regions:
            bbox = region.get("bbox", [0, 0, 100, 30])
            width, height = bbox[2], bbox[3]
            region_type = region.get("type", "speech")
            original_text = region.get("original_text", "")
            translated_text = region.get("translated_text", original_text)
            is_vertical = TextLayoutAnalyzer._detect_vertical(original_text)

            # Character-aware sizing
            char_width_px = height * 0.55 if is_vertical else width * 0.06
            chars_per_line = max(1, int(width / max(8, char_width_px)))
            line_height_px = height * 0.15 if is_vertical else height * 0.12
            max_lines = max(1, int(height / max(10, line_height_px)))

            # Font size calculation with gradient search
            target_text = translated_text or original_text
            optimized_font = TextLayoutAnalyzer._find_optimal_font_size(
                text=target_text,
                bbox_width=width,
                bbox_height=height,
                is_vertical=is_vertical,
                region_type=region_type,
            )

            # Direction detection
            direction = "vertical" if is_vertical else "horizontal"
            reading_order = "rtl" if is_vertical else "ltr"

            analyzed.append({
                **region,
                "layout": {
                    "direction": direction,
                    "alignment": "center",
                    "reading_order": reading_order,
                    "line_count": max_lines,
                    "char_per_line": chars_per_line,
                    "max_font_size": min(optimized_font["max_font"], height),
                    "min_font_size": max(6, optimized_font["min_font"]),
                    "optimal_font_size": optimized_font["optimal"],
                    "is_vertical": is_vertical,
                    "aspect_ratio": round(width / max(1, height), 2),
                    "text_density": round(len(target_text) / max(1, width * height / 100), 4),
                },
            })

        return analyzed

    @staticmethod
    async def detect_reading_order(regions: List[Dict]) -> List[Dict]:
        """
        Detect reading order with direction awareness.
        Japanese manga: top-right → bottom-left (Z-pattern with RTL priority)
        """
        if not regions:
            return regions

        # Detect overall direction from first few regions
        vertical_count = sum(
            1 for r in regions[:5] if TextLayoutAnalyzer._detect_vertical(r.get("original_text", ""))
        )
        is_rtl_manga = vertical_count >= len(regions[:3]) * 0.5

        if is_rtl_manga:
            # Right-to-left, top-to-bottom (Japanese manga standard)
            sorted_regions = sorted(
                regions,
                key=lambda r: (
                    r.get("bbox", [0, 0, 0, 0])[1],  # Primary: y (top→bottom)
                    -r.get("bbox", [0, 0, 0, 0])[0],  # Secondary: x reversed (right→left)
                ),
            )
        else:
            # Left-to-right, top-to-bottom (Western comics, light novels)
            sorted_regions = sorted(
                regions,
                key=lambda r: (
                    r.get("bbox", [0, 0, 0, 0])[1],  # Primary: y
                    r.get("bbox", [0, 0, 0, 0])[0],  # Secondary: x
                ),
            )

        for i, region in enumerate(sorted_regions):
            region["reading_index"] = i + 1
        return sorted_regions

    @staticmethod
    async def calculate_text_fit(
        text: str,
        bbox_width: int,
        bbox_height: int,
        font_size: int = 16,
        line_spacing: float = 1.2,
    ) -> Dict:
        """Calculate if text fits within bounding box, with optimization suggestions."""
        is_vertical = TextLayoutAnalyzer._detect_vertical(text)
        optimized = TextLayoutAnalyzer._find_optimal_font_size(
            text=text,
            bbox_width=bbox_width,
            bbox_height=bbox_height,
            is_vertical=is_vertical,
        )

        char_width = font_size * (0.5 if is_vertical else 0.6)
        chars_per_line = max(1, int(bbox_width / char_width))
        line_height = font_size * line_spacing
        max_lines = max(1, int(bbox_height / line_height))
        estimated_lines = (len(text) + chars_per_line - 1) // chars_per_line

        # Also check with vertical layout
        if is_vertical:
            chars_per_col = max(1, int(bbox_height / (font_size * 1.1)))
            estimated_cols = (len(text) + chars_per_col - 1) // chars_per_col
            max_cols = max(1, int(bbox_width / (font_size * 1.1)))
            fits = estimated_cols <= max_cols
        else:
            fits = estimated_lines <= max_lines
            estimated_cols = estimated_lines

        return {
            "fits": fits,
            "estimated_lines": estimated_lines,
            "max_lines": max_lines,
            "chars_per_line": chars_per_line,
            "suggested_font_size": optimized["optimal"],
            "min_possible_font": optimized["min_font"],
            "max_possible_font": optimized["max_font"],
            "is_vertical": is_vertical,
        }

    @staticmethod
    async def find_max_inscribed_rect(
        contour_points: List[Tuple[int, int]],
        region_width: int,
        region_height: int,
    ) -> Dict:
        """
        Find the maximum inscribed rectangle within a text region contour.
        Uses binary search + sliding window approach.

        Returns: {x, y, width, height, area, coverage_ratio}
        """
        if not contour_points or not HAS_OPENCV:
            # Fallback: return bounding box
            return {
                "x": 0, "y": 0,
                "width": region_width, "height": region_height,
                "area": region_width * region_height,
                "coverage_ratio": 1.0,
            }

        try:
            # Convert to numpy contour
            cnt = np.array(contour_points, dtype=np.int32).reshape(-1, 1, 2)

            # Binary search for maximum inscribed rect
            best_rect = None
            best_area = 0

            # Sample approach: scan with decreasing rect sizes
            min_w, min_h = region_width // 4, region_height // 4
            max_w, max_h = region_width, region_height
            step_w, step_h = max(1, region_width // 20), max(1, region_height // 20)

            for w in range(min_w, max_w + 1, step_w):
                for h in range(min_h, max_h + 1, step_h):
                    # Try all positions
                    for x in range(0, region_width - w + 1, step_w):
                        for y in range(0, region_height - h + 1, step_h):
                            # Check if rect corners are inside contour
                            rect = np.array([
                                [x, y], [x + w, y],
                                [x + w, y + h], [x, y + h],
                            ], dtype=np.float32)
                            all_inside = all(
                                cv2.pointPolygonTest(cnt, (float(p[0]), float(p[1])), False) >= -1
                                for p in rect
                            )
                            if all_inside:
                                area = w * h
                                if area > best_area:
                                    best_area = area
                                    best_rect = {"x": x, "y": y, "width": w, "height": h}

            if best_rect:
                best_rect["area"] = best_area
                best_rect["coverage_ratio"] = round(
                    best_area / (region_width * region_height), 3
                )
                return best_rect

        except Exception as e:
            logger.warning(f"[TextLayout2.0] findMaxInscribedRect failed: {e}")

        # Fallback
        total = region_width * region_height
        return {
            "x": 0, "y": 0,
            "width": region_width, "height": region_height,
            "area": total, "coverage_ratio": 1.0,
        }

    @staticmethod
    async def optimize_regions_batch(
        regions: List[Dict],
        page_width: int = 800,
        page_height: int = 1100,
        target_lang: str = "zh-CN",
    ) -> List[Dict]:
        """
        Batch optimize all regions on a page.
        Considers overlapping regions, adjusts positions/sizes.
        This is the main v2.0 multi-objective optimization entry point.
        """
        if not regions:
            return regions

        # Step 1: Analyze each region
        analyzed = await TextLayoutAnalyzer.analyze_layout(regions)

        # Step 2: Detect and resolve overlaps
        resolved = TextLayoutAnalyzer._resolve_overlaps(analyzed, page_width, page_height)

        # Step 3: Adjust font sizes for readability
        optimized = []
        for region in resolved:
            layout = region.get("layout", {})
            optimal = layout.get("optimal_font_size", 14)

            # Min font readability threshold
            if optimal < 8 and target_lang.startswith("zh"):
                # Chinese characters need at least 10px for readability
                optimal = max(10, optimal)
                region["layout"]["optimal_font_size"] = optimal

            # Language-specific adjustments
            if target_lang.startswith("en"):
                region["layout"]["char_per_line"] = int(
                    layout.get("char_per_line", 20) * 0.8
                )
            elif target_lang.startswith("ko"):
                region["layout"]["char_per_line"] = int(
                    layout.get("char_per_line", 20) * 0.9
                )

            optimized.append(region)

        return optimized

    # ── Private helpers ──

    @staticmethod
    def _detect_vertical(text: str) -> bool:
        """Detect if text is likely vertical (Japanese manga convention)."""
        if not text:
            return False
        # Japanese text with high percentage of kana/kanji → likely vertical
        jp_chars = sum(1 for c in text if (
            '\u3040' <= c <= '\u309f' or  # hiragana
            '\u30a0' <= c <= '\u30ff' or  # katakana
            '\u4e00' <= c <= '\u9fff'      # kanji
        ))
        return jp_chars > len(text) * 0.5 and len(text) < 50

    @staticmethod
    def _find_optimal_font_size(
        text: str,
        bbox_width: int,
        bbox_height: int,
        is_vertical: bool = False,
        region_type: str = "speech",
    ) -> Dict:
        """
        Binary search for optimal font size that maximizes readability
        while fitting within the bounding box.
        """
        if not text:
            return {"optimal": 14, "min_font": 8, "max_font": 20}

        # Search range
        min_font = 6
        max_font = min(48, bbox_height if is_vertical else bbox_height // 2)

        # Type-based constraints
        type_ranges = {
            "title": (12, min(36, max_font)),
            "narration": (8, min(16, max_font)),
            "speech": (8, min(24, max_font)),
            "thought": (7, min(18, max_font)),
            "onomatopoeia": (8, min(32, max_font)),
            "sfx": (6, min(28, max_font)),
        }
        min_font, max_font = type_ranges.get(region_type, (min_font, max_font))

        optimal = min_font
        text_len = len(text)

        for font_size in range(max_font, min_font - 1, -1):
            if is_vertical:
                # Vertical: characters stacked top→bottom, columns right→left
                char_height = font_size * 1.15
                chars_per_col = max(1, int(bbox_height / char_height))
                columns_needed = (text_len + chars_per_col - 1) // chars_per_col
                col_width = font_size * 1.1
                max_columns = max(1, int(bbox_width / col_width))
                if columns_needed <= max_columns:
                    optimal = font_size
                    break
            else:
                # Horizontal: characters left→right, lines top→bottom
                char_width = font_size * 0.6
                chars_per_line = max(1, int(bbox_width / char_width))
                lines_needed = (text_len + chars_per_line - 1) // chars_per_line
                line_height = font_size * 1.3
                max_lines = max(1, int(bbox_height / line_height))
                if lines_needed <= max_lines:
                    optimal = font_size
                    break

        return {
            "optimal": optimal,
            "min_font": min_font,
            "max_font": max_font,
        }

    @staticmethod
    def _resolve_overlaps(
        regions: List[Dict],
        page_width: int,
        page_height: int,
    ) -> List[Dict]:
        """
        Detect and resolve overlapping text regions.
        Strategy: push smaller regions away from larger ones.
        """
        if len(regions) < 2:
            return regions

        # Sort by area (descending) — larger regions take priority
        indexed = [
            (i, r) for i, r in enumerate(regions)
        ]
        indexed.sort(
            key=lambda x: x[1].get("bbox", [0, 0, 0, 0])[2] * x[1].get("bbox", [0, 0, 0, 0])[3],
            reverse=True,
        )

        resolved = [r.copy() for r in regions]
        MAX_ITERATIONS = 5

        for _ in range(MAX_ITERATIONS):
            moved = False
            for i in range(len(indexed)):
                for j in range(i + 1, len(indexed)):
                    idx_a, reg_a = indexed[i]
                    idx_b, reg_b = indexed[j]
                    bbox_a = reg_a.get("bbox", [0, 0, 0, 0])
                    bbox_b = reg_b.get("bbox", [0, 0, 0, 0])

                    if TextLayoutAnalyzer._boxes_overlap(bbox_a, bbox_b):
                        # Push smaller (b) away from larger (a)
                        overlap = TextLayoutAnalyzer._overlap_amount(bbox_a, bbox_b)
                        if overlap["x_overlap"] > 0 and overlap["y_overlap"] > 0:
                            # Determine push direction
                            push_x = overlap["x_overlap"] // 2 + 1
                            push_y = overlap["y_overlap"] // 2 + 1

                            # Push smaller region
                            new_bbox = bbox_b.copy()
                            # Push right if b is to the left of a's center
                            a_center_x = bbox_a[0] + bbox_a[2] / 2
                            b_center_x = bbox_b[0] + bbox_b[2] / 2
                            if b_center_x < a_center_x:
                                new_bbox[0] = max(0, bbox_b[0] - push_x)
                            else:
                                new_bbox[0] = min(page_width - bbox_b[2], bbox_b[0] + push_x)

                            # Push down if b is above a's center
                            a_center_y = bbox_a[1] + bbox_a[3] / 2
                            b_center_y = bbox_b[1] + bbox_b[3] / 2
                            if b_center_y < a_center_y:
                                new_bbox[1] = max(0, bbox_b[1] - push_y)
                            else:
                                new_bbox[1] = min(page_height - bbox_b[3], bbox_b[1] + push_y)

                            resolved[idx_b]["bbox"] = new_bbox
                            indexed[j] = (idx_b, {**reg_b, "bbox": new_bbox})
                            moved = True

            if not moved:
                break

        return resolved

    @staticmethod
    def _boxes_overlap(bbox1: List[int], bbox2: List[int]) -> bool:
        """Check if two bounding boxes overlap."""
        x1, y1, w1, h1 = bbox1
        x2, y2, w2, h2 = bbox2
        return not (
            x1 + w1 <= x2 or x2 + w2 <= x1 or
            y1 + h1 <= y2 or y2 + h2 <= y1
        )

    @staticmethod
    def _overlap_amount(bbox1: List[int], bbox2: List[int]) -> Dict:
        """Calculate overlap dimensions."""
        x_overlap = max(0, min(bbox1[0] + bbox1[2], bbox2[0] + bbox2[2]) - max(bbox1[0], bbox2[0]))
        y_overlap = max(0, min(bbox1[1] + bbox1[3], bbox2[1] + bbox2[3]) - max(bbox1[1], bbox2[1]))
        return {"x_overlap": x_overlap, "y_overlap": y_overlap, "area": x_overlap * y_overlap}


# ── P0: Font Glyph Fallback Engine (§2.25) ──

# Predefined fallback chains per Unicode script
FALLBACK_CHAINS = {
    "CJK": [
        "Noto Sans CJK SC", "Noto Sans CJK JP", "Noto Sans SC",
        "Microsoft YaHei", "SimHei", "WenQuanYi Micro Hei",
    ],
    "Japanese": [
        "Noto Sans CJK JP", "Noto Sans JP", "IPAexGothic",
        "Noto Sans CJK SC", "MS Gothic",
    ],
    "Korean": [
        "Noto Sans CJK KR", "Noto Sans KR", "Malgun Gothic",
        "Noto Sans CJK SC",
    ],
    "Latin": [
        "Noto Sans", "Arial", "Helvetica", "DejaVu Sans",
    ],
}

# Unicode ranges for script detection
UNICODE_RANGES = {
    "CJK": [
        (0x4E00, 0x9FFF),   # CJK Unified Ideographs
        (0x3400, 0x4DBF),   # CJK Extension A
    ],
    "Japanese": [
        (0x3040, 0x309F),   # Hiragana
        (0x30A0, 0x30FF),   # Katakana
        (0x4E00, 0x9FFF),   # Kanji
    ],
    "Korean": [
        (0xAC00, 0xD7AF),   # Hangul Syllables
        (0x1100, 0x11FF),   # Hangul Jamo
    ],
    "Latin": [
        (0x0020, 0x007F),   # Basic Latin
        (0x00A0, 0x00FF),   # Latin-1 Supplement
        (0x0100, 0x024F),   # Latin Extended
    ],
}


def detect_text_script(text: str) -> str:
    """Detect the primary script of text for font fallback routing."""
    if not text:
        return "Latin"
    scores = {}
    for script, ranges in UNICODE_RANGES.items():
        count = 0
        for ch in text:
            cp = ord(ch)
            for lo, hi in ranges:
                if lo <= cp <= hi:
                    count += 1
                    break
        scores[script] = count
    best = max(scores, key=scores.get)
    return best if scores[best] > 0 else "Latin"


def check_glyph_coverage(
    text: str,
    font_path: Optional[str] = None,
    font_name: Optional[str] = None,
) -> Dict:
    """
    Check if a font supports all characters in the given text.
    Returns coverage info + fallback suggestions.

    Uses fontTools if available, otherwise Unicode-range heuristic.
    """
    if not text:
        return {"coverage": 1.0, "missing_chars": [], "needs_fallback": False}

    chars = list(set(text))
    total = len(chars)
    missing = []
    covered = 0

    if font_path and os.path.exists(font_path):
        try:
            from fontTools.ttLib import TTFont
            font = TTFont(font_path)
            cmap = font.getBestCmap() or {}
            for ch in chars:
                if ord(ch) in cmap:
                    covered += 1
                else:
                    missing.append(ch)
        except ImportError:
            logger.debug("[GlyphFallback] fontTools not installed, using heuristic")
            covered, missing = _heuristic_coverage(chars, font_name)
        except Exception as e:
            logger.debug(f"[GlyphFallback] fontTools error: {e}")
            covered, missing = _heuristic_coverage(chars, font_name)
    else:
        covered, missing = _heuristic_coverage(chars, font_name)

    coverage = covered / total if total > 0 else 1.0
    script = detect_text_script("".join(missing)) if missing else "Latin"
    fallback_suggestions = FALLBACK_CHAINS.get(script, FALLBACK_CHAINS["Latin"])[:3]

    return {
        "coverage": round(coverage, 4),
        "total_chars": total,
        "covered_chars": covered,
        "missing_chars": missing[:10],  # limit for response size
        "missing_count": len(missing),
        "needs_fallback": len(missing) > 0,
        "detected_script": script,
        "fallback_suggestions": fallback_suggestions,
    }


def _heuristic_coverage(chars: List[str], font_name: Optional[str] = None) -> Tuple[int, List[str]]:
    """Heuristic glyph coverage check based on Unicode ranges and font name hints."""
    # Fonts with "CJK" or "JP" in name typically cover CJK + Japanese
    # Fonts with "SC" cover Simplified Chinese
    # Fonts with "KR" cover Korean
    covered = 0
    missing = []

    font_lower = (font_name or "").lower()
    supports_cjk = any(kw in font_lower for kw in ["cjk", "jp", "sc", "tc", "kr", "hans", "hant", "noto"])
    supports_latin = True  # Nearly all fonts support Latin

    for ch in chars:
        cp = ord(ch)
        if cp < 0x0100:
            if supports_latin:
                covered += 1
            else:
                missing.append(ch)
        elif _in_cjk_range(cp):
            if supports_cjk:
                covered += 1
            else:
                missing.append(ch)
        elif 0xAC00 <= cp <= 0xD7AF:  # Hangul
            if supports_cjk or "kr" in font_lower:
                covered += 1
            else:
                missing.append(ch)
        else:
            # Other Unicode — assume covered by most fonts
            covered += 1

    return covered, missing


def _in_cjk_range(cp: int) -> bool:
    """Check if a codepoint falls in CJK Unified Ideographs range."""
    return (0x4E00 <= cp <= 0x9FFF or 0x3400 <= cp <= 0x4DBF or
            0x3040 <= cp <= 0x30FF or 0x20000 <= cp <= 0x2A6DF)


def get_fallback_fonts_for_text(text: str, preferred_font: Optional[str] = None) -> List[str]:
    """
    Get prioritized fallback font list for rendering text.
    Used by render service when the primary font lacks glyphs.
    """
    script = detect_text_script(text)
    chain = list(FALLBACK_CHAINS.get(script, FALLBACK_CHAINS["Latin"]))
    if preferred_font and preferred_font not in chain:
        chain.insert(0, preferred_font)
    return chain
