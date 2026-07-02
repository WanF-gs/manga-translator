#!/bin/bash
echo "=== Test login ==="
curl -s -X POST http://localhost:8080/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"account":"testuser_7293@test.com","password":"Test@1234"}' \
  | python3 -m json.tool 2>/dev/null || echo "JSON parse failed"

echo ""
echo "=== Test register ==="
curl -s -X POST http://localhost:8080/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test2@test.com","password":"Test@1234","nickname":"test2"}' \
  | python3 -m json.tool 2>/dev/null

echo ""
echo "=== Test with token ==="
TOKEN=$(curl -s -X POST http://localhost:8080/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"account":"testuser_7293@test.com","password":"Test@1234"}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('tokens',{}).get('access_token',''))" 2>/dev/null)
echo "Token: ${TOKEN:0:30}..."
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/v1/user/profile | python3 -m json.tool 2>/dev/null
