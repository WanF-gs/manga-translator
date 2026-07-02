import httpx, json

r = httpx.post("http://127.0.0.1:8080/api/v1/auth/login", json={"email": "wsl2test@test.com", "password": "test1234"})
token = r.json()["data"]["tokens"]["access_token"]
h = {"Authorization": f"Bearer {token}"}
page_id = "088c5f06-9762-4b02-bb9b-b2600be368c9"

# Step 1: Get translated data
print("Getting translated data...")
r = httpx.post(f"http://127.0.0.1:8080/api/v1/pages/{page_id}/translate", headers=h, json={"target_lang": "zh-CN"}, timeout=60)
data = r.json()
translated = data.get("data", {}).get("regions", [])
non_empty = [rg for rg in translated if rg.get("translated_text", "").strip()]
print(f"  Got {len(non_empty)} translated regions")

# Step 2: Render with translated data (pass only required fields)
print("\nRendering with translated regions...")
render_regions = []
for rg in non_empty[:5]:
    render_regions.append({
        "region_id": rg["region_id"],
        "translated_text": rg["translated_text"],
        "alignment": "center",
    })
print(f"  Passing {len(render_regions)} regions")

r = httpx.post(f"http://127.0.0.1:8004/api/v1/pages/{page_id}/render", headers=h, json={
    "regions": render_regions,
}, timeout=60)
print(f"  Status: {r.status_code}")
if r.status_code == 200:
    resp = r.json()
    d = resp.get("data", resp)
    print(f"  Rendered: {d.get('regions_rendered', 0)} regions")
    print(f"  Result: {d.get('result_url', 'N/A')}")
    print(f"  Warnings: {d.get('warnings', [])}")
else:
    print(f"  Response: {r.text[:300]}")

# Step 3: Export
print("\nExporting single page...")
r = httpx.post("http://127.0.0.1:8080/api/v1/exports/single", headers=h, json={
    "page_id": page_id,
    "format": "png",
    "quality": 90,
}, timeout=120)
print(f"  Status: {r.status_code}")
resp = r.json()
d = resp.get("data", resp)
print(f"  Task: {d.get('task_id', 'N/A')[:12]}")
print(f"  Status: {d.get('status', 'N/A')}")
print(f"  Download: {d.get('download_url', 'N/A')}")
