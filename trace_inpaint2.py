import httpx, os, sys, traceback

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "manga-translator-backend", "services"))
os.environ["DATABASE_URL"] = "postgresql+asyncpg://manga_user:manga_pass@localhost:5433/manga_translator"
os.environ["AI_SERVICE_BASE_URL"] = "http://localhost:8100"
os.environ["JWT_SECRET_KEY"] = "your-super-secret-jwt-key-change-in-production"
os.environ["MINIO_ENDPOINT"] = "localhost:9000"
os.environ["MINIO_ACCESS_KEY"] = "minioadmin"
os.environ["MINIO_SECRET_KEY"] = "minioadmin"
os.environ["MINIO_BUCKET"] = "manga-translator"

from common.core.config import settings
from sqlalchemy.ext.asyncio import create_async_engine

async def main():
    engine = create_async_engine(settings.DATABASE_URL)
    async with engine.connect() as conn:
        async with conn.begin():
            from sqlalchemy.orm import Session
            from common.models.page import Page
            from sqlalchemy import select
            result = await conn.execute(select(Page).where(Page.page_id == "d5c45b98-c9f5-4aed-824b-2f61579117d0"))
            page = result.scalar_one_or_none()
            print(f"Page found: {page is not None}")
            if page:
                print(f"  original_url: {page.original_url}")
                print(f"  processed_url: {page.processed_url}")

    from image_service.service.inpaint_service import InpaintService
    async with engine.connect() as conn:
        async with conn.begin() as transaction:
            from sqlalchemy.ext.asyncio import AsyncSession
            session = AsyncSession(bind=conn, expire_on_commit=False)
            svc = InpaintService(session)
            try:
                result = await svc.inpaint(
                    page_id="d5c45b98-c9f5-4aed-824b-2f61579117d0",
                    user_id="test",
                    region_ids=[],
                    method="telea",
                    background_preserve=True,
                )
                print(f"Result: {result}")
            except Exception as e:
                print(f"ERROR: {e}")
                traceback.print_exc()
    await engine.dispose()

import asyncio
asyncio.run(main())
