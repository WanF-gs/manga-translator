#!/usr/bin/env python3
"""Test PP-OCRv4 detection model directly"""
import cv2
import numpy as np
import urllib.request

# Load the image
url = "http://localhost:8002/api/v1/pages/953b9f4d-0667-4e4b-bb33-400c15d84853/image"
resp = urllib.request.urlopen(url, timeout=10)
data = resp.read()
img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
h, w = img.shape[:2]
print(f"Image: {w}x{h}")

# Try RapidOCR's built-in detection
from rapidocr_onnxruntime import RapidOCR
rapid = RapidOCR()

# Use the text detector directly
result, _ = rapid(img)
if result:
    print(f"RapidOCR detected {len(result)} text regions:")
    for i, (bbox, text, conf) in enumerate(result[:10]):
        xs = [p[0] for p in bbox]
        ys = [p[1] for p in bbox]
        x, y = min(xs), min(ys)
        bw, bh = max(xs)-min(xs), max(ys)-min(ys)
        print(f"  [{i}] ({x:.0f},{y:.0f}) {bw:.0f}x{bh:.0f} conf={conf:.2f} text={text[:20]}")
else:
    print("No text detected")
