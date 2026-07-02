#!/bin/bash
export DATABASE_URL='postgresql+asyncpg://manga_user:manga_pass@localhost:5433/manga_translator'
export REDIS_URL='redis://localhost:6379/0'
export AI_SERVICE_BASE_URL='http://localhost:8100'
export MINIO_ENDPOINT='localhost:9000'
export MINIO_ACCESS_KEY='minioadmin'
export MINIO_SECRET_KEY='minioadmin'
export MINIO_BUCKET='manga-translator'
export FONT_DIR='fonts'
export PYTHONPATH='/mnt/c/Users/WanFi/Desktop/大三实训/demo_04/manga-translator-backend/services'

cd /mnt/c/Users/WanFi/Desktop/大三实训/demo_04/manga-translator-backend/services
nohup python3 -m uvicorn image_service.main:app --host 0.0.0.0 --port 8004 --log-level info > /tmp/image-service.log 2>&1 &
echo "Image service PID: $!"
