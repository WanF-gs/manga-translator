#!/usr/bin/env python3
"""Direct test of image-service OCR and Inpaint endpoints"""
import httpx, time

PAGE_ID = "d5c45b98-c9f5-4aed-824b-2f61579117d0"
BASE_IMG = "http://127.0.0.1:8004"
BASE_GW = "http://127.0.0.1:8100"
BASE = "http://127.0.0.1:8080"

# 1. Login
print("[1] Login...")
r = httpx.post(f"{BASE}/api/v1/auth/login", json={"email": "wsl2test@test.com", "password": "test1234"}, timeout=5)
token = r.json()["data"]["tokens"]["access_token"]
h = {"Authorization": f"Bearer {token}"}
print("    OK")

# 2. OCR via image-service
print(f"\n[2] OCR via image-service (POST {BASE_IMG}/api/v1/pages/{PAGE_ID[:8]}.../ocr)")
t0 = time.time()
r = httpx.post(f"{BASE_IMG}/api/v1/pages/{PAGE_ID}/ocr", headers=h, json={"language": "ja"}, timeout=120)
elapsed = time.time() - t0
print(f"    Status: {r.status_code} ({elapsed:.1f}s)")
if r.status_code == 200:
    data = r.json()
    results = data.get("data", {}).get("results", [])
    text_count = sum(1 for rg in results if rg.get("text", "").strip())
    print(f"    Results: {len(results)} total, {text_count} with text")
    for rg in results[:5]:
        print(f"      text='{rg.get('text', '')[:50]}' conf={rg.get('confidence', 0):.2f}")
else:
    print(f"    Error: {r.text[:500]}")

# 3. Inpaint via image-service
print(f"\n[3] Inpaint via image-service (POST {BASE_IMG}/api/v1/pages/{PAGE_ID[:8]}.../inpaint)")
t0 = time.time()
r = httpx.post(f"{BASE_IMG}/api/v1/pages/{PAGE_ID}/inpaint", headers=h, json={
    "method": "telea",
    "background_preserve": True,
}, timeout=120)
elapsed = time.time() - t0
print(f"    Status: {r.status_code} ({elapsed:.1f}s)")
if r.status_code == 200:
    data = r.json()
    d = data.get("data", data)
    print(f"    Method: {d.get('method')}, regions: {d.get('regions_processed')}")
    if d.get("result_url"):
        print(f"    Result URL: {d['result_url']}")
else:
    print(f"    Error: {r.text[:500]}")

# 4. Full pipeline via gateway
print(f"\n[4] Full pipeline via gateway")
print("    4a. Detect...")
t0 = time.time()
r = httpx.post(f"{BASE}/api/v1/pages/{PAGE_ID}/detect", headers=h, json={"language": "ja"}, timeout=60)
elapsed = time.time() - t0
print(f"        Status: {r.status_code} ({elapsed:.1f}s)")
if r.status_code == 200:
    regions = r.json().get("data", {}).get("regions", [])
    print(f"        Detected {len(regions)} regions")
else:
    print(f"        Error: {r.text[:300]}")

print("    4b. OCR...")
t0 = time.time()
r = httpx.post(f"{BASE}/api/v1/pages/{PAGE_ID}/ocr", headers=h, json={"language": "ja"}, timeout=120)
elapsed = time.time() - t0
print(f"        Status: {r.status_code} ({elapsed:.1f}s)")
if r.status_code == 200:
    results = r.json().get("data", {}).get("results", [])
    text_count = sum(1 for rg in results if rg.get("text", "").strip())
    print(f"        OCR: {len(results)} regions, {text_count} with text")
    for rg in results[:3]:
        print(f"          text='{rg.get('text', '')[:40]}'")
else:
    print(f"        Error: {r.text[:300]}")

print("    4c. Translate...")
t0 = time.time()
r = httpx.post(f"{BASE}/api/v1/pages/{PAGE_ID}/translate", headers=h, json={"target_lang": "zh-CN"}, timeout=120)
elapsed = time.time() - t0
print(f"        Status: {r.status_code} ({elapsed:.1f}s)")
if r.status_code == 200:
    translated = r.json().get("data", {}).get("regions", [])
    non_empty = sum(1 for rg in translated if rg.get("translated_text", "").strip())
    print(f"        Translated: {len(translated)} regions, {non_empty} with text")
    for rg in translated[:3]:
        print(f"          '{rg.get('translated_text', '')[:40]}'")
else:
    print(f"        Error: {r.text[:300]}")

print("    4d. Inpaint...")
t0 = time.time()
r = httpx.post(f"{BASE}/api/v1/pages/{PAGE_ID}/inpaint", headers=h, json={"method": "telea", "background_preserve": True}, timeout=120)
elapsed = time.time() - t0
print(f"        Status: {r.status_code} ({elapsed:.1f}s)")
if r.status_code == 200:
    d = r.json().get("data", {})
    print(f"        Method: {d.get('method')}, regions: {d.get('regions_processed')}")
else:
    print(f"        Error: {r.text[:300]}")

print("\n=== ALL TESTS COMPLETE ===")
