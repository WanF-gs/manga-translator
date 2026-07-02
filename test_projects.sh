#!/bin/bash
TOKEN=$(curl -s -X POST http://localhost:8080/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"account":"testuser_4928@test.com","password":"Test123456"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['tokens']['access_token'])")

echo "=== Projects ==="
curl -s "http://localhost:8080/api/v1/projects" -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys,json; d=json.load(sys.stdin)
print(f'code={d.get(\"code\")}')
items=d.get('data',{}).get('items',[])
print(f'projects: {len(items)}')
for p in items[:3]:
    print(f'  {p.get(\"name\",\"?\")} ({p.get(\"page_count\",0)} pages)')
" 2>/dev/null
