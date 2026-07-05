from __future__ import annotations
"""
Comic Text Detector (CTD) ONNX-based manga text detection module.

This is a STANDALONE detector using the manga-image-translator's
comictextdetector.pt.onnx model (YOLO + DBNet hybrid, trained on manga data).
It works with OpenCV DNN — zero extra dependencies (no PyTorch/PaddlePaddle).

Model source: https://github.com/zyddnys/manga-image-translator
"""

import logging
import math
import os
from typing import List, Tuple, Optional

import numpy as np
import cv2

logger = logging.getLogger(__name__)

# === Model config ===
DEFAULT_MODEL_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "..", "models", "comictextdetector.pt.onnx"
)
INPUT_SIZE = 1024
CONF_THRESH = float(os.getenv("CTD_CONF_THRESH", "0.25"))
MASK_THRESH = float(os.getenv("CTD_MASK_THRESH", "0.02"))  # 0.02: very permissive for max text recall on low-res manga


# === Global model cache ===
_model = None
_model_path_cache = None


def _load_ctd_model(model_path: Optional[str] = None) -> Optional[object]:
    """Load CTD ONNX model via OpenCV DNN (lazy, cached)."""
    global _model, _model_path_cache
    path = model_path or os.getenv("CTD_MODEL_PATH", "") or DEFAULT_MODEL_PATH

    if _model is not None and _model_path_cache == path:
        return _model

    if not os.path.exists(path):
        logger.debug(f"CTD model not found at: {path}")
        return None

    try:
        net = cv2.dnn.readNetFromONNX(path)
        _model = net
        _model_path_cache = path
        logger.info(f"CTD ONNX model loaded: {path} ({os.path.getsize(path) / 1024 / 1024:.1f} MB)")
        return net
    except Exception as e:
        logger.warning(f"Failed to load CTD ONNX model: {e}")
        return None


def _letterbox(img: np.ndarray, new_shape: int = INPUT_SIZE) -> Tuple[np.ndarray, float, int, int]:
    """
    Resize image to new_shape maintaining aspect ratio, pad to square.
    Compatible with YOLO letterbox convention.
    """
    h, w = img.shape[:2]
    r = new_shape / max(h, w)
    if r != 1:
        new_w, new_h = int(round(w * r)), int(round(h * r))
    else:
        new_w, new_h = w, h

    dw = (new_shape - new_w) / 2
    dh = (new_shape - new_h) / 2
    top, bottom = int(round(dh - 0.1)), int(round(dh + 0.1))
    left, right = int(round(dw - 0.1)), int(round(dw + 0.1))

    img_resized = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
    img_padded = cv2.copyMakeBorder(
        img_resized, top, bottom, left, right,
        cv2.BORDER_CONSTANT, value=(114, 114, 114)
    )
    return img_padded, r, int(top), int(bottom), int(left), int(right)


