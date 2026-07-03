"""Smoke test: login + GET /learn/stats"""
import httpx
import json

BASE = "http://localhost:8080/api/v1"

# 1. 登录
r = httpx.post(f"{BASE}/auth/login", json={"email": "4@qq.com", "password": "@Wanf123789"}, timeout=10)
print("login status:", r.status_code)
data = r.json().get("data") or {}
token = data.get("access_token") or data.get("token")
if not token:
    print("No token in response:", r.json())
    raise SystemExit(1)
print("token len:", len(token))

# 2. /learn/stats
h = {"Authorization": f"Bearer {token}"}
r = httpx.get(f"{BASE}/learn/stats", headers=h, timeout=10)
print("stats status:", r.status_code)
print("stats body:", r.text[:500])
