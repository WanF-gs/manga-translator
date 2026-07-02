#!/bin/bash
# ============================================
# Celery Worker 启动脚本（管线任务消费端）
# 没有它，OCR/翻译/擦除/渲染全部阻塞
# ============================================
SERVICES="/mnt/c/Users/WanFi/Desktop/大三实训/demo_04/manga-translator-backend/services"

export DATABASE_URL="postgresql+asyncpg://manga_user:manga_pass@localhost:5433/manga_translator"
export REDIS_URL="redis://localhost:6379/0"
export CELERY_BROKER_URL="redis://localhost:6379/1"
export CELERY_RESULT_BACKEND="redis://localhost:6379/2"
export JWT_SECRET_KEY="your-super-secret-jwt-key-change-in-production"
export MINIO_ENDPOINT="localhost:9000"
export MINIO_ACCESS_KEY="minioadmin"
export MINIO_SECRET_KEY="minioadmin"
export MINIO_BUCKET="manga-translator"
export AI_SERVICE_BASE_URL="http://localhost:8100"
export PYTHONPATH="$SERVICES:/home/wanf/.local/lib/python3.8/site-packages"
export PATH="$HOME/.local/bin:$PATH"
export PADDLEOCR_ENABLED="true"
export OCR_ENGINE_ORDER="mangaocr,paddleocr"
export OCR_CONFIDENCE_RETRY_THRESHOLD="0.65"

cd "$SERVICES"

# 杀旧 worker
fuser -k 0/tcp 2>/dev/null  # no-op, just ensure clean
pkill -f "celery.*worker" 2>/dev/null
sleep 1

echo "Starting Celery Worker..."
nohup celery -A common.tasks.celery_app worker --loglevel=info --concurrency=2 \
    > /tmp/celery-worker.log 2>&1 &
CELERY_PID=$!
echo $CELERY_PID > /tmp/mt-pid-celery.txt
disown $CELERY_PID 2>/dev/null

sleep 3
if kill -0 "$CELERY_PID" 2>/dev/null; then
    echo "Celery Worker started (PID $CELERY_PID)"
    tail -5 /tmp/celery-worker.log
else
    echo "FAILED - check /tmp/celery-worker.log"
    tail -10 /tmp/celery-worker.log
fi
