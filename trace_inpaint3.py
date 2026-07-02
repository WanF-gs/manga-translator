import os, sys, httpx
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "manga-translator-backend", "services"))
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://manga_user:manga_pass@localhost:5433/manga_translator")
os.environ.setdefault("AI_SERVICE_BASE_URL", "http://localhost:8100")
os.environ.setdefault("JWT_SECRET_KEY", "your-super-secret-jwt-key-change-in-production")
os.environ.setdefault("MINIO_ENDPOINT", "localhost:9000")
os.environ.setdefault("MINIO_ACCESS_KEY", "minioadmin")
os.environ.setdefault("MINIO_SECRET_KEY", "minioadmin")
os.environ.setdefault("MINIO_BUCKET", "manga-translator")

import asyncio

async def test():
    # Step 1: Test AI gateway inpaint directly
    print("Step 1: AI Gateway inpaint direct test")
    from image_service.service.inpaint_service import _ai_inpaint
    storage_url = "http://localhost:8002/storage/57ed9697-ced9-491f-957a-1477ace2da21/originals/73bdd57c05c44529bf620c946054c154.jpg"
    masks = [{"region_id": "test", "bbox": [100, 100, 200, 100], "boundary": {"x": 100, "y": 100, "width": 200, "height": 100}}]
    try:
        result_url = await _ai_inpaint(storage_url, masks, "telea", "test-page", "test-task", "text_erase")
        print(f"  Result URL: {result_url}")
    except Exception as e:
        import traceback
        print(f"  ERROR: {e}")
        traceback.print_exc()

    # Step 2: Test local file reading
    print("\nStep 2: Test local file reading")
    from image_service.service.inpaint_service import _url_to_local_path
    local = _url_to_local_path("/storage/57ed9697-ced9-491f-957a-1477ace2da21/originals/73bdd57c05c44529bf620c946054c154.jpg")
    print(f"  Local path: {local}")
    if local:
        print(f"  Exists: {os.path.isfile(local)}")

    # Step 3: Test local OpenCV inpaint
    print("\nStep 3: Test local OpenCV inpaint")
    from image_service.service.inpaint_service import _cv_inpaint_legacy
    if local:
        with open(local, "rb") as f:
            img_data = f.read()
        region_data = [{"region_id": "test", "bbox": [100, 100, 200, 100], "boundary": {"x": 100, "y": 100, "width": 200, "height": 100}}]
        try:
            result = await _cv_inpaint_legacy(img_data, region_data, "telea", "text_erase")
            print(f"  Result: {len(result) if result else None} bytes")
        except Exception as e:
            import traceback
            print(f"  ERROR: {e}")
            traceback.print_exc()

    # Step 4: Test save result file
    print("\nStep 4: Test _save_result_file")
    from image_service.service.inpaint_service import _save_result_file
    try:
        saved_url = _save_result_file(b"fake-data-for-test", "test-page", "test-task", "inpainted")
        print(f"  Saved URL: {saved_url}")
    except Exception as e:
        import traceback
        print(f"  ERROR: {e}")
        traceback.print_exc()

asyncio.run(test())
