"""Quick end-to-end test: detect → OCR"""
import httpx, asyncio, time, base64

AI_GW = "http://localhost:8100"
TEST_IMG = "/mnt/c/Users/WanFi/Desktop/大三实训/demo_04/测试项目/Ming Zhen Tan Ke Nan (102) - Qing Shan Gang Chang_页面_001_图像_0001.jpg"

def load_image_b64(path):
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode()

async def run():
    client = httpx.AsyncClient(timeout=180)
    img_b64 = load_image_b64(TEST_IMG)
    
    # DETECT
    print("=== DETECT ===")
    t0 = time.time()
    r = await client.post(f"{AI_GW}/detector/detect", json={
        "image_base64": img_b64, "language": "ja"
    })
    d = r.json()
    regions = d.get("regions", [])
    print(f"Regions: {len(regions)}, time: {time.time()-t0:.1f}s")
    
    if not regions:
        print("FAIL: 0 regions")
        return
    
    # Show first 3 regions
    for i, r in enumerate(regions[:3]):
        x, y, w, h = r.get("bbox", [0,0,0,0])
        print(f"  [{i}] ({x},{y}) {w}x{h} type={r.get('type','?')}")
    
    # OCR (Japanese manga → manga-ocr)
    print(f"\n=== OCR ===")
    ocr_regions = []
    for r in regions[:10]:  # Test first 10
        bbox = r["bbox"]
        ocr_regions.append({
            "bbox": bbox,
            "type": r.get("type", "speech"),
            "is_vertical": r.get("is_vertical", False),
        })
    
    t0 = time.time()
    r = await client.post(f"{AI_GW}/ocr/recognize", json={
        "image_base64": img_b64,
        "image_url": "data:image/jpeg;base64," + img_b64,
        "lang": "ja",
        "regions": ocr_regions,
    })
    ocr = r.json()
    results = ocr.get("results", [])
    non_empty = [o for o in results if o.get("text", "").strip()]
    print(f"OCR: {len(results)} regions, {len(non_empty)} with text, {time.time()-t0:.1f}s")
    for o in non_empty[:5]:
        print(f"  '{o.get('text','')[:40]}' conf={o.get('confidence',0):.2f} engine={o.get('engine_used','?')}")

asyncio.run(run())
