"""Quick smoke test: 用数据库里的 user 直接生成 JWT，调 /learn/stats"""
import asyncio
import sys
import os

sys.path.insert(0, r"C:\Users\WanFi\Desktop\大三实训\demo_04\manga-translator-backend\services")

# 不启动 reader，只模拟调用
import httpx

# 用 wanf 用户的 ID 直接查
import psycopg2
conn = psycopg2.connect(
    host="localhost", port=5433,
    user="manga_user", password="manga_pass",
    database="manga_translator",
)
cur = conn.cursor()
cur.execute("SELECT user_id, email FROM users WHERE email LIKE '%wanf%' OR email LIKE '%qq.com%' LIMIT 5")
for r in cur.fetchall():
    print(r)
