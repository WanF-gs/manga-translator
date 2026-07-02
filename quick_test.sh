#!/bin/bash
LOGIN=$(curl -s -X POST http://localhost:8080/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"account":"testuser_4928@test.com","password":"Test123456"}')
echo "Login: $LOGIN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'  code={d.get(\"code\")}, token={str(d.get(\"data\",{}).get(\"tokens\",{}).get(\"access_token\",\"\"))[:20]}...')" 2>/dev/null

TOKEN=$(echo "$LOGIN" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['tokens']['access_token'])")
PAGE_ID="4c4bdc06-a1d4-459d-8b24-d34afeace602"

echo ""
echo "=== Detect ==="
curl -s -X POST "http://localhost:8080/api/v1/pages/$PAGE_ID/detect" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"detect_all":true,"language":"ja"}' | python3 -c "
import sys,json
raw=sys.stdin.read()
try:
  d=json.loads(raw).get('data',{})
  print(f'  regions: {len(d.get(\"regions\",[]))}')
except:
  print(f'  raw: {raw[:200]}')
" 2>/dev/null
