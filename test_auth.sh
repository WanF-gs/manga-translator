#!/bin/bash
TOKEN=$(curl -s -X POST http://localhost:8080/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"account":"testuser_4928@test.com","password":"Test123456"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['tokens']['access_token'])")

echo "Token: $TOKEN"
echo ""

echo "=== Test with explicit header ==="
curl -v -s "http://localhost:8080/api/v1/projects" \
  -H "Authorization: Bearer $TOKEN" 2>&1 | grep -E "< HTTP|code|message|items"
