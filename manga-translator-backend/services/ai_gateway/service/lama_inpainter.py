from __future__ import annotations
"""
LaMa (Large Mask Inpainting) ONNX inference module.

LaMa uses Fast Fourier Convolution (FFC) for high-quality image inpainting,
excelling at filling large missing regions with natural textures.
This is the standard model used by manga-image-translator, IOPaint, etc.

Model source: Carve/LaMa-ONNX (HuggingFace), 186MB fp32 ONNX
Input:  4-channel (RGB + mask), normalized to [0, 1], 256x256
Output: 3-channel RGB inpainted image, 256x256

For manga: better than hand-crafted OpenCV methods on:
  - Screentone/dot pattern continuity
  - Gradient/blended background reconstruction
  - Speed-line / hatching area repair
"""

import logging
import os
from typing import Optional, Tuple

import numpy as np
import cv2

logger = logging.getLogger(__name__)

# === Model config ===
DEFAULT_MODEL_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "..", "models", "lama_fp32.onnx"
)
LAMA_INPUT_SIZE = 512  # LaMa ONNX fixed input size (model expects 512x512)


# === Global model cache ===
_model = None
_model_path_cache = None


def _load_lama_model(model_path: Optional[str] = None) -> Optional[object]:
    """Load LaMa ONNX model via onnxruntime (lazy, cached)."""
    global _model, _model_path_cache
    path = model_path or os.getenv("LAMA_MODEL_PATH", "") or DEFAULT_MODEL_PATH

    if _model is not None and _model_path_cache == path:
        return _model

    if not os.path.exists(path):
        logger.debug(f"LaMa model not found at: {path}")
        return None

    try:
        import onnxruntime as ort
        sess = ort.InferenceSession(path, providers=['CPUExecutionProvider'])
        _model = sess
        _model_path_cache = path
        logger.info(f"LaMa ONNX model loaded via onnxruntime: {path} ({os.path.getsize(path) / 1024 / 1024:.1f} MB)")
        return sess
    except Exception as e:
        logger.warning(f"Failed to load LaMa ONNX model: {e}")
        return None


def _preprocess(image: np.ndarray, mask: np.ndarray) -> Tuple[dict, Tuple[int, int]]:
    """
    Prepare image + mask for LaMa inference.
    
    LaMa ONNX expects TWO separate inputs:
      - 'image': (1, 3, 256, 256) float32, normalized to [0, 1]
      - 'mask':  (1, 1, 256, 256) float32, 1=keep, 0=erase
    
    Returns:
        (inputs_dict, original_size)
    """
    h, w = image.shape[:2]
    
    # Convert BGR to RGB, normalize to [0, 1]
    img_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    
    # Mask: LaMa expects 1=keep(solid), 0=erase(missing)
    # Our input: white(255)=erase, black(0)=keep → invert
    mask_norm = 1.0 - (mask.astype(np.float32) / 255.0)
    
    # Resize to 256x256
    img_resized = cv2.resize(img_rgb, (LAMA_INPUT_SIZE, LAMA_INPUT_SIZE), interpolation=cv2.INTER_LINEAR)
    mask_resized = cv2.resize(mask_norm, (LAMA_INPUT_SIZE, LAMA_INPUT_SIZE), interpolation=cv2.INTER_LINEAR)
    
    # Create blobs: NCHW format
    img_blob = img_resized.transpose(2, 0, 1)[np.newaxis, ...].astype(np.float32)  # (1, 3, 256, 256)
    mask_blob = mask_resized[np.newaxis, np.newaxis, ...].astype(np.float32)         # (1, 1, 256, 256)
    
    return {'image': img_blob, 'mask': mask_blob}, (h, w)


def _postprocess(output: np.ndarray, original_size: Tuple[int, int]) -> np.ndarray:
    """
    Convert LaMa output back to BGR image at original resolution.
    
    Args:
        output: Model output (1, 3, 256, 256), values in [0, 1]
        original_size: (H, W) of original image
    
    Returns:
        BGR image (H, W, 3), uint8
    """
    h, w = original_size
    
    # Extract and transpose: (1, 3, 512, 512) → (512, 512, 3)
    result = output[0].transpose(1, 2, 0)  # RGB, values in [0, 255]
    
    # Normalize: LaMa output is [0, 255], not [0, 1]
    result = result / 255.0
    result = np.clip(result, 0.0, 1.0)
    
    # Resize to original size
    result = cv2.resize(result, (w, h), interpolation=cv2.INTER_LINEAR)
    
    # Convert to BGR uint8
    result = (result * 255).astype(np.uint8)
    result = cv2.cvtColor(result, cv2.COLOR_RGB2BGR)
    
    return result


def inpaint_with_lama(
    image: np.ndarray,
    mask: np.ndarray,
    model_path: Optional[str] = None,
) -> Optional[np.ndarray]:
    """
    Run LaMa inpainting on an image, then blend with original to preserve quality.
    
    LaMa runs at 512x512 → upscaling to full resolution causes blur.
    Fix: blend LaMa output only into masked (text) regions, keep original elsewhere.
    
    Args:
        image: BGR image region to inpaint (H, W, 3)
        mask: Binary mask (H, W), white pixels = areas to erase/repair
        model_path: Optional path to lama_fp32.onnx
    
    Returns:
        Inpainted BGR image (H, W, 3), or None on failure
    """
    model = _load_lama_model(model_path)
    if model is None:
        return None
    
    try:
        # Preprocess
        inputs, orig_size = _preprocess(image, mask)
        
        # Inference via onnxruntime with two separate inputs
        output = model.run(None, inputs)
        output = output[0]  # first output is inpainted image
        
        # Postprocess
        lama_result = _postprocess(output, orig_size)
        
        # === BLEND: keep original in non-mask areas, use LaMa only in mask areas ===
        # Dilate mask slightly to avoid edge artifacts
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        mask_dilated = cv2.dilate(mask, kernel, iterations=1)
        mask_3ch = cv2.cvtColor(mask_dilated, cv2.COLOR_GRAY2BGR) / 255.0
        
        # Blend: mask=1 → use LaMa, mask=0 → use original
        result = (image * (1.0 - mask_3ch) + lama_result * mask_3ch).astype(np.uint8)
        
        logger.debug(f"LaMa blended: mask_region={mask.sum()//255}px, out_of={image.shape[0]*image.shape[1]}px")
        
        return result
    except Exception as e:
        logger.warning(f"LaMa inference failed: {e}")
        return None


def lama_is_available(model_path: Optional[str] = None) -> bool:
    """Check if LaMa model file exists and onnxruntime can load it."""
    path = model_path or os.getenv("LAMA_MODEL_PATH", "") or DEFAULT_MODEL_PATH
    if not os.path.exists(path):
        return False
    try:
        import onnxruntime as ort
        ort.InferenceSession(path, providers=['CPUExecutionProvider'])
        return True
    except Exception:
        return False
