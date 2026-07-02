#!/bin/bash
LOGIN_RESP=$(curl -s -X POST http://localhost:8080/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"account":"testuser_4928@test.com","password":"Test123456"}')
TOKEN=$(echo "$LOGIN_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['tokens']['access_token'])")
PAGE_ID="4c4bdc06-a1d4-459d-8b24-d34afeace602"

echo "=== Detect ==="
curl -s --max-time 60 -X POST "http://localhost:8080/api/v1/pages/$PAGE_ID/detect" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"detect_all":true,"language":"ja"}'

echo ""
echo "=== OCR ==="
curl -s --max-time 60 -X POST "http://localhost:8080/api/v1/pages/$PAGE_ID/ocr" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"language":"ja"}'

echo ""
echo "=== Translate ==="
curl -s --max-time 60 -X POST "http://localhost:8080/api/v1/pages/$PAGE_ID/translate" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"target_lang":"zh-CN"}'
