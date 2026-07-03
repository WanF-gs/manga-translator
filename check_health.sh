#!/bin/bash
echo "=== Service Health ==="
for port in 8001 8002 8003 8004 8005 8006 8007 8080 8100 3000; do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:${port}/health 2>/dev/null)
  fcode=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:${port} 2>/dev/null)
  status="$code"
  [ "$code" = "000" ] && [ "$fcode" != "000" ] && status="$fcode"
  echo "  :${port} -> ${status}"
done

echo ""
echo "=== Latest pipeline activity ==="
echo "--- image-service ---"
grep -E 'Detect|OCR|render|total regions|SSIM|warning|error' /tmp/mt-svc-image-service.log | tail -10
echo ""
echo "--- ai-gateway ---" 
grep -E 'detect|ocr|inpaint|region|translat|error|completed' /tmp/mt-svc-ai-gateway.log | tail -10
echo ""
echo "--- translation-service ---"
grep -E 'PBP|translat|error|400|200' /tmp/mt-svc-translation-service.log | tail -10
