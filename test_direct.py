#!/usr/bin/env python3
"""Direct OCR test against image-service + ai-gateway"""
import httpx, json, time, base64, sys

# Test 1: Direct AI Gateway OCR with base64 image
print("=== Test 1: AI Gateway OCR (base64) ===")
# Load a test image
import os
test_img = "/tmp/manga-storage/uploads/202ddf83-52c3-4493-bf47-36287b25f57f/originals/4e12eb3f789e4743911b7b97e60bea22.jpg"
if os.path.exists(test_img):
    with open(test_img, "rb") as f:
        img_b64 = base64.b64encode(f.read()).decode()
    
    payload = {
        "image_url": f"data:image/jpeg;base64,{img_b64[:100]}...",
        "regions": [{"region_id": "test1", "bbox": [100, 100, 200, 100]}],
        "lang": "ja"
    }
    # Use real base64
    payload["image_url"] = f"data:image/jpeg;base64,{img_b64}"
    
    try:
        r = httpx.post("http://localhost:8100/ocr/recognize", json=payload, timeout=120)
        print(f"  Status: {r.status_code}")
        data = r.json()
        if data.get("results"):
            for res in data["results"][:3]:
                print(f"  Region {res.get('region_id','?')[:8]}: text='{res.get('text','')}' conf={res.get('confidence',0)}")
        else:
            print(f"  Response: {json.dumps(data, ensure_ascii=False)[:300]}")
    except Exception as e:
        print(f"  Error: {e}")
else:
    print(f"  Test image not found: {test_img}")

# Test 2: Direct AI Gateway Inpaint with base64 image
print("\n=== Test 2: AI Gateway Inpaint (base64) ===")
if os.path.exists(test_img):
    payload = {
        "image_url": f"data:image/jpeg;base64,{img_b64}",
        "masks": [{"region_id": "test1", "bbox": [100, 100, 200, 100]}],
        "method": "telea",
        "bubble_erase": False
    }
    try:
        r = httpx.post("http://localhost:8100/inpaint/inpaint", json=payload, timeout=120)
        print(f"  Status: {r.status_code}")
        data = r.json()
        print(f"  Method: {data.get('method')}, regions: {data.get('regions_processed')}")
        if data.get("result_base64"):
            print(f"  Result base64 length: {len(data['result_base64'])}")
        elif data.get("result_url"):
            print(f"  Result URL: {data['result_url']}")
        if data.get("error"):
            print(f"  Error: {data['error']}")
        print(f"  Processing time: {data.get('processing_time_ms', 0)}ms")
    except Exception as e:
        print(f"  Error: {e}")

# Test 3: Image-service OCR via URL
print("\n=== Test 3: Image-service OCR via /storage/ URL ===")
storage_url = "http://localhost:8002/storage/202ddf83-52c3-4493-bf47-36287b25f57f/originals/4e12eb3f789e4743911b7b97e60bea22.jpg"
try:
    r = httpx.get(storage_url, timeout=10)
    print(f"  Storage URL accessible: {r.status_code}, size={len(r.content)} bytes")
except Exception as e:
    print(f"  Storage URL error: {e}")

# Test 4: AI Gateway OCR with storage URL
print("\n=== Test 4: AI Gateway OCR (storage URL) ===")
payload = {
    "image_url": storage_url,
    "regions": [{"region_id": "test1", "bbox": [100, 100, 200, 100]}],
    "lang": "ja"
}
try:
    r = httpx.post("http://localhost:8100/ocr/recognize", json=payload, timeout=120)
    print(f"  Status: {r.status_code}")
    data = r.json()
    if data.get("results"):
        for res in data["results"][:3]:
            print(f"  Region {res.get('region_id','?')[:8]}: text='{res.get('text','')}' conf={res.get('confidence',0)}")
    else:
        print(f"  Response: {json.dumps(data, ensure_ascii=False)[:500]}")
except Exception as e:
    print(f"  Error: {e}")

# Test 5: AI Gateway Inpaint with storage URL
print("\n=== Test 5: AI Gateway Inpaint (storage URL) ===")
payload = {
    "image_url": storage_url,
    "masks": [{"region_id": "test1", "bbox": [100, 100, 200, 100]}],
    "method": "telea",
    "bubble_erase": False
}
try:
    r = httpx.post("http://localhost:8100/inpaint/inpaint", json=payload, timeout=120)
    print(f"  Status: {r.status_code}")
    data = r.json()
    print(f"  Method: {data.get('method')}, regions: {data.get('regions_processed')}")
    if data.get("result_base64"):
        print(f"  Result base64 length: {len(data['result_base64'])}")
    elif data.get("result_url"):
        print(f"  Result URL: {data['result_url']}")
    if data.get("error"):
        print(f"  Error: {data['error']}")
    print(f"  Processing time: {data.get('processing_time_ms', 0)}ms")
except Exception as e:
    print(f"  Error: {e}")