def detect_with_ctd(
    image: np.ndarray,
    model_path: Optional[str] = None,
) -> List[Tuple[int, int, int, int]]:
    """
    Run CTD (Comic Text Detector) ONNX model on an image.

    Args:
        image: BGR image as numpy array (H, W, 3)
        model_path: Optional path to comictextdetector.pt.onnx

    Returns:
        List of (x, y, w, h) bounding boxes in image coordinates.
    """
    model = _load_ctd_model(model_path)
    if model is None:
        return []

    im_h, im_w = image.shape[:2]

    # 对低分辨率图片进行上采样，提升 CTD 检测召回率
    # 漫画文字在 348x498 等低分辨率下几乎不可见，放大 2x 让文字特征更清晰
    scale = 1.0
    if max(im_h, im_w) < 600:
        scale = 2.0
        image = cv2.resize(image, (int(im_w * scale), int(im_h * scale)), interpolation=cv2.INTER_CUBIC)
        im_h, im_w = image.shape[:2]
        logger.info(f"CTD: upscaled image by {scale}x for better detection ({int(im_w/scale)}x{int(im_h/scale)} → {im_w}x{im_h})")

    # Preprocess: letterbox to 1024x1024
    img_in, ratio, top_pad, bottom_pad, left_pad, right_pad = _letterbox(image, INPUT_SIZE)

    # Normalize to [0,1] and create blob
    blob = cv2.dnn.blobFromImage(img_in, scalefactor=1 / 255.0, size=(INPUT_SIZE, INPUT_SIZE), swapRB=False)
    model.setInput(blob)

    # Forward pass
    output_names = model.getUnconnectedOutLayersNames()
    outputs = model.forward(output_names)

    if len(outputs) < 2:
        logger.warning(f"CTD model returned unexpected output count: {len(outputs)}")
        return []

    # outputs: [blks, mask, lines_map] (3 outputs) or [mask, lines_map] (2)
    # mask is at index depending on how many outputs
    # Try to locate mask: it should be 2D or 3D with shape like [1, H, W]
    mask = None
    for out in outputs:
        arr = out if isinstance(out, np.ndarray) else np.array(out)
        arr = np.squeeze(arr)
        if arr.ndim == 2 and arr.shape[0] > 8 and arr.shape[1] > 8:
            mask = arr
            break

    if mask is None:
        logger.warning("CTD: could not find mask in outputs")
        return []

    # Crop letterbox padding — use actual padding coordinates, not dh/ratio hack
    # The content in the 1024x1024 mask occupies pixels [top:dim-top, left:dim-left]
    mask_h, mask_w = mask.shape[:2]
    top, left = int(top_pad), int(left_pad)
    bottom = max(1, mask_h - int(bottom_pad))
    right_margin = max(1, mask_w - int(right_pad))
    mask = mask[top:bottom, left:right_margin]

    # Resize mask back to original image size
    mask = cv2.resize(mask, (im_w, im_h), interpolation=cv2.INTER_LINEAR)

    # Threshold to binary
    _, binary = cv2.threshold((mask * 255).astype(np.uint8), int(MASK_THRESH * 255), 255, cv2.THRESH_BINARY)

    # 形态学重连：CTD mask 阈值化后常把整行/整列文字切成单字。
    # 漫画有横排也有竖排，用"竖长核 + 横长核"两次 close 分别重连竖排列和横排行，
    # 让同一句话的字连成一个连通域，避免过度分割成大量单字框。
    # 核尺寸适中，避免糊连相邻气泡。
    v_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 15))   # 竖排：纵向桥接
    h_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 5))   # 横排：横向桥接
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, v_kernel, iterations=1)
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, h_kernel, iterations=1)

    # Find contours
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    boxes = []
    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area < 40:  # 最小文字区域（放宽：拟声词/振假名等小字也保留）
            continue
        x, y, bw, bh = cv2.boundingRect(cnt)
        # 轻微外扩 margin，并正确裁剪到图像边界（修复：旧逻辑 w/h 裁剪算错，
        # 会在近边缘处产生过大/负宽高的畸形框）
        margin = max(2, int(min(bw, bh) * 0.04))
        nx = max(0, x - margin)
        ny = max(0, y - margin)
        nx2 = min(im_w, x + bw + margin)
        ny2 = min(im_h, y + bh + margin)
        nw = nx2 - nx
        nh = ny2 - ny
        if nw <= 0 or nh <= 0:
            continue
        boxes.append((nx, ny, nw, nh))

    logger.info(f"CTD detection: {len(boxes)} regions (mask={mask_h}x{mask_w}→{im_w}x{im_h})")
    return boxes


def ctd_is_available(model_path: Optional[str] = None) -> bool:
    """Check if CTD model file exists and OpenCV supports ONNX."""
    path = model_path or os.getenv("CTD_MODEL_PATH", "") or DEFAULT_MODEL_PATH
    if not os.path.exists(path):
        return False
    try:
        cv2.dnn.readNetFromONNX(path)
        return True
    except Exception:
        return False
