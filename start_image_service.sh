#!/bin/bash
cd /mnt/c/Users/WanFi/Desktop/大三实训/demo_04/manga-translator-backend/services
export DATABASE_URL="postgresql+asyncpg://manga_user:manga_pass@localhost:5433/manga_translator"
export REDIS_URL="redis://localhost:6379/0"
export JWT_SECRET_KEY="your-super-secret-jwt-key-change-in-production"
export MINIO_ENDPOINT="localhost:9000"
export MINIO_ACCESS_KEY="minioadmin"
export MINIO_SECRET_KEY="minioadmin"
export MINIO_BUCKET="manga-translator"
export AI_SERVICE_BASE_URL="http://localhost:8100"
export TESSERACT_CMD="tesseract"
export TESSERACT_LANG="jpn+chi_sim+eng"

# P0: PaddleOCR v4 引擎配置（本地回退OCR）
export PADDLEOCR_ENABLED='true'
export OCR_ENGINE_ORDER='mangaocr,paddleocr'
export OCR_CONFIDENCE_RETRY_THRESHOLD='0.65'
export PADDLEOCR_MODEL_DIR='/mnt/c/Users/WanFi/Desktop/大三实训/demo_04/manga-translator-backend/models/ppocr_v4'

# P0: 强制离线模式
export HF_ENDPOINT="https://hf-mirror.com"

# P0: 图片存储基础 URL（检测/OCR 回退时使用）
export STORAGE_BASE_URL="http://localhost:8002"

setsid python3 -m uvicorn image_service.main:app --host 0.0.0.0 --port 8004 > /tmp/image_service.log 2>&1 &
sleep 5
ss -tlnp | grep 8004
echo "Image service restarted"
