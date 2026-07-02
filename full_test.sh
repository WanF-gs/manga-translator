#!/bin/bash
LOGIN=$(curl -s -X POST http://localhost:8080/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"account":"testuser_4928@test.com","password":"Test123456"}')
TOKEN=$(echo "$LOGIN" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['tokens']['access_token'])")

# Test on the Conan page (1348x2048 - the one from the screenshot)
PAGE_ID="4c4bdc06-a1d4-459d-8b24-d34afeace602"
PGPASSWORD=manga_pass psql -h localhost -p 5433 -U manga_user -d manga_translator -c "DELETE FROM text_regions WHERE page_id='$PAGE_ID'" 2>/dev/null

echo "=== 1. Detect ==="
R1=$(curl -s -X POST "http://localhost:8080/api/v1/pages/$PAGE_ID/detect" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"detect_all":true,"language":"ja"}')
echo "$R1" | python3 -c "
import sys,json; d=json.load(sys.stdin).get('data',{})
r=d.get('regions',[])
print(f'  {len(r)} regions')
" 2>/dev/null

echo "=== 2. OCR ==="
R2=$(curl -s -X POST "http://localhost:8080/api/v1/pages/$PAGE_ID/ocr" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"language":"ja"}')
echo "$R2" | python3 -c "
import sys,json; d=json.load(sys.stdin).get('data',{})
r=d.get('results',[])
t=sum(1 for x in r if (x.get('text') or '').strip())
print(f'  {t}/{len(r)} with text')
for i,x in enumerate(r[:5]):
    txt=x.get('text','')
    if txt.strip(): print(f'    [{i}] \"{txt[:30]}\" conf={x.get(\"confidence\",0):.2f}')
" 2>/dev/null

echo "=== 3. Translate ==="
R3=$(curl -s -X POST "http://localhost:8080/api/v1/pages/$PAGE_ID/translate" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"target_lang":"zh-CN"}')
echo "$R3" | python3 -c "
import sys,json; d=json.load(sys.stdin).get('data',{})
r=d.get('regions',[])
t=sum(1 for x in r if (x.get('translated_text') or '').strip())
print(f'  {t}/{len(r)} translated')
" 2>/dev/null

echo "=== 4. Inpaint ==="
R4=$(curl -s -X POST "http://localhost:8080/api/v1/pages/$PAGE_ID/inpaint" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"method":"lama"}')
echo "$R4" | python3 -c "
import sys,json; d=json.load(sys.stdin).get('data',{})
print(f'  status={d.get(\"status\",\"?\")}, url={str(d.get(\"result_url\",\"?\"))[:60]}')
" 2>/dev/null

echo "=== 5. Render ==="
R5=$(curl -s -X POST "http://localhost:8080/api/v1/pages/$PAGE_ID/render" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"regions":[],"preserve_style":true,"auto_resize":true}')
echo "$R5" | python3 -c "
import sys,json; d=json.load(sys.stdin).get('data',{})
print(f'  status={d.get(\"status\",\"?\")}, rendered={d.get(\"regions_rendered\",0)}')
" 2>/dev/null

echo "=== 6. Export ==="
R6=$(curl -s -X POST "http://localhost:8080/api/v1/pages/$PAGE_ID/export" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"format":"png","quality":90}')
echo "$R6" | python3 -c "
import sys,json; d=json.load(sys.stdin)
print(f'  status={d.get(\"status\",\"?\")}, file={d.get(\"file_size\",\"?\")}')
" 2>/dev/null

echo ""
echo "=== Errors ==="
grep -i "error\|500\|failed" /tmp/mt-svc-ai.log /tmp/mt-svc-img.log 2>/dev/null | tail -3
