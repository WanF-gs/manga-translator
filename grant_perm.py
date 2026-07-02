import subprocess, os
# Grant manga_user permission to alter the projects table
# PostgreSQL peer auth on unix socket should work for 'postgres' user
r = subprocess.run(
    ['sudo', '-u', 'postgres', 'psql', '-p', '5433', '-d', 'manga_translator', '-c',
     "GRANT ALL ON TABLE projects TO manga_user"],
    capture_output=True, text=True, env={**os.environ, 'PGHOST': ''}
)
print("GRANT:", r.stdout, r.stderr)

# Now run the ALTER TABLE as manga_user via TCP
import asyncpg, asyncio
async def main():
    conn = await asyncpg.connect(user='manga_user', password='manga_pass', host='localhost', port=5433, database='manga_translator')
    await conn.execute("ALTER TABLE projects ADD COLUMN IF NOT EXISTS default_target_lang VARCHAR(10) DEFAULT 'zh-CN'")
    print("Migration done")
    await conn.close()
asyncio.run(main())
