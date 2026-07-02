import asyncpg, asyncio
async def main():
    conn = await asyncpg.connect(user='manga_user', password='manga_pass', host='localhost', port=5433, database='manga_translator')
    rows = await conn.fetch("SELECT tablename, tableowner FROM pg_tables WHERE schemaname='public' AND tablename='projects'")
    for r in rows:
        print(r)
    await conn.close()
asyncio.run(main())
