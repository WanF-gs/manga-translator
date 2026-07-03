#!/bin/bash
# 本地开发启动脚本
# 用法: bash start.sh

set -e

cd "$(dirname "$0")"

echo "[gateway] Loading .env..."
set -a
source .env
set +a

echo "[gateway] Killing old instance..."
pkill -f gateway_linux 2>/dev/null || true

echo "[gateway] Starting on port 8080..."
nohup ./gateway_linux > /tmp/mt-svc-gateway.log 2>&1 &

sleep 2
echo "[gateway] Checking health..."
curl -s http://localhost:8080/health
echo ""
echo "[gateway] Started. PID=$(pgrep -f gateway_linux)"
