#!/bin/bash
for port in 8001 8002 8003 8004 8005 8006 8007 8080 8100; do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:${port}/health 2>/dev/null)
  echo "port ${port}: ${code}"
done
echo "=== Gateway proxy tests ==="
curl -s -o /dev/null -w "notifications    : %{http_code}\n" http://localhost:8080/api/v1/notifications 2>/dev/null
curl -s -o /dev/null -w "notifications/unread: %{http_code}\n" http://localhost:8080/api/v1/notifications/unread-count 2>/dev/null
curl -s -o /dev/null -w "storage test     : %{http_code}\n" "http://localhost:8080/storage/test.jpg" 2>/dev/null
curl -s -o /dev/null -w "pages test       : %{http_code}\n" http://localhost:8080/api/v1/pages 2>/dev/null
echo "=== user-service auth routes ==="
curl -s -o /dev/null -w "auth/login POST  : %{http_code}\n" -X POST http://localhost:8080/api/v1/auth/login -H "Content-Type: application/json" -d '{"account":"test","password":"test"}' 2>/dev/null
