import httpx, sys, os, asyncio, traceback

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "manga-translator-backend", "services"))

r = httpx.post("http://127.0.0.1:8080/api/v1/auth/login", json={"email": "wsl2test@test.com", "password": "test1234"}, timeout=5)
token = r.json()["data"]["tokens"]["access_token"]
h = {"Authorization": f"Bearer {token}"}

# Test inpaint directly via service logic
async def test_inpaint():
    from common.core.config import settings
    settings.DATABASE_URL = "postgresql+asyncpg://manga_user:manga_pass@localhost:5433/manga_translator"
    settings.JWT_SECRET_KEY = "your-super-secret-jwt-key-change-in-production"
    settings.MINIO_ENDPOINT = "localhost:9000"
    settings.MINIO_ACCESS_KEY = "minioadmin"
    settings.MINIO_SECRET_KEY = "minioadmin"

    from common.core.database import get_async_session
    from sqlalchemy.ext.asyncio import create_async_engine
    from common.models.base import Base

    engine = create_async_engine(settings.DATABASE_URL)
    async with engine.begin() as conn:
        async with conn.begin():
            async with conn.session() as db:
                from image_service.service.inpaint_service import InpaintService
                svc = InpaintService(db)
                try:
                    result = await svc.inpaint(
                        page_id="d5c45b98-c9f5-4aed-824b-2f61579117d0",
                        user_id="test-user",
                        region_ids=[],
                        method="telea",
                        background_preserve=True,
                    )
                    print(f"Result: {result}")
                except Exception as e:
                    print(f"Error: {e}")
                    traceback.print_exc()
    await engine.dispose()

asyncio.run(test_inpaint())
