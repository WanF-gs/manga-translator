#!/bin/bash
set -e
cd /mnt/c/Users/WanFi/Desktop/大三实训/demo_04/manga-translator-backend/services
export FONT_DIR=/mnt/c/Users/WanFi/Desktop/大三实训/demo_04/manga-translator-backend/fonts
export PADDLEOCR_ENABLED=true
export OCR_ENGINE_ORDER='mangaocr,paddleocr'
export OCR_CONFIDENCE_RETRY_THRESHOLD=0.65
export CTD_MASK_THRESH=0.10
export HF_ENDPOINT='https://hf-mirror.com'
export PYTHONPATH="$HOME/.local/lib/python3.10/site-packages:$PYTHONPATH"
export AI_GATEWAY_PORT=8100
fuser -k 8100/tcp 2>/dev/null || true
sleep 1.5
setsid python3 -m uvicorn ai_gateway.main:app --host 0.0.0.0 --port 8100 --log-level info >/tmp/mt-svc-ai-gateway.log 2>&1 &
echo $! > /tmp/mt-pid-ai-gateway.txt
echo "Started PID: $(cat /tmp/mt-pid-ai-gateway.txt)"
sleep 4
curl -s -o /dev/null -w 'health: %{http_code}\n' http://localhost:8100/health
