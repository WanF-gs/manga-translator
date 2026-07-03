from __future__ import annotations
"""
Enhanced text region detection for AI Gateway.
v2: Added bubble outline detection, NMS dedup, and intelligent region merging.
Supports: region type classification, vertical text detection, arc text detection.
"""
import uuid
import io
import math
import os
import logging
from typing import Optional, List, Dict, Any, Tuple

import httpx
import numpy as np
from PIL import Image

logger = logging.getLogger(__name__)

# ============================================================
# Configuration constants (PRD-aligned v6: MAX_REGION_COUNT as primary throttle)
# ============================================================
# Bubble detection (PRD 2.2.1: 精准区分文字内容与气泡边框边界 — tightened)
BUBBLE_MIN_RADIUS_RATIO = 0.02      # Min bubble radius ratio
BUBBLE_MAX_RADIUS_RATIO = 0.35      # Max bubble radius ratio (was 0.40)
BUBBLE_CIRCULARITY_MIN = 0.55       # Min circularity for bubble shapes (was 0.40 — too permissive, accepted any closed shape)
BUBBLE_AREA_RATIO_MIN = 0.003       # Min bubble area ratio
BUBBLE_AREA_RATIO_MAX = 0.20        # Max bubble area ratio (was 0.35 — bubble should not exceed 20% of image)

# Text region merging (PRD 2.2.4: 选区合并)
# v8: Reduced merge aggressiveness — the v7 font-size-aware merge was still
# combining separate speech bubbles in dense manga layouts. key changes:
# - MERGE_FONT_SIZE_MULTIPLIER: 1.8 → 1.0 (distance ≤ font height, not 1.8×)
# - MERGE_SPLIT_GAP_MULTIPLIER: 2.0 → 1.5 (split clusters more aggressively)
# - merge_dist_floor: 0.02 → 0.015 (absolute minimum from 49→37px on HD manga)
# This prevents separate adjacent bubbles from being fused while still merging
# fragmented text within a single bubble.
MERGE_DISTANCE_RATIO = 0.05         # Floor: absolute-min merge distance as ratio of diagonal
MERGE_FONT_SIZE_MULTIPLIER = 1.0    # v8: Merge if center distance < 1.0 × min(ha, hb) (was 1.8)
MERGE_FONT_RATIO_MAX = 1.8          # Reject merge if box heights differ > 1.8x (title vs small text)
MERGE_ASPECT_RATIO_DIFF_MAX = 2.5   # Reject merge if aspect ratios differ > 2.5x (wide narration vs tall bubble)
MERGE_SPLIT_GAP_MULTIPLIER = 1.5    # v8: Split cluster if vertical gap > 1.5× avg font height (was 2.0)
MERGE_OVERLAP_IOU = 0.15            # IOU threshold for merging overlapping regions
MERGE_EXPAND_RATIO = 0.02           # Expand merged region by this ratio

# NMS dedup (tightened to remove duplicate detections)
NMS_IOU_THRESHOLD = 0.20            # IOU threshold for NMS (lower = more aggressive dedup)

# Region filtering (P0 FIX: MAX_REGION_COUNT is the primary throttle)
MIN_REGION_WIDTH = 12               # 16→12: 允许更窄的文字区域（小字/竖排单列）
MIN_REGION_HEIGHT = 8               # 10→8: 允许更矮的文字区域
MIN_REGION_AREA = 150               # 250→150: 允许更小的文字区域（小字/拟声词）
MAX_REGION_COUNT = 40               # PRD expects ~5-25 per page, allow up to 40 for dense manga

# Text content verification thresholds (v8: further relaxed for manga diversity)
# Manga text comes in many forms: white-on-dark, vertical, tiny, stylized.
# Rejecting any of these is worse than accepting a few false positives
# (which can be manually deleted). Precision is secondary to recall.
TEXT_DARK_PIXEL_RATIO_MIN = 0.005   # v8: 0.01→0.005: 允许更稀疏的暗像素（白色文字在深色气泡上）
TEXT_DARK_PIXEL_RATIO_MAX = 0.85    # Allow dense text areas (dark backgrounds)
TEXT_EDGE_DENSITY_MIN = 0.002       # v8: 0.003→0.002: 降低边缘密度要求（艺术字/手写体边缘弱）
TEXT_ASPECT_RATIO_MIN = 0.08        # v8: 0.1→0.08: 更窄的竖排文字
TEXT_ASPECT_RATIO_MAX = 15.0        # v8: 12→15: 更宽的横幅文字
TEXT_MIN_CHAR_COUNT = 1             # Single characters OK ("！", "？", small kana)
TEXT_H_STD_MIN = 0.2                # v9: 0.5→0.2: 极低投影方差容忍（竖排+小文字区域）
TEXT_CONTRAST_MIN = 0.3             # v9: 1.0→0.3: 极低对比度容忍（浅色气泡内灰色文字/反色文字）
TEXT_SOLID_FILL_MAX = 0.96          # v9: 0.92→0.96: 漫画网点纸/渐变背景误判为实心填充的边界情况
# v8 NEW: Light pixel ratio range for inverted text (white-on-dark bubbles)
TEXT_LIGHT_PIXEL_RATIO_MIN = 0.01   # At least 1% light pixels for inverted text
TEXT_LIGHT_PIXEL_RATIO_MAX = 0.85   # Max light pixels before considered solid

# Region type classification thresholds
OVAL_ROUNDNESS_THRESHOLD = 0.7
LARGE_TEXT_MIN_AREA_RATIO = 0.02
ARC_CURVATURE_THRESHOLD = 0.15

REGION_TYPE_HINTS = {
    "speech": {"min_aspect": 0.3, "max_aspect": 3.0, "typical_area_ratio": (0.01, 0.15)},
    "thought": {"min_aspect": 0.3, "max_aspect": 3.0, "typical_area_ratio": (0.01, 0.15)},
    "narration": {"min_aspect": 2.0, "max_aspect": 10.0, "typical_area_ratio": (0.005, 0.05)},
    "onomatopoeia": {"min_aspect": 0.1, "max_aspect": 5.0, "typical_area_ratio": (0.001, 0.03)},
    "effect": {"min_aspect": 0.1, "max_aspect": 10.0, "typical_area_ratio": (0.001, 0.05)},
}


# ============================================================
# Helper functions
# ============================================================

def _iou(box_a: Tuple[int, int, int, int], box_b: Tuple[int, int, int, int]) -> float:
    """Calculate Intersection over Union between two boxes [x, y, w, h].
    P0 FIX: Cast to Python int to avoid numpy int32 overflow on large images."""
    ax, ay, aw, ah = int(box_a[0]), int(box_a[1]), int(box_a[2]), int(box_a[3])
    bx, by, bw, bh = int(box_b[0]), int(box_b[1]), int(box_b[2]), int(box_b[3])
    x1 = max(ax, bx)
    y1 = max(ay, by)
    x2 = min(ax + aw, bx + bw)
    y2 = min(ay + ah, by + bh)
    if x2 <= x1 or y2 <= y1:
        return 0.0
    inter = (x2 - x1) * (y2 - y1)
    area_a = aw * ah
    area_b = bw * bh
    return inter / (area_a + area_b - inter + 1e-6)


def _distance(box_a: Tuple[int, int, int, int], box_b: Tuple[int, int, int, int]) -> float:
    """Centroid distance between two boxes."""
    cx1, cy1 = box_a[0] + box_a[2] / 2, box_a[1] + box_a[3] / 2
    cx2, cy2 = box_b[0] + box_b[2] / 2, box_b[1] + box_b[3] / 2
    return math.sqrt((cx1 - cx2)**2 + (cy1 - cy2)**2)


