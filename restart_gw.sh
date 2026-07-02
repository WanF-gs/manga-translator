#!/bin/bash
export SERVER_PORT=8080
export GIN_MODE=release
export JWT_SECRET_KEY="your-super-secret-jwt-key-change-in-production"
export USER_SERVICE_URL="http://127.0.0.1:8001"
export PROJECT_SERVICE_URL="http://127.0.0.1:8002"
export TRANSLATION_SERVICE_URL="http://127.0.0.1:8003"
export IMAGE_SERVICE_URL="http://127.0.0.1:8004"
export EXPORT_SERVICE_URL="http://127.0.0.1:8005"
export READER_SERVICE_URL="http://127.0.0.1:8006"
export NOTIFICATION_SERVICE_URL="http://127.0.0.1:8007"
export AI_GATEWAY_URL="http://127.0.0.1:8100"
# Kill old gateway
fuser -k 8080/tcp 2>/dev/null
sleep 1
nohup /mnt/c/Users/WanFi/Desktop/大三实训/demo_04/manga-translator-backend/gateway/gateway_linux &>/tmp/gw.log &
sleep 3
ss -tlnp | grep 8080 && echo "Gateway OK" || echo "Gateway FAILED"
