#!/bin/bash
LOGIN_RESP=$(curl -s -X POST http://localhost:8080/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"account":"testuser_4928@test.com","password":"Test123456"}')
TOKEN=$(echo "$LOGIN_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['tokens']['access_token'])")
echo "Token: ${TOKEN:0:20}..."

PAGE_ID="4c4bdc06-a1d4-459d-8b24-d34afeace602"

echo ""
echo "=== 1. Detect ==="
curl -s -X POST "http://localhost:8080/api/v1/pages/$PAGE_ID/detect" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"detect_all":true,"language":"ja"}' | python3 -c "
import sys,json; d=json.load(sys.stdin).get('data',{})
print(f'  regions: {len(d.get(\"regions\",[]))}')
" 2>/dev/null

echo "=== 2. OCR ==="
curl -s -X POST "http://localhost:8080/api/v1/pages/$PAGE_ID/ocr" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"language":"ja"}' | python3 -c "
import sys,json; d=json.load(sys.stdin).get('data',{})
r=d.get('results',[])
t=sum(1 for x in r if (x.get('text') or '').strip())
print(f'  {t}/{len(r)} with text')
for i,x in enumerate(r[:3]):
  if (x.get('text') or '').strip(): print(f'    \"{x[\"text\"][:30]}\" conf={x.get(\"confidence\",0):.2f}')
" 2>/dev/null

echo "=== 3. Translate ==="
curl -s -X POST "http://localhost:8080/api/v1/pages/$PAGE_ID/translate" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"target_lang":"zh-CN"}' | python3 -c "
import sys,json; d=json.load(sys.stdin).get('data',{})
r=d.get('regions',[])
t=sum(1 for x in r if (x.get('translated_text') or '').strip())
print(f'  {t}/{len(r)} translated')
" 2>/dev/null

echo "=== 4. Inpaint ==="
curl -s -X POST "http://localhost:8080/api/v1/pages/$PAGE_ID/inpaint" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"method":"lama"}' | python3 -c "
import sys,json; d=json.load(sys.stdin).get('data',{})
print(f'  status={d.get(\"status\",\"?\")}')
" 2>/dev/null

echo "=== 5. Render ==="
curl -s -X POST "http://localhost:8080/api/v1/pages/$PAGE_ID/render" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"regions":[],"preserve_style":true,"auto_resize":true}' | python3 -c "
import sys,json; d=json.load(sys.stdin).get('data',{})
print(f'  status={d.get(\"status\",\"?\")}, rendered={d.get(\"regions_rendered\",0)}')
" 2>/dev/null

echo "=== 6. Export ==="
curl -s -X POST "http://localhost:8080/api/v1/pages/$PAGE_ID/export" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"format":"png","quality":90}' | python3 -c "
import sys,json; d=json.load(sys.stdin)
print(f'  status={d.get(\"status\",\"?\")}, file={d.get(\"file_size\",\"?\")}')
" 2>/dev/null