def nms(boxes: List[Tuple[int, int, int, int]], scores: List[float],
        iou_threshold: float = NMS_IOU_THRESHOLD) -> List[int]:
    """Non-Maximum Suppression: remove overlapping duplicate detections."""
    if not boxes:
        return []
    indices = list(range(len(boxes)))
    indices.sort(key=lambda i: scores[i], reverse=True)
    keep = []
    while indices:
        current = indices.pop(0)
        keep.append(current)
        indices = [i for i in indices if _iou(boxes[current], boxes[i]) < iou_threshold]
    return keep


def _split_cluster_by_gaps(cluster: List[Tuple[int, int, int, int]],
                           gap_multiplier: float = MERGE_SPLIT_GAP_MULTIPLIER
                           ) -> List[List[Tuple[int, int, int, int]]]:
    """Post-merge discontinuity split: break a cluster at large internal gaps.

    Inspired by comic-text-detector's TextBlock discontinuity logic:
    "if gap > 2×font_size, split the block."

    Sorts boxes by vertical center, then detects gaps between consecutive pairs.
    A gap is considered a split point when:
    - Vertical spacing between prev.bottom and curr.top > 2× avg font height
    - AND horizontal overlap is small (not just side-by-side text)
    """
    if len(cluster) <= 1:
        return [cluster]

    # Sort by y-center for top-to-bottom ordering
    cluster_sorted = sorted(cluster, key=lambda b: b[1] + b[3] / 2)
    avg_font_h = sum(b[3] for b in cluster) / len(cluster)
    gap_threshold = gap_multiplier * avg_font_h

    sub_clusters = []
    current_sub = [cluster_sorted[0]]

    for i in range(1, len(cluster_sorted)):
        prev = cluster_sorted[i - 1]
        curr = cluster_sorted[i]

        prev_bottom = prev[1] + prev[3]
        curr_top = curr[1]
        vertical_gap = curr_top - prev_bottom

        # Horizontal overlap between prev and curr
        h_overlap = max(0, min(prev[0] + prev[2], curr[0] + curr[2]) - max(prev[0], curr[0]))
        min_width = min(prev[2], curr[2])

        if vertical_gap > gap_threshold and h_overlap < min_width * 0.3:
            # Significant gap with little horizontal overlap → split here
            sub_clusters.append(current_sub)
            current_sub = [curr]
        else:
            current_sub.append(curr)

    sub_clusters.append(current_sub)

    # 二次分割：对每个纵向子簇再做横向断裂检测，
    # 拆开被错误合并的左右相邻气泡（原逻辑只查纵向 gap，会漏掉横向并排的两个气泡）。
    avg_font_w = sum(b[2] for b in cluster) / len(cluster)
    h_gap_threshold = gap_multiplier * avg_font_w
    final_subs = []
    for sub in sub_clusters:
        if len(sub) <= 1:
            final_subs.append(sub)
            continue
        by_x = sorted(sub, key=lambda b: b[0] + b[2] / 2)
        run = [by_x[0]]
        for i in range(1, len(by_x)):
            prev, curr = by_x[i - 1], by_x[i]
            horizontal_gap = curr[0] - (prev[0] + prev[2])
            v_overlap = max(0, min(prev[1] + prev[3], curr[1] + curr[3]) - max(prev[1], curr[1]))
            min_h = min(prev[3], curr[3])
            if horizontal_gap > h_gap_threshold and v_overlap < min_h * 0.3:
                final_subs.append(run)
                run = [curr]
            else:
                run.append(curr)
        final_subs.append(run)

    return final_subs


def _merge_nearby_boxes(boxes: List[Tuple[int, int, int, int]],
                        img_w: int, img_h: int) -> List[Tuple[int, int, int, int]]:
    """Merge nearby boxes that likely belong to the same dialogue bubble (PRD 2.2.4).

    v7: Font-size-aware adaptive merging — replaces the old fixed-diagonal-ratio
    merge distance with per-box-pair font-size-relative thresholds. This solves
    the dilemma where a single global threshold causes over-merge in dense layouts
    and under-merge in sparse layouts.

    Key improvements over v6:
    1. Merge distance = max(1.8 × min(height_a, height_b), diagonal × 0.02)
       → small text = short merge radius, large text = long merge radius
    2. Font size similarity gate: reject if heights differ > 1.8× (title ≠ footnote)
    3. Aspect ratio similarity gate: reject if aspect differs > 2.5× (narration ≠ bubble)
    4. Post-merge discontinuity split: cut merged clusters at gaps > 2× avg font height
       (prevents multiple dense bubbles from being fused into one)
    """
    if len(boxes) <= 1:
        return boxes

    diagonal = math.sqrt(img_w**2 + img_h**2)
    merge_dist_floor = diagonal * 0.015   # v8: Absolute minimum merge distance (was 0.02 ~49px → ~37px on HD manga)

    # ---- helper closures ----

    def _centroid_dist(a, b):
        ca_x, ca_y = a[0] + a[2] / 2, a[1] + a[3] / 2
        cb_x, cb_y = b[0] + b[2] / 2, b[1] + b[3] / 2
        return math.sqrt((ca_x - cb_x)**2 + (cb_y - ca_y)**2)

    def _adaptive_merge_dist(a, b):
        """Font-size-relative merge distance: scale with text height."""
        font_based = MERGE_FONT_SIZE_MULTIPLIER * min(a[3], b[3])
        return max(font_based, merge_dist_floor)

    def _font_size_similar(a, b):
        """Reject if one box is dramatically larger/smaller than the other."""
        ha, hb = a[3], b[3]
        if ha <= 0 or hb <= 0:
            return True
        return max(ha, hb) / min(ha, hb) <= MERGE_FONT_RATIO_MAX

    def _aspect_similar(a, b):
        """Reject if aspect ratios are too different (wide vs tall boxes)."""
        ar_a = a[2] / max(a[3], 1)
        ar_b = b[2] / max(b[3], 1)
        if ar_a <= 0 or ar_b <= 0:
            return True
        return max(ar_a, ar_b) / min(ar_a, ar_b) <= MERGE_ASPECT_RATIO_DIFF_MAX

    def _vertically_aligned(a, b):
        """X centers close → vertical stacking likely (same bubble column)."""
        ca_x = a[0] + a[2] / 2
        cb_x = b[0] + b[2] / 2
        return abs(ca_x - cb_x) < max(a[2], b[2]) * 0.30

    def _should_merge(a, b):
        # Gate 1: Font size must be comparable
        if not _font_size_similar(a, b):
            return False
        # Gate 2: Aspect ratios must be comparable  
        if not _aspect_similar(a, b):
            return False
        # Gate 3: Distance check (adaptive, font-size-relative)
        dist = _centroid_dist(a, b)
        max_dist = _adaptive_merge_dist(a, b)
        if dist < max_dist:
            return True
        # Gate 3b: Vertically aligned boxes get 2× merge distance
        if _vertically_aligned(a, b) and dist < max_dist * 2.0:
            return True
        return False

    # ---- agglomerative clustering (same structure as v6, new _should_merge) ----

    clusters = []
    used = set()

    for i, box_a in enumerate(boxes):
        if i in used:
            continue
        cluster = [box_a]
        used.add(i)

        changed = True
        while changed:
            changed = False
            for j, box_b in enumerate(boxes):
                if j in used:
                    continue
                for cbox in cluster:
                    if _should_merge(cbox, box_b):
                        cluster.append(box_b)
                        used.add(j)
                        changed = True
                        break
        clusters.append(cluster)

    # ---- merge each cluster, with discontinuity split for multi-box clusters ----

    merged = []
    for cluster in clusters:
        # v7: Apply discontinuity split before merging
        sub_clusters = _split_cluster_by_gaps(cluster)

        for sub in sub_clusters:
            if len(sub) == 1:
                box = sub[0]
                expand_x = int(box[2] * MERGE_EXPAND_RATIO * 0.5)
                expand_y = int(box[3] * MERGE_EXPAND_RATIO * 0.5)
                new_box = (
                    max(0, box[0] - expand_x),
                    max(0, box[1] - expand_y),
                    min(img_w - max(0, box[0] - expand_x), box[2] + 2 * expand_x),
                    min(img_h - max(0, box[1] - expand_y), box[3] + 2 * expand_y),
                )
                merged.append(new_box)
            else:
                min_x = min(b[0] for b in sub)
                min_y = min(b[1] for b in sub)
                max_x = max(b[0] + b[2] for b in sub)
                max_y = max(b[1] + b[3] for b in sub)
                bw = max_x - min_x
                bh = max_y - min_y
                pad_x = int(bw * MERGE_EXPAND_RATIO)
                pad_y = int(bh * MERGE_EXPAND_RATIO)
                new_box = (
                    max(0, min_x - pad_x),
                    max(0, min_y - pad_y),
                    min(img_w - max(0, min_x - pad_x), bw + 2 * pad_x),
                    min(img_h - max(0, min_y - pad_y), bh + 2 * pad_y),
                )
                merged.append(new_box)

    return merged


