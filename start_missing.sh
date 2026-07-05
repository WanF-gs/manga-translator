#!/bin/bash
cd /mnt/c/Users/WanFi/Desktop/大三实训/demo_04/manga-translator-backend/services

export DATABASE_URL="postgresql+asyncpg://manga_user:manga_pass@localhost:5433/manga_translator"
export REDIS_URL="redis://localhost:6379/0"
export JWT_SECRET_KEY="your-super-secret-jwt-key-change-in-production"
export AI_SERVICE_BASE_URL="http://localhost:8100"
export MINIO_ENDPOINT="localhost:9000"
export MINIO_ACCESS_KEY="minioadmin"
export MINIO_SECRET_KEY="minioadmin"
export MINIO_BUCKET="manga-translator"
export STORAGE_BASE_URL="http://localhost:8002"
export FONT_DIR="/mnt/c/Users/WanFi/Desktop/大三实训/demo_04/manga-translator-backend/fonts"
export UPLOAD_DIR="/mnt/c/Users/WanFi/Desktop/大三实训/demo_04/data/uploads"
export PADDLEOCR_ENABLED="true"
export HF_ENDPOINT="https://hf-mirror.com"
export AI_GATEWAY_PORT=8100

# Start missing services
for svc_port in "image-service:8004:image_service.main:app" "export-service:8005:export_service.main:app" "ai-gateway:8100:ai_gateway.main:app"; do
  IFS=: read name port module <<< "$svc_port"
  if ! ss -tlnp 2>/dev/null | grep -q ":$port "; then
    echo "Starting $name on port $port..."
    nohup python3 -m uvicorn "$module" --host 0.0.0.0 --port "$port" --log-level info > /tmp/mt-svc-$name.log 2>&1 &
  else
    echo "$name already running on port $port"
  fi
done

# Start Go gateway
if ! ss -tlnp 2>/dev/null | grep -q ":8080 "; then
  echo "Starting Go gateway..."
  export SERVER_PORT=8080
  export GIN_MODE=release
  export CORS_ORIGINS="http://localhost:3000,http://localhost:3001"
  export USER_SERVICE_URL="http://127.0.0.1:8001"
  export PROJECT_SERVICE_URL="http://127.0.0.1:8002"
  export TRANSLATION_SERVICE_URL="http://127.0.0.1:8003"
  export IMAGE_SERVICE_URL="http://127.0.0.1:8004"
  export EXPORT_SERVICE_URL="http://127.0.0.1:8005"
  export READER_SERVICE_URL="http://127.0.0.1:8006"
  export NOTIFICATION_SERVICE_URL="http://127.0.0.1:8007"
  export AI_GATEWAY_URL="http://127.0.0.1:8100"
  /mnt/c/Users/WanFi/Desktop/大三实训/demo_04/manga-translator-backend/gateway/gateway_linux &>/tmp/mt-svc-gateway.log &
fi

echo "Waiting for services..."
sleep 15
ss -tlnp 2>/dev/null | grep -E '800[0-9]|8080|8100|3000'
