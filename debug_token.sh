#!/bin/bash
echo "=== Raw login response ==="
curl -s -X POST http://localhost:8080/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"account":"testuser_4928@test.com","password":"Test123456"}'

echo ""
echo "=== Extract token ==="
TOKEN=$(curl -s -X POST http://localhost:8080/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"account":"testuser_4928@test.com","password":"Test123456"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['tokens']['access_token'])")
echo "Token length: ${#TOKEN}"
echo "Token first 50: ${TOKEN:0:50}"

echo ""
echo "=== Test with token ==="
curl -s --max-time 10 "http://localhost:8080/api/v1/projects" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'code={d.get(\"code\")}, projects={len(d.get(\"data\",{}).get(\"items\",[]))}')" 2>/dev/null