def _verify_text_content(gray_roi: np.ndarray, box_coords: str = "") -> Tuple[bool, float]:
    """
    PRD P0 PRECISION FIX v8: Verify if a detected region contains text content.
    
    v8 improvements:
    - Inverted text detection: white/light text on dark bubble background
    - Relaxed thresholds for manga diversity (white-on-dark, vertical, tiny)
    - Debug logging to identify which feature rejected each region
    
    Multi-feature analysis:
    - Feature 0: Solid fill detection (reject fully-inked areas)
    - Feature 1: Dark pixel ratio (black text) OR light pixel ratio (white text)
    - Feature 2: Edge density (text has lots of internal edges)
    - Feature 3: Connected component analysis for character-like shapes
    - Feature 4: Text-background contrast check (std dev of pixel values)
    - Feature 5: Horizontal projection structure (line-like patterns)
    
    Returns: (is_text_region, confidence_adjustment)
    """
    import cv2
    h, w = gray_roi.shape[:2]
    if h < 8 or w < 8:
        return False, 0.0
    
    # Feature 0: REPETITIVE PATTERN REJECTION (DISABLED for manga)
    
    # Feature 1: Dark/light pixel ratio analysis
    dark_pixels = np.sum(gray_roi < 128) / (w * h + 1e-6)
    very_dark_pixels = np.sum(gray_roi < 64) / (w * h + 1e-6)
    light_pixels = np.sum(gray_roi > 200) / (w * h + 1e-6)  # v8: for inverted text
    
    # Reject solid fills (inked areas, backgrounds)
    if very_dark_pixels > TEXT_SOLID_FILL_MAX:
        return False, 0.0
    
    # v8: Handle inverted text (white/light on dark background).
    # Manga often has white text on dark bubbles — dark pixel ratio will be high
    # but the actual text is light. Check if light pixels suggest text.
    is_inverted = (dark_pixels > TEXT_DARK_PIXEL_RATIO_MAX and 
                   TEXT_LIGHT_PIXEL_RATIO_MIN < light_pixels < TEXT_LIGHT_PIXEL_RATIO_MAX)
    
    # Standard text (dark on light): dark pixel ratio in normal range
    is_standard = (TEXT_DARK_PIXEL_RATIO_MIN < dark_pixels < TEXT_DARK_PIXEL_RATIO_MAX)
    
    if not is_standard and not is_inverted:
        return False, 0.0
    
    # Feature 2: Edge density
    edges = cv2.Canny(gray_roi, 50, 150)
    edge_density = np.sum(edges > 0) / (w * h + 1e-6)
    
    if edge_density < TEXT_EDGE_DENSITY_MIN:
        return False, 0.0
    
    # Feature 3: Connected component analysis
    # v8: For inverted text, invert the image before CC analysis
    if is_inverted:
        cc_input = cv2.bitwise_not(gray_roi)
    else:
        cc_input = gray_roi
    
    _, binary = cv2.threshold(cc_input, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(binary, connectivity=8)
    
    if num_labels <= 2:
        return False, 0.0
    
    # Count character-like components
    char_count = 0
    for i in range(1, num_labels):
        cc_area = stats[i, cv2.CC_STAT_AREA]
        cc_w = stats[i, cv2.CC_STAT_WIDTH]
        cc_h = stats[i, cv2.CC_STAT_HEIGHT]
        if 3 < cc_area < 5000 and 0.1 < (cc_w / max(cc_h, 1)) < 10:
            char_count += 1
    
    if char_count < TEXT_MIN_CHAR_COUNT:
        return False, 0.0
    
    # Feature 4: Contrast check
    roi_std = float(np.std(gray_roi.astype(np.float32)))
    if roi_std < TEXT_CONTRAST_MIN:
        return False, 0.0
    
    # Feature 5: Horizontal projection structure
    # v8: For potentially vertical text, use vertical projection too
    h_proj = np.mean(binary, axis=1)
    v_proj = np.mean(binary, axis=0)
    h_std = np.std(h_proj)
    v_std = np.std(v_proj)
    # Use the stronger signal (either horizontal or vertical structure)
    proj_std = max(h_std, v_std)
    
    if proj_std < TEXT_H_STD_MIN:
        return False, 0.0
    
    # Calculate confidence adjustment
    char_score = min(1.0, char_count / 20.0)
    edge_score = min(1.0, edge_density / 0.15)
    dark_score = 1.0 if (0.08 < dark_pixels < 0.45) else (0.6 if not is_inverted else 0.7)
    contrast_score = min(1.0, roi_std / 80.0)
    proj_score = min(1.0, proj_std / 20.0)
    
    confidence_adj = (
        0.25 * char_score + 0.25 * edge_score + 
        0.20 * dark_score + 0.15 * contrast_score + 
        0.15 * proj_score
    )
    
    return True, confidence_adj


def _is_edge_region(box: Tuple[int, int, int, int], img_w: int, img_h: int, 
                    gray_full: np.ndarray) -> bool:
    """
    PRD 2.2.3: Detect page numbers, headers, signatures at edges.
    These should be filtered out by default.
    
    Returns True if the region should be filtered (is an edge artifact).
    """
    x, y, bw, bh = box
    edge_margin = min(img_w, img_h) * 0.06  # widened from 4% to 6% for better page-number/signature filtering
    
    # Check if at image edge
    at_left = x < edge_margin
    at_right = (x + bw) > img_w - edge_margin
    at_top = y < edge_margin
    at_bottom = (y + bh) > img_h - edge_margin
    
    # Small regions at corners/edges are likely page numbers or signatures
    is_small = (bw * bh) < (img_w * img_h * 0.003)
    
    if (at_left or at_right or at_top or at_bottom) and is_small:
        # Further verification: check if region contains numeric or signature patterns
        roi = gray_full[y:y+bh, x:x+bw]
        if roi.size > 0:
            # Edge regions with very few character components are likely noise
            try:
                import cv2
                _, binary = cv2.threshold(roi, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
                num_labels = cv2.connectedComponentsWithStats(binary, connectivity=8)[0]
                if num_labels <= 3:
                    return True  # Too few components = page number/signature noise
            except:
                pass
        return is_small
    
    return False


def _detect_bubble_outlines(gray: np.ndarray, img_rgb: np.ndarray) -> List[Tuple[int, int, int, int]]:
    """
    Detect dialogue bubble outlines in manga pages (PRD 2.2.1, 2.4.3).
    
    v3 IMPROVEMENT: Added dark-scene bubble detection.
    Previously only looked for white bubbles (threshold 200), which missed
    all bubbles in dark-themed manga, night scenes, inverted color schemes.
    
    Now uses THREE strategies:
      A. Light bubbles on dark/mid backgrounds (original behavior, tuned)
      B. Dark bubbles / text regions on dark backgrounds (NEW)
      C. Color-based bubble detection using HSV saturation (NEW)
    """
    import cv2
    h, w = gray.shape[:2]
    img_min_dim = min(w, h)
    bubbles = []
    mean_brightness = float(np.mean(gray))

    def _extract_bubbles_from_contours(contours, label="", min_circularity=None):
        """Extract valid bubble bounding boxes from contour list."""
        local_bubbles = []
        _min_circ = min_circularity if min_circularity is not None else BUBBLE_CIRCULARITY_MIN
        for cnt in contours:
            area = cv2.contourArea(cnt)
            if area < w * h * BUBBLE_AREA_RATIO_MIN or area > w * h * BUBBLE_AREA_RATIO_MAX:
                continue
            perimeter = cv2.arcLength(cnt, True)
            if perimeter < 10:
                continue
            circularity = 4 * math.pi * area / (perimeter * perimeter + 1e-6)
            if circularity < _min_circ:
                continue
            bx, by, bw, bh = cv2.boundingRect(cnt)
            aspect = bw / bh if bh > 0 else 99
            if aspect > 3.0 or aspect < 0.33:
                continue
            hull = cv2.convexHull(cnt)
            hull_area = cv2.contourArea(hull)
            solidity = (area / hull_area) if hull_area > 0 else 1.0
            if solidity < 0.35:
                continue
            margin = max(3, int(min(bw, bh) * 0.03))
            local_bubbles.append((
                max(0, bx - margin),
                max(0, by - margin),
                min(w - max(0, bx - margin), bw + 2 * margin),
                min(h - max(0, by - margin), bh + 2 * margin),
            ))
        return local_bubbles

    # ================================================================
    # Strategy A: Light bubbles (white/light rounded shapes, original)
    # Works for: Standard manga with white speech bubbles
    # ================================================================
    _, binary_light = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY)
    light_contours, _ = cv2.findContours(binary_light, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    light_bubbles = _extract_bubbles_from_contours(light_contours, "light")
    bubbles.extend(light_bubbles)
    logger.debug(f"  Bubble-A (light): {len(light_bubbles)} candidates (mean_brightness={mean_brightness:.0f})")

    # ================================================================
    # Strategy B: Dark scene detection (NEW v3)
    # For dark-themed manga: invert and look for bubbles as dark blobs
    # surrounded by even darker or different-textured areas
    # ================================================================
    dark_bubbles = []
    if mean_brightness < 100:
        # B1: Detect light-text-on-dark using inverse thresholding
        # In dark scenes, speech bubbles often have a slightly lighter
        # interior than the surrounding pitch-black background
        # Use adaptive thresholding — more robust than fixed threshold
        try:
            binary_adaptive = cv2.adaptiveThreshold(
                gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                cv2.THRESH_BINARY, blockSize=31, C=8
            )
            # Close small gaps
            kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
            binary_adaptive = cv2.morphologyEx(binary_adaptive, cv2.MORPH_CLOSE, kernel)
            dark_contours, _ = cv2.findContours(binary_adaptive, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
            dark_bubbles = _extract_bubbles_from_contours(dark_contours, "dark-adaptive", min_circularity=0.45)
        except Exception as e:
            logger.warning(f"  Bubble-B adaptive failed: {e}")

        # B2: Edge-based closed contour detection for dark scenes
        # Canny edges → close gaps → find enclosed regions
        try:
            edges = cv2.Canny(gray, 30, 100)
            kernel_close = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
            edges_closed = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel_close)
            edge_contours, _ = cv2.findContours(edges_closed, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
            edge_bubbles = _extract_bubbles_from_contours(edge_contours, "dark-edges", min_circularity=0.40)
            # Only add if we haven't already found many via adaptive
            if len(dark_bubbles) < 3:
                dark_bubbles.extend(edge_bubbles)
        except Exception as e:
            logger.warning(f"  Bubble-B edges failed: {e}")

        bubbles.extend(dark_bubbles)
        logger.debug(f"  Bubble-B (dark): {len(dark_bubbles)} candidates")

    # ================================================================
    # Strategy C: HSV saturation-based bubble detection (NEW v3)
    # Bubbles often have distinct color/saturation vs. background art
    # Works for: Colored manga, webtoons, gradient backgrounds
    # ================================================================
    try:
        hsv = cv2.cvtColor(img_rgb, cv2.COLOR_BGR2HSV)
        h_channel, s_channel, v_channel = cv2.split(hsv)

        # C1: High-saturation regions often delineate text/bubble boundaries
        _, sat_binary = cv2.threshold(s_channel, 40, 255, cv2.THRESH_BINARY)
        sat_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
        sat_closed = cv2.morphologyEx(sat_binary, cv2.MORPH_CLOSE, sat_kernel)
        sat_contours, _ = cv2.findContours(sat_closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        sat_bubbles = _extract_bubbles_from_contours(sat_contours, "saturation", min_circularity=0.40)
        bubbles.extend(sat_bubbles)

        # C2: Extreme value (V) regions — very dark or very light patches
        _, v_dark = cv2.threshold(v_channel, 30, 255, cv2.THRESH_BINARY_INV)
        _, v_light = cv2.threshold(v_channel, 230, 255, cv2.THRESH_BINARY)
        v_combined = cv2.bitwise_or(v_dark, v_light)
        v_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
        v_closed = cv2.morphologyEx(v_combined, cv2.MORPH_CLOSE, v_kernel)
        v_contours, _ = cv2.findContours(v_closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        v_bubbles = _extract_bubbles_from_contours(v_contours, "value-extreme", min_circularity=0.40)
        bubbles.extend(v_bubbles)

        logger.debug(f"  Bubble-C (HSV): sat={len(sat_bubbles)}, val={len(v_bubbles)}")
    except Exception as e:
        logger.warning(f"  Bubble-C HSV failed: {e}")

    # ================================================================
    # Method 2: HoughCircles for round bubbles (fallback, kept from original)
    # ================================================================
    if len(bubbles) < 3:
        blurred = cv2.GaussianBlur(gray, (9, 9), 2)
        circles = cv2.HoughCircles(
            blurred, cv2.HOUGH_GRADIENT, dp=1.2,
            minDist=int(img_min_dim * 0.06),
            param1=80, param2=35,
            minRadius=int(img_min_dim * BUBBLE_MIN_RADIUS_RATIO),
            maxRadius=int(img_min_dim * BUBBLE_MAX_RADIUS_RATIO),
        )
        if circles is not None:
            circles = np.uint16(np.around(circles))
            for circle in circles[0, :]:
                cx, cy, r = circle
                crop = gray[max(0, cy - r):min(h, cy + r), max(0, cx - r):min(w, cx + r)]
                if crop.size > 0:
                    dark_ratio = np.sum(crop < 100) / crop.size
                    if dark_ratio > 0.03:
                        margin = max(3, int(r * 0.05))
                        x0 = int(max(0, cx - r - margin))
                        y0 = int(max(0, cy - r - margin))
                        bw_h = int(min(w - x0, 2 * r + 2 * margin))
                        bh_h = int(min(h - y0, 2 * r + 2 * margin))
                        bubbles.append((x0, y0, bw_h, bh_h))

    # Deduplicate all bubble detections
    if bubbles:
        scores = [1.0] * len(bubbles)
        keep_indices = nms(bubbles, scores, iou_threshold=0.15)
        bubbles = [bubbles[i] for i in keep_indices]

    logger.info(f"Phase 1: bubble detection => {len(bubbles)} total (mean_brightness={mean_brightness:.0f})")
    return bubbles


def _classify_region_type(bbox: Dict[str, int], image_size: tuple,
                          contour_points: Optional[List] = None) -> str:
    """
    Classify region type based on shape analysis.
    
    Args:
        bbox: {x, y, width, height}
        image_size: (width, height) of the full image
        contour_points: Optional list of (x,y) contour points for shape analysis
    
    Returns:
        Region type: speech, thought, narration, onomatopoeia, effect
    """
    w = bbox.get("width", 100)
    h = bbox.get("height", 100)
    img_w, img_h = image_size
    
    if w <= 0 or h <= 0:
        return "speech"
    
    aspect_ratio = w / h if h > 0 else 1.0
    area_ratio = (w * h) / (img_w * img_h)
    
    # Narration boxes tend to be wide rectangles
    if aspect_ratio > 2.5 and area_ratio < 0.03:
        return "narration"
    
    # Very wide or tall thin regions = likely effect text
    if (aspect_ratio > 4.0 or aspect_ratio < 0.25) and area_ratio < 0.01:
        return "effect"
    
    # Large, bold text = onomatopoeia
    if area_ratio > 0.08 and (aspect_ratio > 2.0 or aspect_ratio < 0.5):
        return "onomatopoeia"
    
    # If we have contour points, do shape analysis
    if contour_points and len(contour_points) >= 5:
        shape_type = _analyze_contour_shape(contour_points, w, h)
        if shape_type == "thought":
            return "thought"
        elif shape_type == "narration":
            return "narration"
        elif shape_type == "effect":
            return "effect"
    
    # Default: speech bubble (most common)
    if aspect_ratio < 2.0:
        return "speech"
    elif aspect_ratio < 3.5:
        return "speech"
    else:
        return "narration"


def _analyze_contour_shape(points: List, bbox_w: int, bbox_h: int) -> str:
    """
    Analyze contour points to determine bubble shape.
    
    Returns: "speech", "thought", "narration", "effect"
    """
    try:
        import cv2
        
        pts = np.array(points, dtype=np.float32)
        if len(pts) < 5:
            return "speech"
        
        # Fit ellipse to contour
        if len(pts) >= 5:
            try:
                ellipse = cv2.fitEllipse(pts)
                (cx, cy), (ma, MA), angle = ellipse
                
                # Thought bubbles have cloud-like scalloped edges
                hull = cv2.convexHull(pts.astype(np.int32), returnPoints=False)
                if hull is not None and len(hull) > 3:
                    defects = cv2.convexityDefects(pts.astype(np.int32), hull)
                    if defects is not None and len(defects) > 5:
                        return "thought"
                
                # Rectangular fit check
                rect = cv2.minAreaRect(pts)
                box = cv2.boxPoints(rect)
                box_area = cv2.contourArea(box)
                contour_area = cv2.contourArea(pts)
                
                if contour_area > 0 and box_area > 0:
                    area_ratio = contour_area / box_area
                    if area_ratio > 0.85:
                        return "narration"  # Nearly rectangular
                    elif area_ratio < 0.55:
                        return "effect"  # Very irregular = effect text
                    
            except Exception:
                pass
        
        # Check for tail (speech bubble pointer)
        hull = cv2.convexHull(pts.astype(np.int32))
        hull_area = cv2.contourArea(hull)
        contour_area = cv2.contourArea(pts.astype(np.int32))
        
        if contour_area > 0 and hull_area > 0:
            solidity = contour_area / hull_area
            if solidity < 0.7:
                return "speech"
        
        return "speech"
    except ImportError:
        return "speech"


def _detect_vertical_text(region_image: np.ndarray) -> bool:
    """Detect if text within a region is vertical (tate-gaki)."""
    try:
        import cv2
        
        h, w = region_image.shape[:2]
        if h < 20 or w < 20:
            return False
        
        gray = cv2.cvtColor(region_image, cv2.COLOR_BGR2GRAY) if len(region_image.shape) == 3 else region_image
        _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
        
        num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(binary, connectivity=8)
        
        if num_labels <= 1:
            return False
        
        centroids_list = []
        for i in range(1, num_labels):
            if stats[i, cv2.CC_STAT_AREA] > 10:
                centroids_list.append(centroids[i])
        
        if len(centroids_list) < 2:
            return False
        
        centroids_arr = np.array(centroids_list)
        x_std = np.std(centroids_arr[:, 0])
        y_std = np.std(centroids_arr[:, 1])
        
        if y_std > 0 and x_std / y_std < 0.5 and len(centroids_list) >= 3:
            return True
        
        return False
    except ImportError:
        return False


def _shrink_to_text_content(box: Tuple[int, int, int, int], gray_full: np.ndarray) -> Tuple[int, int, int, int]:
    """
    PRD P0 PRECISION FIX: Shrink bounding box to tightly fit actual text content.
    Reduces background/padding inclusion by finding text density boundaries.
    
    基于文字内容的边界收缩算法：
    1. 对ROI做OTSU二值化分离文字与背景
    2. 计算水平/垂直投影密度
    3. 从四边向内收缩到文字密度阈值边界
    4. 保留PRD要求的≥2px最小边距
    
    Returns: (new_x, new_y, new_w, new_h)
    """
    import cv2
    x, y, bw, bh = box
    h_full, w_full = gray_full.shape[:2]
    
    # 边界安全校验
    x = max(0, x)
    y = max(0, y)
    bw = min(bw, w_full - x)
    bh = min(bh, h_full - y)
    if bw < 10 or bh < 10:
        return (x, y, bw, bh)
    
    roi = gray_full[y:y+bh, x:x+bw]
    if roi.size == 0:
        return (x, y, bw, bh)
    
    # OTSU 二值化 — 文字为白色前景
    _, binary = cv2.threshold(roi, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    
    # 水平投影：每行有多少个文字像素
    h_proj = np.sum(binary, axis=1)  # shape: (bh,)
    # 垂直投影：每列有多少个文字像素
    v_proj = np.sum(binary, axis=0)  # shape: (bw,)
    
    # 文字密度阈值：投影值的10%作为有效文字行/列
    h_threshold = max(3, np.max(h_proj) * 0.10) if np.max(h_proj) > 0 else 3
    v_threshold = max(3, np.max(v_proj) * 0.10) if np.max(v_proj) > 0 else 3
    
    # 从顶部向下收缩
    top_idx = 0
    for i in range(bh):
        if h_proj[i] >= h_threshold:
            top_idx = i
            break
    
    # 从底部向上收缩
    bottom_idx = bh - 1
    for i in range(bh - 1, -1, -1):
        if h_proj[i] >= h_threshold:
            bottom_idx = i
            break
    
    # 从左向右收缩
    left_idx = 0
    for i in range(bw):
        if v_proj[i] >= v_threshold:
            left_idx = i
            break
    
    # 从右向左收缩
    right_idx = bw - 1
    for i in range(bw - 1, -1, -1):
        if v_proj[i] >= v_threshold:
            right_idx = i
            break
    
    # PRD 要求：≥2px最小边距，额外保留1-2px安全间距
    margin = 2
    new_x = max(0, x + left_idx - margin)
    new_y = max(0, y + top_idx - margin)
    new_w = min(w_full - new_x, (right_idx - left_idx) + 2 * margin)
    new_h = min(h_full - new_y, (bottom_idx - top_idx) + 2 * margin)
    
    # 收缩比例安全检查：收缩不应超过65%（放宽以便艺术字/稀疏文字能被有效收缩）
    shrink_ratio_w = new_w / max(bw, 1)
    shrink_ratio_h = new_h / max(bh, 1)
    if shrink_ratio_w < 0.35 or shrink_ratio_h < 0.35:
        # 收缩过度（超过65%），保留原框
        return (x, y, bw, bh)
    
    if new_w < MIN_REGION_WIDTH or new_h < MIN_REGION_HEIGHT:
        return (x, y, bw, bh)
    
    logger.debug(f"Shrink: ({x},{y}) {bw}x{bh} -> ({new_x},{new_y}) {new_w}x{new_h}")
    return (new_x, new_y, new_w, new_h)


def _improved_classify_region_type(bbox: Dict[str, int], image_size: tuple,
                                   roi_gray: Optional[np.ndarray] = None) -> str:
    """
    PRD P0 PRECISION FIX v3: Improved region type classification with multi-signal analysis.
    Addresses false classification of effect text / SFX as dialogue bubbles.
    
    Classification signals (weighted):
    1. Aspect ratio — wide/narrow regions bias toward narration/effect
    2. Area ratio — very large standalone regions are likely SFX/onomatopoeia
    3. Text density — high-density dark pixels suggest onomatopoeia/effect (bold strokes)
    4. Edge complexity — highly irregular edges suggest effect text (stylized)
    5. Position context — edge regions might be narration boxes
    """
    w = bbox.get("width", 100)
    h = bbox.get("height", 100)
    img_w, img_h = image_size
    
    if w <= 0 or h <= 0:
        return "speech"
    
    aspect_ratio = w / max(h, 1)
    area_ratio = (w * h) / (img_w * img_h + 1e-6)
    
    # Signal 1: Narration — wide narrow boxes, typically at page top/bottom
    if aspect_ratio > 3.0 and area_ratio < 0.04:
        return "narration"
    
    # Signal 2: Effect text — extreme aspect ratios, very irregular shapes
    if (aspect_ratio > 5.0 or aspect_ratio < 0.2) and area_ratio < 0.02:
        return "effect"
    
    # Signal 3: Onomatopoeia (SFX) — large bold text, high edge density, free-floating
    # Lower thresholds to catch more SFX per PRD 5-type requirement
    if area_ratio > 0.06 and aspect_ratio > 2.0:
        return "onomatopoeia"
    
    # Signal 4: Text density analysis for SFX/effect detection
    if roi_gray is not None and roi_gray.size > 0:
        try:
            import cv2
            dark_ratio = np.sum(roi_gray < 100) / max(roi_gray.size, 1)
            _, binary = cv2.threshold(roi_gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
            text_ratio = np.sum(binary > 0) / max(binary.size, 1)
            
            # Onomatopoeia: dense text + moderate-to-large area
            if text_ratio > 0.35 and area_ratio > 0.03:
                return "onomatopoeia"
            # Effect: very dense text + extreme stylization
            if text_ratio > 0.50:
                return "effect"
        except Exception:
            pass
    
    # Signal 5: Thought bubble detection — narrow and tall with specific aspect
    if 0.3 < aspect_ratio < 0.8 and h > w * 1.2:
        return "thought"
    
    # Default: speech bubble (most common in manga)
    if aspect_ratio < 3.0:
        return "speech"
    elif aspect_ratio < 4.0:
        return "narration"
    else:
        return "effect"


def _detect_arc_text(region_image: np.ndarray) -> float:
    """
    Detect if text follows an arc/curve.
    Returns arc curvature score (0 = straight, >0.15 = curved).
    """
    try:
        import cv2
        
        h, w = region_image.shape[:2]
        if h < 20 or w < 20:
            return 0.0
        
        gray = cv2.cvtColor(region_image, cv2.COLOR_BGR2GRAY) if len(region_image.shape) == 3 else region_image
        _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
        
        num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(binary, connectivity=8)
        
        if num_labels <= 3:
            return 0.0
        
        chars = []
        for i in range(1, num_labels):
            area = stats[i, cv2.CC_STAT_AREA]
            if 20 < area < (w * h * 0.3):
                chars.append({
                    "x": centroids[i][0],
                    "y": centroids[i][1],
                    "w": stats[i, cv2.CC_STAT_WIDTH],
                    "h": stats[i, cv2.CC_STAT_HEIGHT],
                })
        
        if len(chars) < 3:
            return 0.0
        
        chars.sort(key=lambda c: c["x"])
        
        xs = np.array([c["x"] for c in chars])
        ys = np.array([c["y"] for c in chars])
        
        if len(xs) >= 3:
            coeffs = np.polyfit(xs, ys, 2)
            curvature = abs(2 * coeffs[0])
            normalized_curvature = curvature / (w + 1)
            return min(normalized_curvature, 1.0)
        
        return 0.0
    except ImportError:
        return 0.0


# ============================================================
# Main detection function
# ============================================================

async def detect_text_regions(
    image_url: str,
    language: str = "ja",
    detect_all: bool = False,
) -> Dict[str, Any]:
    """
    Detect text regions in manga page image (PRD 2.2.1, 2.4.3).
    
    v2 improvements:
    - Bubble outline detection for accurate dialogue region boundaries
    - Intelligent merging of nearby text regions into bubble-level regions
    - NMS deduplication to reduce false positives
    - Better filtering aligned with PRD requirements
    
    Returns:
        {
            "regions": [
                {
                    "region_id": str,
                    "bbox": [x, y, w, h],
                    "type": "speech|thought|narration|onomatopoeia|effect",
                    "confidence": float,
                    "angle": float,
                    "is_vertical": bool,
                    "arc_curvature": float
                }
            ],
            "total_regions": int,
            "processing_time_ms": float
        }
    """
    import time
    import cv2
    
    start_time = time.time()
    regions = []
    
    try:
        # Download image (supports data: URIs for base64-encoded images)
        if image_url.startswith("data:"):
            # Parse data URI: data:image/png;base64,<base64_data>
            import base64 as _b64
            header, encoded = image_url.split(",", 1)
            image_data = _b64.b64decode(encoded)
        else:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.get(image_url)
                resp.raise_for_status()
                image_data = resp.content
        
        img_array = np.frombuffer(image_data, dtype=np.uint8)
        img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
        if img is None:
            return {"regions": [], "total_regions": 0,
                    "processing_time_ms": 0, "error": "Failed to decode image"}
        
        h, w = img.shape[:2]
        logger.info(f"Image loaded: {w}x{h}, dtype={img.dtype}")

        # §6: Super-resolution preprocessing — upscale low-res images before detection
        # manga-image-translator style: upscale for better OCR accuracy
        scale_factor = 1.0
        if min(w, h) < 800:
            try:
                scale_factor = min(2.0, 800.0 / min(w, h))
                import importlib
                if importlib.util.find_spec("realesrgan"):
                    from basicsr.archs.rrdbnet_arch import RRDBNet
                    from realesrgan import RealESRGANer
                    model = RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64, num_block=6, num_grow_ch=32, scale=4)
                    model_path = os.getenv("REALESRGAN_ANIME_MODEL", "")
                    upsampler = RealESRGANer(scale=4, model_path=model_path if os.path.exists(model_path) else None, model=model, tile=400, tile_pad=10, pre_pad=0, half=False)
                    output, _ = upsampler.enhance(img, outscale=scale_factor)
                    new_h, new_w = output.shape[:2]
                    img = cv2.resize(output, (int(w * scale_factor), int(h * scale_factor)), interpolation=cv2.INTER_LANCZOS4)
                    logger.info(f"Super-resolution preprocessing: {w}x{h} → {img.shape[1]}x{img.shape[0]} (scale={scale_factor:.1f}x)")
                else:
                    img = cv2.resize(img, (int(w * scale_factor), int(h * scale_factor)), interpolation=cv2.INTER_LANCZOS4)
                    logger.info(f"Lanczos upscale preprocessing: {w}x{h} → {img.shape[1]}x{img.shape[0]}")
            except Exception as e:
                logger.warning(f"Super-resolution preprocessing failed, continuing with original: {e}")

        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        img_diag = math.sqrt(w**2 + h**2)
        
        # =============================================
        # Phase 0: CTD (Comic Text Detector) — Manga-Trained Model ONLY
        #
        # NO downgrade to RapidOCR or OpenCV.
        # CTD is a YOLO+DBNet hybrid trained on manga/comic data.
        # If the model is unavailable, detection fails explicitly.
        # =============================================
        raw_boxes = []

        try:
            from .ctd_detector import detect_with_ctd, ctd_is_available

            if not ctd_is_available():
                logger.error("CTD model not found at models/comictextdetector.pt.onnx")
                return {"regions": [], "total_regions": 0,
                        "processing_time_ms": 0, "error": "CTD model not found"}

            raw_boxes = detect_with_ctd(img)
            logger.info(f"Phase 0: CTD => {len(raw_boxes)} text regions")
        except Exception as e:
            logger.error(f"CTD detection failed: {e}")
            return {"regions": [], "total_regions": 0,
                    "processing_time_ms": 0, "error": str(e)}
        
        # =============================================
        # Phase 1: Bubble detection — activate as supplement when CTD finds relatively few regions
        # Helps catch text inside large speech bubbles that CTD may have missed.
        # =============================================
        bubble_boxes = []
        if len(raw_boxes) < 12:  # was < 5: 放宽阈值，更多场景下用气泡检测补充遗漏
            bubble_boxes = _detect_bubble_outlines(gray, img)
            logger.info(f"Phase 1: detected {len(bubble_boxes)} bubble outlines (CTD had {len(raw_boxes)} regions)")
        else:
            logger.info(f"Phase 1: skipped (CTD found {len(raw_boxes)} regions — sufficient)")

        # =============================================
        # Phase 3: Merge nearby text regions into bubble-level regions
        # Phase 3: Merge nearby text regions into bubble-level regions
        # =============================================
        merged_boxes = _merge_nearby_boxes(raw_boxes, w, h)
        logger.info(f"Phase 3: merged into {len(merged_boxes)} regions")
        
        # Combine bubble outlines with merged text regions
        all_boxes = bubble_boxes + merged_boxes
        
        # =============================================
        # Phase 3.5: PRD 2.2.8 — Bubble-to-text containment clipping
        # For each text region, clip it to the boundary of any overlapping bubble.
        # This ensures text boxes don't extend beyond bubble inner contours (≤95% coverage rule).
        # =============================================
        if bubble_boxes and len(merged_boxes) > 0:
            clipped_merged = []
            clip_count = 0
            for tbox in merged_boxes:
                tx, ty, tw, th = tbox
                t_center_x = tx + tw / 2
                t_center_y = ty + th / 2
                best_clip = None
                
                for boutline in bubble_boxes:
                    box, boy, bow, boh = boutline
                    # Check if text box center is inside this bubble
                    if (box <= t_center_x <= box + bow and 
                        boy <= t_center_y <= boy + boh):
                        # Clip text box to bubble boundaries
                        clip_x = max(tx, box)
                        clip_y = max(ty, boy)
                        clip_w = min(tx + tw, box + bow) - clip_x
                        clip_h = min(ty + th, boy + boh) - clip_y
                        
                        if clip_w > MIN_REGION_WIDTH and clip_h > MIN_REGION_HEIGHT:
                            best_clip = (clip_x, clip_y, clip_w, clip_h)
                            break
                
                if best_clip:
                    clipped_merged.append(best_clip)
                    clip_count += 1
                else:
                    clipped_merged.append(tbox)
            
            # Replace merged boxes with clipped versions
            merged_boxes = clipped_merged
            logger.info(f"Phase 3.5: bubble-clipped {clip_count}/{len(clipped_merged)} text regions to bubble boundaries")
        
        all_boxes = bubble_boxes + merged_boxes
        
        # =============================================
        # Phase 4: NMS deduplication
        # =============================================
        scores = ([0.85] * len(bubble_boxes)) + ([0.70] * len(merged_boxes))
        keep_indices = nms(all_boxes, scores, iou_threshold=NMS_IOU_THRESHOLD)
        final_boxes = [all_boxes[i] for i in keep_indices]
        final_scores = [scores[i] for i in keep_indices]
        
        logger.info(f"Phase 4: NMS kept {len(final_boxes)} regions from {len(all_boxes)}")
        
        # =============================================
        # Phase 4.2: DISTANCE-BASED DEDUP
        # Merge regions with centers within 15px (likely same text, different detections)
        # =============================================
        if len(final_boxes) > 1:
            dedup_keep = []
            dedup_used = set()
            for i in range(len(final_boxes)):
                if i in dedup_used:
                    continue
                ax, ay, aw, ah = final_boxes[i]
                acx, acy = ax + aw/2, ay + ah/2
                best_idx = i
                for j in range(i+1, len(final_boxes)):
                    if j in dedup_used:
                        continue
                    bx, by, bw, bh = final_boxes[j]
                    bcx, bcy = bx + bw/2, by + bh/2
                    dist = math.sqrt((acx-bcx)**2 + (acy-bcy)**2)
                    if dist < 15:
                        dedup_used.add(j)
                        if bw*bh > final_boxes[best_idx][2]*final_boxes[best_idx][3]:
                            best_idx = j
                dedup_keep.append(best_idx)
            if len(dedup_keep) < len(final_boxes):
                logger.info(f"Phase 4.2: distance dedup {len(final_boxes)} → {len(dedup_keep)} regions")
                final_boxes = [final_boxes[i] for i in dedup_keep]
                final_scores = [1.0] * len(dedup_keep)
        
        # =============================================
        # Phase 4.5: TEXT CONTENT VERIFICATION (P0 CRITICAL FIX)
        # Filter out regions that don't contain actual text content.
        # This is the key fix for PRD 2.2.1 precision requirements.
        # =============================================
        verified_boxes = []
        verified_scores = []
        for i, box in enumerate(final_boxes):
            bx, by_, bw, bh = box
            
            # Skip edge artifacts (page numbers, signatures) per PRD 2.2.3
            if _is_edge_region(box, w, h, gray):
                logger.debug(f"Phase 4.5: filtered edge region at ({bx},{by_}) {bw}x{bh}")
                continue
            
            # Verify text content
            roi = gray[by_:by_ + bh, bx:bx + bw] if bh > 0 and bw > 0 else None
            if roi is None or roi.size == 0:
                continue
            
            box_label = f"({bx},{by_}) {bw}x{bh}"
            is_text, confidence_adj = _verify_text_content(roi, box_label)
            if not is_text:
                logger.info(f"Phase 4.5: REJECTED non-text region at {box_label}")
                continue
            
            # Adjust confidence based on text content verification
            adjusted_score = final_scores[i] * (0.5 + 0.5 * confidence_adj)
            verified_boxes.append(box)
            verified_scores.append(min(0.95, adjusted_score))
        
        logger.info(f"Phase 4.5: text verification kept {len(verified_boxes)}/{len(final_boxes)} regions")
        
        # Sort: top-to-bottom, left-to-right
        sorted_indices = sorted(range(len(verified_boxes)),
                                key=lambda i: (verified_boxes[i][1], verified_boxes[i][0]))
        
        # =============================================
        # Phase 5: Build final region objects with shrink refinement
        # =============================================
        # P0 PRECISION FIX: Apply text-content-aware shrink to each box
        shrunk_boxes = []
        for idx in sorted_indices:
            box = verified_boxes[idx]
            shrunk = _shrink_to_text_content(box, gray)
            shrunk_boxes.append(shrunk)
        
        for idx in sorted_indices:
            bx, by_, bw, bh = shrunk_boxes[sorted_indices.index(idx)] if idx in sorted_indices else verified_boxes[idx]
            
            # Crop region image for analysis
            crop = img[by_:by_ + bh, bx:bx + bw] if bh > 0 and bw > 0 else None
            gray_crop = gray[by_:by_ + bh, bx:bx + bw] if bh > 0 and bw > 0 else None
            
            # P0 PRECISION FIX: Use improved classification with ROI gray analysis
            bbox = {"x": bx, "y": by_, "width": bw, "height": bh}
            region_type = _improved_classify_region_type(bbox, (w, h), gray_crop)
            
            # Fallback: contour analysis for thought bubbles
            contour_points = None
            if region_type == "speech" and crop is not None and crop.size > 0:
                try:
                    _, binary = cv2.threshold(gray_crop if gray_crop is not None else cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY), 127, 255, cv2.THRESH_BINARY)
                    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                    if contours:
                        largest = max(contours, key=cv2.contourArea)
                        if len(largest) >= 5:
                            contour_points = [(int(p[0][0]), int(p[0][1])) for p in largest]
                            shape_type = _analyze_contour_shape(contour_points, bw, bh)
                            if shape_type == "thought":
                                region_type = "thought"
                except Exception:
                    pass
            
            # Vertical text detection
            is_vertical = False
            angle = 0
            if crop is not None and crop.size > 0:
                is_vertical = _detect_vertical_text(crop)
                angle = 90 if is_vertical else 0
            
            # Arc text detection
            arc_curvature = 0.0
            if crop is not None and crop.size > 0:
                arc_curvature = _detect_arc_text(crop)
            
            # Confidence: start from verified score, adjust based on quality
            confidence = verified_scores[idx]
            area_ratio = (bw * bh) / (w * h + 1e-6)
            if 0.005 < area_ratio < 0.25:
                confidence = min(0.95, confidence + 0.05)
            aspect = bw / max(bh, 1)
            if 0.3 < aspect < 3.0:
                confidence = min(0.95, confidence + 0.05)
            # Penalize very small or very large regions
            if area_ratio < 0.002 or area_ratio > 0.30:
                confidence = max(0.30, confidence - 0.10)
            # PRD P0: Penalize "effect" type — most likely false positive (background/artifacts)
            if region_type == "effect":
                confidence = max(0.25, confidence - 0.15)
            # PRD P0: Penalize "onomatopoeia" type — higher risk of misclassification
            if region_type == "onomatopoeia":
                confidence = max(0.30, confidence - 0.08)
            # PRD 2.2.1: 置信度低于60%的区域高亮提醒
            # Mark regions with confidence < 0.60 as needing review
            confidence = round(confidence, 3)
            
            # Build simplified bubble contour for shape-aware rendering
            bubble_contour = None
            boundary_polygon = None
            if region_type in ("speech", "thought"):
                # Try to extract actual contour from the image
                if gray_crop is not None and gray_crop.size > 0:
                    try:
                        _, binary = cv2.threshold(gray_crop, 127, 255, cv2.THRESH_BINARY)
                        contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                        if contours:
                            largest = max(contours, key=cv2.contourArea)
                            if len(largest) >= 5:
                                # Convert to polygon points relative to image origin
                                polygon = [(int(p[0][0]) + bx, int(p[0][1]) + by_) for p in largest]
                                boundary_polygon = polygon
                                # Also keep as bubble_contour for backward compat
                                bubble_contour = polygon
                    except Exception:
                        pass

                # Fallback: generate ellipse contour if no actual contour found
                if bubble_contour is None:
                    cx = bx + bw / 2.0
                    cy = by_ + bh / 2.0
                    rx = bw / 2.0
                    ry = bh / 2.0
                    points = []
                    for t in range(0, 360, 5):
                        rad = math.radians(t)
                        px = int(cx + rx * math.cos(rad))
                        py = int(cy + ry * math.sin(rad))
                        points.append([px, py])
                    bubble_contour = points
                    boundary_polygon = points
            else:
                # For non-bubble regions (narration, effect, onomatopoeia):
                # Use convex hull of text pixels as tight polygon boundary
                if gray_crop is not None and gray_crop.size > 0:
                    try:
                        _, binary = cv2.threshold(gray_crop, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
                        coords = cv2.findNonZero(binary)
                        if coords is not None and len(coords) >= 5:
                            hull = cv2.convexHull(coords)
                            polygon = [(int(p[0][0]) + bx, int(p[0][1]) + by_) for p in hull]
                            boundary_polygon = polygon
                    except Exception:
                        pass

                # Fallback: use bbox as simple rectangle polygon
                if boundary_polygon is None:
                    boundary_polygon = [
                        [bx, by_], [bx + bw, by_],
                        [bx + bw, by_ + bh], [bx, by_ + bh]
                    ]

            regions.append({
                "region_id": str(uuid.uuid4()),
                "bbox": [bx, by_, bw, bh],
                "type": region_type,
                "confidence": round(confidence, 3),
                "angle": angle,
                "is_vertical": is_vertical,
                "arc_curvature": round(arc_curvature, 3),
                "bubble_contour": bubble_contour,
                "boundary": {
                    "x": bx, "y": by_, "width": bw, "height": bh,
                    "polygon": boundary_polygon,
                    "is_vertical": is_vertical,
                    "arc_curvature": round(arc_curvature, 3),
                    "shape_type": "ellipse" if region_type in ("speech", "thought") else "convex_hull",
                },
            })
        
        # Post-filter: remove oversized regions (background art, pure illustration areas)
        # v3 RELAXED: Manga title text can be large (up to 15% of page), e.g., "名探偵コナン" 
        # Only filter out regions that are clearly NOT text (very large + very regular = illustration)
        max_region_area_ratio = 0.15  # Relaxed from 0.08 — allow large title text
        max_region_w_ratio = 0.55     # Relaxed from 0.35 — allow wide title banners
        max_region_h_ratio = 0.40     # Relaxed from 0.30 — allow tall vertical titles
        filtered_regions = []
        for r in regions:
            b = r.get("boundary", {})
            rw = b.get("width", 0)
            rh = b.get("height", 0)
            area_ratio = (rw * rh) / (w * h + 1)
            w_ratio = rw / w
            h_ratio = rh / h
            if area_ratio > max_region_area_ratio or w_ratio > max_region_w_ratio or h_ratio > max_region_h_ratio:
                logger.debug(f"Filtered oversized region: {rw}x{rh} area={area_ratio:.3f}")
                continue
            filtered_regions.append(r)
        regions = filtered_regions
        
        # Limit to MAX_REGION_COUNT
        regions = regions[:MAX_REGION_COUNT]
        
        processing_time = (time.time() - start_time) * 1000
        
        logger.info(f"Final: {len(regions)} regions in {processing_time:.0f}ms")
        
        return {
            "regions": regions,
            "total_regions": len(regions),
            "processing_time_ms": round(processing_time, 1),
        }
        
    except Exception as e:
        logger.error(f"Detection failed: {e}", exc_info=True)
        processing_time = (time.time() - start_time) * 1000
        return {
            "regions": [],
            "total_regions": 0,
            "processing_time_ms": round(processing_time, 1),
            "error": str(e),
        }
