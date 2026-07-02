from __future__ import annotations
import httpx, asyncio

async def test_gateway():
    async with httpx.AsyncClient(timeout=10) as c:
        # Test 1: Gateway health
        r = await c.get('http://gateway:8080/health')
        print('1. Gateway Health:', r.status_code, r.text[:120])
        
        # Test 2: Login via gateway -> user-service (use 'account' field)
        r = await c.post('http://gateway:8080/api/v1/auth/login',
            json={'account': 'testuser1@manga-translator.com', 'password': 'test123'})
        print('2. Login:', r.status_code, r.text[:200])

asyncio.run(test_gateway())
