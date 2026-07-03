"""测试 review 接口 fallback"""
import httpx

BASE = "http://localhost:8080/api/v1"

# 1. 登录
r = httpx.post(f"{BASE}/auth/login", json={"email": "4@qq.com", "password": "@Wanf123789"}, timeout=10)
print("login resp:", r.text[:300])
