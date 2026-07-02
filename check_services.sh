#!/bin/bash
echo "=== PostgreSQL ===" 
pg_isready -q && echo "RUNNING" || echo "NOT RUNNING"

echo "=== Redis ==="
redis-cli ping 2>/dev/null && echo "RUNNING" || echo "NOT RUNNING"

echo "=== MinIO ==="
curl -s http://localhost:9000/minio/health/live 2>/dev/null && echo "RUNNING" || echo "NOT RUNNING"

echo "=== Python Microservices ==="
for port in 8001 8002 8003 8004 8005 8006 8007 8100; do
    code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:${port}/health 2>/dev/null)
    echo "  :${port} -> ${code}"
done

echo "=== Go API Gateway ==="
code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/health 2>/dev/null)
echo "  :8080 -> ${code}"

echo "=== Frontend ==="
code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 2>/dev/null)
echo "  :3000 -> ${code}"

echo ""
echo "=== Font File Serving (public, no auth) ==="
curl -s -o /dev/null -w "HTTP Status: %{http_code}, Size: %{size_download} bytes, Content-Type: %{content_type}" \
  http://localhost:8080/api/v1/fonts/file/NotoSansSC-Regular.otf 2>/dev/null
echo ""

echo "=== Gateway Health ==="
curl -s http://localhost:8080/health
echo ""

echo "=== Gateway: Public Invite Check ==="
curl -s -w "\nHTTP:%{http_code}" http://localhost:8080/api/v1/invites/nonexistent 2>/dev/null | head -2
echo ""
