import asyncpg, asyncio
async def main():
    conn = await asyncpg.connect(
        user='manga_user', password='manga_pass',
        host='localhost', port=5433, database='manga_translator'
    )
    await conn.execute("ALTER TABLE projects ADD COLUMN IF NOT EXISTS default_target_lang VARCHAR(10) DEFAULT 'zh-CN'")
    print("Migration completed: added default_target_lang to projects")
    await conn.close()
asyncio.run(main())
