import httpx

r = httpx.post("http://127.0.0.1:8080/api/v1/auth/login", json={"email": "wsl2test@test.com", "password": "test1234"})
token = r.json()["data"]["tokens"]["access_token"]
h = {"Authorization": f"Bearer {token}"}

page_id = "0a5f4c85-8300-45d4-afd6-5e12936f57cd"
chid = "97ba4d27-67f4-489f-ae88-279f7caee26e"

# Test render with empty regions (auto from DB)
print("=== Render (auto from DB, empty regions) ===")
r = httpx.post(f"http://127.0.0.1:8004/api/v1/pages/{page_id}/render", headers=h, json={"regions": []}, timeout=60)
print(f"Status: {r.status_code}")
data = r.json()
d = data.get("data", data)
print(f"  rendered: {d.get('regions_rendered', 0)}")
print(f"  status: {d.get('status')}")
print(f"  result_url: {d.get('result_url', 'N/A')}")
print(f"  warnings: {d.get('warnings', [])}")

# Test export single
print("\n=== Export Single ===")
r = httpx.post("http://127.0.0.1:8005/api/v1/exports/single", headers=h, json={
    "page_id": page_id,
    "format": "png",
    "quality": 90,
}, timeout=120)
print(f"Status: {r.status_code}")
data = r.json()
print(f"  Response: {data}")

# Test export via gateway
print("\n=== Export via Gateway ===")
r = httpx.post("http://127.0.0.1:8080/api/v1/exports/single", headers=h, json={
    "page_id": page_id,
    "format": "png",
}, timeout=120)
print(f"Status: {r.status_code}")
data = r.json()
print(f"  Response: {data}")

# Check what the render service needs
print("\n=== Render with specific regions ===")
r = httpx.post(f"http://127.0.0.1:8004/api/v1/pages/{page_id}/render", headers=h, json={
    "regions": [
        {"region_id": "test1", "translated_text": "test", "font_size": 16, "alignment": "center"}
    ]
}, timeout=60)
print(f"Status: {r.status_code}")
data = r.json()
d = data.get("data", data)
print(f"  rendered: {d.get('regions_rendered', 0)}")
print(f"  status: {d.get('status')}")
print(f"  warnings: {d.get('warnings', [])}")
