#!/bin/bash
echo "=== AI Gateway health ==="
curl -s http://localhost:8100/health | python3 -m json.tool 2>/dev/null

echo ""
echo "=== Direct detect test ==="
curl -s --max-time 60 -X POST http://localhost:8100/detector/detect \
  -H 'Content-Type: application/json' \
  -d '{"image_url":"http://localhost:8002/api/v1/pages/4c4bdc06-a1d4-459d-8b24-d34afeace602/image"}' | python3 -c "
import sys,json; d=json.load(sys.stdin)
print(f'  regions: {len(d.get(\"regions\",[]))}')
for i,r in enumerate(d.get('regions',[])[:3]):
    b=r.get('bbox',[0,0,0,0])
    print(f'  [{i}] type={r.get(\"type\")}, bbox={b}, conf={r.get(\"confidence\",0):.2f}')
" 2>/dev/null
