#!/usr/bin/env python3
"""
Download manga-fine-tuned text detection ONNX model from manga-image-translator.

This script downloads the DBNet/ConvNeXt detection model that has been fine-tuned
on manga data (Manga109 dataset), which is MUCH better than the default PP-OCRv4
document model for detecting manga text like titles, speech bubbles, and sound effects.

Usage:
    python3 scripts/download_manga_det_model.py

After download, set the environment variable:
    export MANGA_DET_MODEL_PATH=/path/to/models/manga_det/detect.onnx

Or copy the model to the default location:
    cp detect.onnx manga-translator-backend/services/ai_gateway/models/manga_det/

The manga-image-translator detector will auto-load it on next startup.
"""

import os
import sys
import urllib.request
import shutil
import zipfile
import tempfile

# Model source: manga-image-translator's model repository
# The detection model (dbnet_convnext) is hosted on various mirrors
MODEL_MIRRORS = [
    # Primary: manga-image-translator release assets
    # These are from the project's auto-download mechanism
    "https://github.com/zyddnys/manga-image-translator/releases/download/detect/detect.onnx",
    # Fallback: HuggingFace mirror (if available)
    # "https://huggingface.co/...",
]

# Default install location
DEFAULT_MODEL_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "models"
)

def download_with_progress(url, dest_path):
    """Download a file with progress indication."""
    print(f"Downloading from: {url}")
    
    def _report(count, block_size, total_size):
        percent = min(int(count * block_size * 100 / total_size), 100) if total_size > 0 else 0
        sys.stdout.write(f"\r  {percent}% ({count * block_size / 1024 / 1024:.1f} MB)")
        sys.stdout.flush()
    
    try:
        urllib.request.urlretrieve(url, dest_path, _report)
        print()
        return True
    except Exception as e:
        print(f"\n  Failed: {e}")
        return False

def main():
    os.makedirs(DEFAULT_MODEL_DIR, exist_ok=True)
    model_path = os.path.join(DEFAULT_MODEL_DIR, "detect.onnx")
    
    if os.path.exists(model_path):
        size_mb = os.path.getsize(model_path) / 1024 / 1024
        print(f"Model already exists: {model_path} ({size_mb:.1f} MB)")
        print(f"To re-download, delete the file first.")
        print(f"\nSet environment variable:")
        print(f"  export MANGA_DET_MODEL_PATH={model_path}")
        return
    
    # Try each mirror
    for url in MODEL_MIRRORS:
        tmp_path = model_path + ".tmp"
        if download_with_progress(url, tmp_path):
            # Verify file size (should be >1MB)
            if os.path.getsize(tmp_path) > 1024 * 1024:
                os.rename(tmp_path, model_path)
                size_mb = os.path.getsize(model_path) / 1024 / 1024
                print(f"  Model saved: {model_path} ({size_mb:.1f} MB)")
                print(f"\n  ENV variable to set:")
                print(f"  export MANGA_DET_MODEL_PATH={model_path}")
                print(f"\n  Restart ai-gateway service to use the new model.")
                return
            else:
                os.remove(tmp_path)
                print("  File too small, trying next mirror...")
        # Clean up
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
    
    print("\nT All mirrors failed.")
    print("\nManual download options:")
    print("1. Clone manga-image-translator and copy models:")
    print("   git clone https://github.com/zyddnys/manga-image-translator.git")
    print("2. Or download from the project's model repository")
    print("3. Place the ONNX model at:", model_path)
    print("\nAfter manual download, set: export MANGA_DET_MODEL_PATH=" + model_path)

if __name__ == "__main__":
    main()
