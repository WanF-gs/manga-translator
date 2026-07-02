#!/bin/bash
PROJECT="/mnt/c/Users/WanFi/Desktop/大三实训/demo_04"
SERVICES="$PROJECT/manga-translator-backend/services"

export DATABASE_URL="postgresql+asyncpg://manga_user:manga_pass@localhost:5433/manga_translator"
export REDIS_URL="redis://localhost:6379/0"
export JWT_SECRET_KEY="your-super-secret-jwt-key-change-in-production"
export LOG_LEVEL="INFO"
export PADDLEOCR_ENABLED="true"
export OCR_ENGINE_ORDER="mangaocr,paddleocr"
export FONT_DIR="$PROJECT/manga-translator-backend/fonts"
export AI_SERVICE_BASE_URL="http://localhost:8100"
export HF_ENDPOINT="https://hf-mirror.com"
export PYTHONPATH="$HOME/.local/lib/python3.10/site-packages:$PYTHONPATH"
export PATH="$HOME/.local/bin:$PATH"
export TENCENT_SECRET_ID="${TENCENT_SECRET_ID:-YOUR_TENCENT_SECRET_ID}"
export TENCENT_SECRET_KEY="${TENCENT_SECRET_KEY:-YOUR_TENCENT_SECRET_KEY}"
export TENCENT_TMT_REGION="ap-guangzhou"
export OPENAI_API_KEY="sk-6eb834fc005c49059e8a5f85da9a9471"
export OPENAI_API_BASE="https://api.deepseek.com/v1"
export OPENAI_MODEL="deepseek-chat"

cd "$SERVICES"
mkdir -p /tmp/fonts /tmp/manga-uploads

echo "=== Restarting core services ==="

# Kill old processes on these ports (SIGKILL, cannot be ignored)
for port in 8100 8003 8004; do
    old_pid=$(fuser ${port}/tcp 2>/dev/null | awk '{print $1}')
    if [ -n "$old_pid" ]; then
        kill -9 $old_pid 2>/dev/null
        echo "Killed PID $old_pid on port $port"
    fi
done
sleep 2

echo "ai-gateway (8100)..."
setsid python3 -m uvicorn ai_gateway.main:app --host 0.0.0.0 --port 8100 --log-level info --limit-max-requests 100 \
    &>/tmp/mt-svc-ai-gateway-new.log &
echo "PID $!"

echo "translation-service (8003)..."
setsid python3 -m uvicorn translation_service.main:app --host 0.0.0.0 --port 8003 --log-level info --limit-max-requests 200 \
    &>/tmp/mt-svc-translation-service-new.log &
echo "PID $!"

echo "image-service (8004)..."
setsid python3 -m uvicorn image_service.main:app --host 0.0.0.0 --port 8004 --log-level info --limit-max-requests 200 \
    &>/tmp/mt-svc-image-service-new.log &
echo "PID $!"

sleep 5
echo ""
echo "=== Health check ==="
curl -s -o /dev/null -w "ai-gw(8100): %{http_code} | " http://localhost:8100/health
curl -s -o /dev/null -w "trans(8003): %{http_code} | " http://localhost:8003/docs
curl -s -o /dev/null -w "img(8004): %{http_code}" http://localhost:8004/docs
echo ""
echo ""
echo "=== CTD model check ==="
grep -m1 "CTD\|ctd_detector" /tmp/mt-svc-ai-gateway-new.log 2>/dev/null || echo "(CTD log not yet written, may appear on first detection request)"
echo ""
echo "=== LaMa model check ==="
grep -m1 "LaMa\|lama_inpainter" /tmp/mt-svc-ai-gateway-new.log 2>/dev/null || echo "(LaMa loaded lazily on first inpainting request)"
