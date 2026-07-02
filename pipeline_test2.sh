#!/bin/bash
LOGIN_RESP=$(curl -s -X POST http://localhost:8080/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"account":"testuser_4928@test.com","password":"Test123456"}')
TOKEN=$(echo "$LOGIN_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['tokens']['access_token'])")

PAGE_ID="4c4bdc06-a1d4-459d-8b24-d34afeace602"

echo "=== Detect ==="
R=$(curl -s --max-time 60 -X POST "http://localhost:8080/api/v1/pages/$PAGE_ID/detect" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"detect_all":true,"language":"ja"}')
echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'  code={d.get(\"code\")}, regions={len(d.get(\"data\",{}).get(\"regions\",[]))}')" 2>/dev/null

echo "=== OCR ==="
R=$(curl -s --max-time 60 -X POST "http://localhost:8080/api/v1/pages/$PAGE_ID/ocr" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"language":"ja"}')
echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin); r=d.get('data',{}).get('results',[]); t=sum(1 for x in r if (x.get('text') or '').strip()); print(f'  {t}/{len(r)} with text')" 2>/dev/null

echo "=== Translate ==="
R=$(curl -s --max-time 60 -X POST "http://localhost:8080/api/v1/pages/$PAGE_ID/translate" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"target_lang":"zh-CN"}')
echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin); r=d.get('data',{}).get('regions',[]); t=sum(1 for x in r if (x.get('translated_text') or '').strip()); print(f'  {t}/{len(r)} translated')" 2>/dev/null

echo "=== Inpaint ==="
R=$(curl -s --max-time 120 -X POST "http://localhost:8080/api/v1/pages/$PAGE_ID/inpaint" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"method":"lama"}')
echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'  status={d.get(\"data\",{}).get(\"status\",\"?\")}')" 2>/dev/null

echo "=== Render ==="
R=$(curl -s --max-time 120 -X POST "http://localhost:8080/api/v1/pages/$PAGE_ID/render" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"regions":[],"preserve_style":true,"auto_resize":true}')
echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'  status={d.get(\"data\",{}).get(\"status\",\"?\")}, rendered={d.get(\"data\",{}).get(\"regions_rendered\",0)}')" 2>/dev/null

echo "=== Export ==="
R=$(curl -s --max-time 60 -X POST "http://localhost:8080/api/v1/pages/$PAGE_ID/export" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"format":"png","quality":90}')
echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'  status={d.get(\"status\",\"?\")}, file={d.get(\"file_size\",\"?\")}')" 2>/dev/null
