"""Full pipeline test: Detect -> OCR -> Translate"""
import httpx, time, io
from PIL import Image, ImageDraw

# 1. Login
r = httpx.post('http://127.0.0.1:8080/api/v1/auth/login', json={'email': 'wsl2test@test.com', 'password': 'test1234'}, timeout=5)
token = r.json()['data']['tokens']['access_token']
h = {'Authorization': 'Bearer ' + token}
print('[1] Login OK')

# 2. Get page
chid = 'a8e61dec-0dbe-45d4-9490-a7c69f6a86db'
r = httpx.get('http://127.0.0.1:8080/api/v1/chapters/%s/pages' % chid, headers=h, timeout=5)
pages = r.json().get('data', {}).get('items', [])
page_id = pages[0]['page_id'] if pages else None
print('[2] Page:', page_id)

if not page_id:
    print('ERROR: No pages found')
    exit(1)

# 3. Detect text regions
print('[3] Detecting regions...')
t0 = time.time()
r = httpx.post('http://127.0.0.1:8080/api/v1/pages/%s/detect' % page_id, headers=h, json={'language': 'eng'}, timeout=60)
elapsed = time.time() - t0
print('    Status: %d (%.1fs)' % (r.status_code, elapsed))
if r.status_code == 200:
    data = r.json().get('data', {})
    regions = data.get('regions', [])
    print('    Detected %d regions' % len(regions))
else:
    print('    Error:', r.text[:200])

# 4. OCR
print('[4] Running OCR...')
t0 = time.time()
r = httpx.post('http://127.0.0.1:8080/api/v1/pages/%s/ocr' % page_id, headers=h, json={'language': 'eng'}, timeout=60)
elapsed = time.time() - t0
print('    Status: %d (%.1fs)' % (r.status_code, elapsed))
if r.status_code == 200:
    data = r.json().get('data', {})
    results = data.get('results', [])
    print('    OCR results: %d' % len(results))
    for rg in results[:3]:
        print('      [%s] %s' % (rg.get('region_id', '?')[:8], rg.get('text', '')[:30]))
else:
    print('    Error:', r.text[:200])

# 5. Translate
print('[5] Translating...')
t0 = time.time()
r = httpx.post('http://127.0.0.1:8080/api/v1/pages/%s/translate' % page_id, headers=h, json={'target_lang': 'zh-CN'}, timeout=120)
elapsed = time.time() - t0
print('    Status: %d (%.1fs)' % (r.status_code, elapsed))
if r.status_code == 200:
    data = r.json().get('data', {})
    regions = data.get('regions', [])
    print('    Translated %d regions' % len(regions))
    for rg in regions[:3]:
        print('      [%s] %s' % (rg.get('engine_used', '?'), rg.get('translated_text', '')[:30]))
else:
    print('    Error:', r.text[:200])

print()
print('=== Pipeline Complete ===')
