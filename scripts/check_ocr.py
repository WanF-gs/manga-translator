import importlib
import sys

# Check manga-ocr
try:
    from manga_ocr import MangaOcr
    print("manga-ocr: AVAILABLE")
except Exception as e:
    print("manga-ocr: NOT AVAILABLE -", str(e)[:80])

# Check PaddleOCR
try:
    from paddleocr import PaddleOCR
    print("PaddleOCR: AVAILABLE")
except Exception as e:
    print("PaddleOCR: NOT AVAILABLE -", str(e)[:80])

# Check PyTorch
try:
    import torch
    print(f"PyTorch: AVAILABLE (version {torch.__version__})")
except Exception as e:
    print("PyTorch: NOT AVAILABLE -", str(e)[:80])

# Check cv2
try:
    import cv2
    print(f"OpenCV: AVAILABLE (version {cv2.__version__})")
except Exception as e:
    print("OpenCV: NOT AVAILABLE -", str(e)[:80])

# Check python path
print(f"\nPython: {sys.executable}")
print(f"Path: {sys.path[:3]}")
