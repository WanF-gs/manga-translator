import httpx, json, sys, os, traceback
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "manga-translator-backend", "services"))
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://manga_user:manga_pass@localhost:5433/manga_translator")
os.environ.setdefault("AI_SERVICE_BASE_URL", "http://localhost:8100")
os.environ.setdefault("JWT_SECRET_KEY", "your-super-secret-jwt-key-change-in-production")
os.environ.setdefault("MINIO_ENDPOINT", "localhost:9000")
os.environ.setdefault("MINIO_ACCESS_KEY", "minioadmin")
os.environ.setdefault("MINIO_SECRET_KEY", "minioadmin")
os.environ.setdefault("MINIO_BUCKET", "manga-translator")

import asyncio
from image_service.service.render_service import RenderService
from sqlalchemy.ext.asyncio import create_async_engine
from common.core.config import settings

async def main():
    engine = create_async_engine(settings.DATABASE_URL)
    from sqlalchemy.ext.asyncio import AsyncSession
    async with AsyncSession(engine) as session:
        svc = RenderService(session)
        try:
            result = await svc.render(
                page_id="088c5f06-9762-4b02-bb9b-b2600be368c9",
                user_id="test",
                regions=[{"region_id": "e086249f-39b1-4ac4-a630-4b83ee320e1b", "translated_text": "test", "alignment": "center"}],
                preserve_style=True,
                auto_resize=True,
            )
            print(f"Result: {result}")
        except Exception as e:
            print(f"ERROR: {e}")
            traceback.print_exc()
    await engine.dispose()

asyncio.run(main())
