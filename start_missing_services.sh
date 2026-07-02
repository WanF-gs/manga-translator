#!/bin/bash
# 启动缺失的后端服务

PROJECT="/mnt/c/Users/WanFi/Desktop/大三实训/demo_04/manga-translator-backend/services"

export DATABASE_URL="postgresql+asyncpg://manga_user:manga_pass@localhost:5433/manga_translator"
export REDIS_URL="redis://localhost:6379/0"
export JWT_SECRET_KEY="your-super-secret-jwt-key-change-in-production"
export MINIO_ENDPOINT="localhost:9000"
export MINIO_ACCESS_KEY="minioadmin"
export MINIO_SECRET_KEY="minioadmin"
export MINIO_BUCKET="manga-translator"

cd "$PROJECT"

echo "Starting user-service on 8001..."
python3 -m uvicorn user_service.main:app --host 0.0.0.0 --port 8001 &

echo "Starting project-service on 8002..."
python3 -m uvicorn project_service.main:app --host 0.0.0.0 --port 8002 &

echo "Starting ai-gateway on 8100..."
python3 -m uvicorn ai_gateway.main:app --host 0.0.0.0 --port 8100 &

echo "All services started"
wait
