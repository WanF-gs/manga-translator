import asyncpg, asyncio
async def main():
    conn = await asyncpg.connect(user='manga_user', password='manga_pass', host='127.0.0.1', port=5433, database='manga_translator')
    rows = await conn.fetch("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='projects' AND column_name='default_target_lang'")
    if rows:
        print(f"✅ Column exists: {rows[0]['column_name']} ({rows[0]['data_type']})")
    else:
        print("❌ Column NOT found")
    await conn.close()
asyncio.run(main())
