#!/usr/bin/env python3
"""Test inpaint endpoint directly"""
import httpx, json, base64, os

test_img = "/tmp/manga-storage/uploads/202ddf83-52c3-4493-bf47-36287b25f57f/originals/4e12eb3f789e4743911b7b97e60bea22.jpg"
with open(test_img, "rb") as f:
    img_b64 = base64.b64encode(f.read()).decode()

# Method 1: JSON body
print("=== Inpaint Test 1: JSON body ===")
payload = {
    "image_url": f"data:image/jpeg;base64,{img_b64}",
    "masks": [{"bbox": [100, 100, 200, 100]}],
    "method": "telea"
}
try:
    r = httpx.post("http://localhost:8100/inpaint/inpaint", json=payload, timeout=120)
    print(f"Status: {r.status_code}")
    data = r.json()
    for k, v in data.items():
        if k != "result_base64":
            print(f"  {k}: {v}")
    if data.get("result_base64"):
        print(f"  result_base64 length: {len(data['result_base64'])}")
except Exception as e:
    print(f"Error: {e}")

# Method 2: Check the endpoint directly with storage URL
print("\n=== Inpaint Test 2: storage URL ===")
payload2 = {
    "image_url": "http://localhost:8002/storage/202ddf83-52c3-4493-bf47-36287b25f57f/originals/4e12eb3f789e4743911b7b97e60bea22.jpg",
    "masks": [{"bbox": [100, 100, 200, 100]}],
    "method": "telea"
}
try:
    r = httpx.post("http://localhost:8100/inpaint/inpaint", json=payload2, timeout=120)
    print(f"Status: {r.status_code}")
    data = r.json()
    for k, v in data.items():
        if k != "result_base64":
            print(f"  {k}: {v}")
    if data.get("result_base64"):
        print(f"  result_base64 length: {len(data['result_base64'])}")
except Exception as e:
    print(f"Error: {e}")

# Method 3: Direct OpenCV inpaint test (bypass ai-gateway)
print("\n=== Inpaint Test 3: Direct OpenCV (bypass ai-gateway) ===")
import numpy as np
import cv2
img = cv2.imread(test_img)
if img is not None:
    mask = np.zeros(img.shape[:2], dtype=np.uint8)
    mask[100:200, 100:300] = 255
    result = cv2.inpaint(img, mask, 3, cv2.INPAINT_TELEA)
    _, buf = cv2.imencode(".png", result)
    print(f"OpenCV inpaint OK, result size: {len(buf.tobytes())} bytes")
else:
    print("Failed to read test image with OpenCV")
