#!/bin/bash
# Start Go gateway with correct service URLs and relaxed rate limits

cd /mnt/c/Users/WanFi/Desktop/大三实训/demo_04/manga-translator-backend/gateway

export SERVER_PORT=8080
export SERVER_READ_TIMEOUT=300s
export SERVER_WRITE_TIMEOUT=300s
export GIN_MODE=release
export APP_ENV=development
export CORS_ORIGINS="http://localhost:3000,http://localhost:3001,http://localhost:5173,http://127.0.0.1:3000"
export JWT_SECRET_KEY="your-super-secret-jwt-key-change-in-production"

# Service URLs - use 127.0.0.1 for WSL2
export USER_SERVICE_URL="http://127.0.0.1:8001"
export PROJECT_SERVICE_URL="http://127.0.0.1:8002"
export TRANSLATION_SERVICE_URL="http://127.0.0.1:8003"
export IMAGE_SERVICE_URL="http://127.0.0.1:8004"
export EXPORT_SERVICE_URL="http://127.0.0.1:8005"
export READER_SERVICE_URL="http://127.0.0.1:8006"
export NOTIFICATION_SERVICE_URL="http://127.0.0.1:8007"
export AI_GATEWAY_URL="http://127.0.0.1:8100"

# Rate limits - relaxed for development
export RATE_LIMIT_ENABLED=true
export RATE_LIMIT_USER_RPS=100
export RATE_LIMIT_USER_BURST=200
export RATE_LIMIT_IP_RPS=200
export RATE_LIMIT_IP_BURST=500

setsid ./gateway_linux > /tmp/gateway.log 2>&1 &
sleep 2
echo "Gateway started on port 8080"
ss -tlnp | grep 8080
