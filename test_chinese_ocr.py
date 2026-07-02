#!/usr/bin/env python3
"""Quick test: Chinese OCR with PaddleOCR"""
import cv2, numpy as np, sys
from paddleocr import PaddleOCR

img_path = sys.argv[1] if len(sys.argv) > 1 else None
if not img_path:
    print("Usage: python3 test_chinese_ocr.py <image.jpg>")
    sys.exit(1)

print("Loading PaddleOCR ch model...")
ocr = PaddleOCR(lang='ch', show_log=False)
print("OK. Loading image...")

img = cv2.imread(img_path)
print(f"Image: {img.shape[1]}x{img.shape[0]}")

# Test a middle crop
h, w = img.shape[:2]
crop = img[h//3:2*h//3, w//4:3*w//4]
print(f"Testing crop: {crop.shape[1]}x{crop.shape[0]}")

result = ocr.ocr(crop)
if result and result[0]:
    for line in result[0]:
        print(f"  Text: [{line[1][0]}], Conf: {line[1][1]:.2f}")
else:
    print("  No text detected in crop")
print("Done.")
