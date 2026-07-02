"""End-to-end test: detect → OCR → translate → inpaint → render"""
import httpx, asyncio, time, base64, os

AI_GW = "http://localhost:8100"
IMG_SVC = "http://localhost:8004"
TRANS_SVC = "http://localhost:8003"

# Use a test image from the project
TEST_IMG = "/mnt/c/Users/WanFi/Desktop/大三实训/demo_04/测试项目/Ming Zhen Tan Ke Nan (102) - Qing Shan Gang Chang_页面_001_图像_0001.jpg"

def load_image_b64(path):
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode()

async def test_pipeline():
    client = httpx.AsyncClient(timeout=120)
    
    # Step 1: Upload test image to image-service
    img_b64 = load_image_b64(TEST_IMG)
    
    # Step 2: Detect via ai-gateway directly
    print("=== STEP 1: DETECT ===")
    t0 = time.time()
    r = await client.post(f"{AI_GW}/detector/detect", json={
        "image_base64": img_b64,
        "language": "ja",
    })
    detect = r.json()
    dt = time.time() - t0
    total_regions = detect.get("total_regions", 0)
    print(f"Detected: {total_regions} regions in {dt:.1f}s")
    
    if total_regions == 0:
        print("FAIL: No regions detected")
        return
    
    # Sample some regions
    regions = detect.get("regions", [])
    sample = regions[:5]
    print(f"Sample regions: {[(r['x'], r['y'], r['width'], r['height']) for r in sample]}")
    
    # Step 3: OCR via ai-gateway
    print(f"\n=== STEP 2: OCR ({total_regions} regions) ===")
    t0 = time.time()
    ocr_req = {
        "image_base64": img_b64,
        "lang": "ja",
        "regions": [{"bbox": [r["x"], r["y"], r["width"], r["height"]], 
                      "type": r.get("type", "speech"), "is_vertical": r.get("is_vertical", False)} 
                     for r in regions],
    }
    r = await client.post(f"{AI_GW}/ocr/recognize", json=ocr_req)
    ocr = r.json()
    ocr_dt = time.time() - t0
    
    ocr_results = ocr.get("results", [])
    non_empty = [o for o in ocr_results if o.get("text", "").strip()]
    print(f"OCR: {len(ocr_results)} regions, {len(non_empty)} non-empty, {ocr_dt:.1f}s")
    for o in non_empty[:5]:
        print(f"  [{o.get('region_id','?')[:8]}] '{o['text'][:40]}' conf={o.get('confidence',0):.2f} engine={o.get('engine_used','?')}")
    
    # Step 4: Test translation (DeepSeek)
    if non_empty:
        print(f"\n=== STEP 3: TRANSLATE (DeepSeek) ===")
        for o in non_empty[:3]:
            text = o["text"][:100]
            t0 = time.time()
            r = await client.post(f"{TRANS_SVC}/api/v1/translate", json={
                "text": text,
                "source_lang": "ja",
                "target_lang": "zh-CN",
                "region_type": o.get("type", "speech"),
            })
            trans = r.json()
            dt = time.time() - t0
            print(f"  '{text[:30]}...' → '{trans.get('text','?')[:30]}...' engine={trans.get('engine_used','?')} ({dt:.1f}s)")
    
    # Step 5: Inpaint via ai-gateway
    print(f"\n=== STEP 4: INPAINT (LaMa) ===")
    # Build mask from text regions
    import cv2, numpy as np
    import io
    
    img_bytes = base64.b64decode(img_b64)
    img_np = cv2.imdecode(np.frombuffer(img_bytes, np.uint8), cv2.IMREAD_COLOR)
    h, w = img_np.shape[:2]
    
    # Create masks
    masks = []
    for r in regions:
        rx, ry, rw, rh = r["x"], r["y"], r["width"], r["height"]
        mask = np.zeros((h, w), dtype=np.uint8)
        ex = max(1, int(rw * 0.25))
        ey = max(1, int(rh * 0.25))
        mask[max(0,ry-ey):min(h,ry+rh+ey), max(0,rx-ex):min(w,rx+rw+ex)] = 255
        mask_b64 = base64.b64encode(cv2.imencode('.png', mask)[1]).decode()
        masks.append({
            "x": rx, "y": ry, "width": rw, "height": rh,
            "mask_data": mask_b64, "mask_format": "png",
            "region_type": r.get("type", "speech"),
            "erase_mode": "text",
        })
    
    t0 = time.time()
    r = await client.post(f"{AI_GW}/inpaint/inpaint", json={
        "image_base64": img_b64,
        "masks": skip_masks,
        "method": "lama",
        "bubble_erase": False,
    })
    inpaint = r.json()
    inpaint_dt = time.time() - t0
    
    if inpaint.get("result_data"):
        result_b64 = inpaint["result_data"]
        result_bytes = base64.b64decode(result_b64)
        result_img = cv2.imdecode(np.frombuffer(result_bytes, np.uint8), cv2.IMREAD_COLOR)
        if result_img is not None:
            mean = np.mean(result_img)
            dark = np.sum(np.all(result_img < 50, axis=2)) / (result_img.shape[0]*result_img.shape[1]) * 100
            white = np.sum(np.all(result_img > 250, axis=2)) / (result_img.shape[0]*result_img.shape[1]) * 100
            print(f"Inpaint: {result_img.shape[1]}x{result_img.shape[0]}, mean={mean:.0f}, dark={dark:.1f}%, white={white:.1f}%, {inpaint_dt:.1f}s")
            cv2.imwrite("/tmp/test_pipeline_inpainted.png", result_img)
            print("Saved: /tmp/test_pipeline_inpainted.png")
        else:
            print(f"Inpaint: FAILED to decode result, data_len={len(result_b64)}")
    else:
        print(f"Inpaint: FAILED {inpaint.get('error', 'no result')}")
    
    print("\n=== SUMMARY ===")
    print(f"Detect: {total_regions} regions")
    print(f"OCR: {len(non_empty)}/{len(ocr_results)} non-empty")
    print(f"Inpaint: {'PASS' if inpaint.get('result_data') else 'FAIL'}")
    print(f"Method: {inpaint.get('method', '?')}")

asyncio.run(test_pipeline())
