#!/bin/bash
GATEWAY_DIR="/mnt/c/Users/WanFi/Desktop/大三实训/demo_04/manga-translator-backend/gateway"
export SERVER_PORT=8080
export GIN_MODE=release
export USER_SERVICE_URL="http://127.0.0.1:8001"
export PROJECT_SERVICE_URL="http://127.0.0.1:8002"
export TRANSLATION_SERVICE_URL="http://127.0.0.1:8003"
export IMAGE_SERVICE_URL="http://127.0.0.1:8004"
export EXPORT_SERVICE_URL="http://127.0.0.1:8005"
export READER_SERVICE_URL="http://127.0.0.1:8006"
export NOTIFICATION_SERVICE_URL="http://127.0.0.1:8007"
export AI_GATEWAY_URL="http://127.0.0.1:8100"
export RATE_LIMIT_ENABLED=true

echo "Starting Go Gateway..."
setsid "$GATEWAY_DIR/gateway_linux" &>/tmp/mt-svc-gateway.log &
GW_PID=$!
sleep 2
echo "PID=$GW_PID"
curl -s -o /dev/null -w "Health: %{http_code}\n" http://localhost:8080/health
