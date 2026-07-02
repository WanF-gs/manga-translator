from __future__ import annotations
import httpx, asyncio

async def test_translate():
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.post(
            'http://localhost:8100/llm/translate',
            json={'text': 'こんにちは', 'source_lang': 'ja', 'target_lang': 'zh-CN'}
        )
        print(r.status_code, r.text)

asyncio.run(test_translate())
