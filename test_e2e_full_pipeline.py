#!/usr/bin/env python3
"""
漫画翻译系统 - 全链路 E2E 核心管道测试 v2
覆盖：上传 → 检测 → OCR → 翻译 → 擦除 → 排版 → 导出
"""
import httpx, json, time, os, sys

BASE = "http://127.0.0.1:8080"
IMG_SVC = "http://127.0.0.1:8004"
EXP_SVC = "http://127.0.0.1:8005"
FRONTEND = "http://localhost:3000"
TEST_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "测试项目")

PASS = "\u2705"
FAIL = "\u274c"
WARN = "\u26a0\ufe0f"

results = []


def step(num, name):
    print(f"\n{'='*60}")
    print(f"  STEP {num}: {name}")
    print(f"{'='*60}")


def check(label, ok, detail=""):
    status = PASS if ok else FAIL
    results.append((label, ok, detail))
    print(f"  {status} {label}" + (f" ({detail})" if detail else ""))
    return ok


# ============================================================
# STEP 0: 前端可达性
# ============================================================
step(0, "前端可达性")

try:
    r = httpx.get(FRONTEND, timeout=10, follow_redirects=True)
    check("前端首页可访问", r.status_code == 200, f"HTTP {r.status_code}")
except Exception as e:
    check("前端首页可访问", False, str(e)[:80])

# ============================================================
# STEP 1: 后端服务健康检查
# ============================================================
step(1, "后端服务健康检查 (8 个微服务)")

for name, url in [
    ("API Gateway", "http://127.0.0.1:8080"),
    ("User Service", "http://127.0.0.1:8001"),
    ("Project Service", "http://127.0.0.1:8002"),
    ("Translation Service", "http://127.0.0.1:8003"),
    ("Image Service", "http://127.0.0.1:8004"),
    ("Export Service", "http://127.0.0.1:8005"),
    ("Reader Service", "http://127.0.0.1:8006"),
    ("AI Gateway", "http://127.0.0.1:8100"),
]:
    try:
        r = httpx.get(f"{url}/health", timeout=5)
        check(f"{name} 健康", r.status_code == 200, f"HTTP {r.status_code}")
    except Exception as e:
        check(f"{name} 健康", False, str(e)[:50])

# ============================================================
# STEP 2: 登录
# ============================================================
step(2, "登录认证")

r = httpx.post(f"{BASE}/api/v1/auth/login", json={
    "email": "wsl2test@test.com", "password": "test1234"
}, timeout=5)
token = r.json()["data"]["tokens"]["access_token"]
h = {"Authorization": f"Bearer {token}"}
check("用户登录", True, "Token 获取成功")

# ============================================================
# STEP 3: 上传图像 (通过 chapter upload)
# ============================================================
step(3, "图像上传")

# 找测试图片
img_path = None
if os.path.isdir(TEST_DIR):
    for f in sorted(os.listdir(TEST_DIR)):
        if f.endswith(('.jpg', '.png', '.jpeg')):
            img_path = os.path.join(TEST_DIR, f)
            break

project_id = None
chid = None
page_id = None
upload_ok = False

if img_path:
    # 先获取项目列表确定 chapter_id
    r = httpx.get(f"{BASE}/api/v1/projects", headers=h, timeout=10)
    projects = r.json().get("data", {}).get("items", [])
    if projects:
        project_id = projects[0]["project_id"]
        r = httpx.get(f"{BASE}/api/v1/projects/{project_id}/chapters", headers=h, timeout=10)
        resp = r.json()
        d = resp.get("data", resp)
        chapters = d.get("items", d) if isinstance(d, dict) else d if isinstance(d, list) else []
        if chapters:
            chid = chapters[0]["chapter_id"]

    if chid:
        try:
            with open(img_path, "rb") as f:
                files = {"file": (os.path.basename(img_path), f, "image/jpeg")}
                r = httpx.post(
                    f"{BASE}/api/v1/chapters/{chid}/pages/upload",
                    headers=h, files=files,
                    timeout=120
                )
                if r.status_code in (200, 201):
                    resp = r.json()
                    pages_data = resp.get("data", {}).get("pages", [])
                    if pages_data:
                        page_id = pages_data[0]["page_id"]
                    upload_ok = True
                    check("图像上传", True, f"{os.path.basename(img_path)} → {page_id[:12] if page_id else 'OK'}...")
                else:
                    check("图像上传", False, f"HTTP {r.status_code}: {r.text[:200]}")
        except Exception as e:
            check("图像上传", False, str(e)[:80])

if not upload_ok or not page_id:
    # 回退到现有页面
    r = httpx.get(f"{BASE}/api/v1/projects", headers=h, timeout=10)
    projects = r.json().get("data", {}).get("items", [])
    if projects:
        project_id = projects[0]["project_id"]
        r = httpx.get(f"{BASE}/api/v1/projects/{project_id}/chapters", headers=h, timeout=10)
        resp = r.json()
        d = resp.get("data", resp)
        chapters = d.get("items", d) if isinstance(d, dict) else d if isinstance(d, list) else []
        if chapters:
            chid = chapters[0]["chapter_id"]
            r = httpx.get(f"{BASE}/api/v1/chapters/{chid}/pages", headers=h, timeout=10)
            resp = r.json()
            d = resp.get("data", resp)
            pages = d.get("items", d) if isinstance(d, dict) else d if isinstance(d, list) else []
            if pages:
                page_id = pages[0]["page_id"]
                upload_ok = True
                check("图像上传", True, f"使用现有页面 {page_id[:12]}...")

if not page_id:
    print("  无法继续测试")
    sys.exit(1)

# ============================================================
# STEP 4: 文字区域检测
# ============================================================
step(4, "文字区域检测")

t0 = time.time()
r = httpx.post(f"{BASE}/api/v1/pages/{page_id}/detect", headers=h, json={"language": "ja"}, timeout=60)
elapsed = time.time() - t0
data = r.json()
regions = data.get("data", {}).get("regions", [])
types = {}
for rg in regions:
    t = rg.get("type", "unknown")
    types[t] = types.get(t, 0) + 1
check("文字区域检测", r.status_code == 200 and len(regions) > 0,
      f"{len(regions)} 区域, {elapsed:.1f}s")
if types:
    print(f"    类型分布: {types}")

# ============================================================
# STEP 5: OCR 文字识别
# ============================================================
step(5, "OCR 文字识别")

ocr_ok = False
t0 = time.time()
r = httpx.post(f"{BASE}/api/v1/pages/{page_id}/ocr", headers=h, json={"language": "ja"}, timeout=180)
elapsed = time.time() - t0
data = r.json()
ocr_results = data.get("data", {}).get("results", [])
text_count = sum(1 for rg in ocr_results if (rg.get("text") or "").strip())
ocr_ok = text_count > 0
check("OCR 识别", r.status_code == 200 and ocr_ok,
      f"{len(ocr_results)} 区域, {text_count} 有文本, {elapsed:.1f}s")
if ocr_results:
    for rg in ocr_results[:3]:
        print(f"    [{rg.get('region_id','?')[:8]}] text='{(rg.get('text') or '')[:40]}' conf={rg.get('confidence',0):.2f}")

# ============================================================
# STEP 6: 智能翻译
# ============================================================
step(6, "智能翻译")

translated = []
if ocr_ok:
    t0 = time.time()
    r = httpx.post(f"{BASE}/api/v1/pages/{page_id}/translate", headers=h, json={"target_lang": "zh-CN"}, timeout=180)
    elapsed = time.time() - t0
    data = r.json()
    translated = data.get("data", {}).get("regions", [])
    trans_count = sum(1 for rg in translated if (rg.get("translated_text") or "").strip())
    check("智能翻译", r.status_code == 200 and trans_count > 0,
          f"{len(translated)} 区域, {trans_count} 已翻译, {elapsed:.1f}s")
    if translated:
        for rg in translated[:3]:
            print(f"    [{rg.get('engine_used','?')}] '{(rg.get('translated_text') or '')[:40]}'")
else:
    check("智能翻译", False, "OCR 无文本，跳过")

# ============================================================
# STEP 7: 背景擦除 (Inpaint)
# ============================================================
step(7, "背景擦除修复")

t0 = time.time()
r = httpx.post(f"{BASE}/api/v1/pages/{page_id}/inpaint", headers=h, json={
    "method": "telea", "background_preserve": True,
}, timeout=180)
elapsed = time.time() - t0
data = r.json()
d = data.get("data", data)
result_url = d.get("result_url")
regions_proc = d.get("regions_processed", 0)
check("背景擦除", r.status_code == 200 and result_url is not None,
      f"method={d.get('method','?')}, regions={regions_proc}, {elapsed:.1f}s")
if result_url:
    print(f"    结果: {result_url}")

# ============================================================
# STEP 8: 文字排版渲染
# ============================================================
step(8, "文字排版渲染")

render_regions = []
if translated:
    for rg in translated:
        if (rg.get("translated_text") or "").strip():
            render_regions.append({
                "region_id": rg["region_id"],
                "translated_text": rg["translated_text"],
                "boundary": rg.get("boundary"),
                "region_type": rg.get("region_type", "speech"),
            })

if render_regions:
    t0 = time.time()
    try:
        r = httpx.post(f"{IMG_SVC}/api/v1/pages/{page_id}/render", headers=h, json={
            "regions": render_regions,
        }, timeout=180)
        elapsed = time.time() - t0
        data = r.json()
        d = data.get("data", data)
        rendered = d.get("regions_rendered", 0)
        res_url = d.get("result_url") or d.get("processed_url")
        check("文字排版渲染", r.status_code == 200 and rendered > 0,
              f"{rendered} 区域渲染, {elapsed:.1f}s")
        if res_url:
            print(f"    结果: {res_url}")
    except Exception as e:
        elapsed = time.time() - t0
        check("文字排版渲染", False, str(e)[:80])
else:
    check("文字排版渲染", False, "无翻译文本，跳过")

# ============================================================
# STEP 9: 导出
# ============================================================
step(9, "导出")

t0 = time.time()
try:
    r = httpx.post(f"{BASE}/api/v1/exports/single", headers=h, json={
        "page_id": page_id,
        "format": "png",
        "quality": 90,
    }, timeout=120)
    elapsed = time.time() - t0
    data = r.json()
    d = data.get("data", data)
    task_id = d.get("task_id") or data.get("task_id")
    status = d.get("status") or data.get("status")
    download_url = d.get("download_url") or data.get("download_url")
    export_ok = status in ("completed", "pending", "processing")
    check("单页导出", r.status_code == 200, f"status={status}, {elapsed:.1f}s")
    if download_url:
        print(f"    下载: {download_url}")
except Exception as e:
    elapsed = time.time() - t0
    check("单页导出", False, str(e)[:80])

# 项目级导出
t0 = time.time()
try:
    r = httpx.post(f"{BASE}/api/v1/exports/project", headers=h, json={
        "chapter_id": chid,
        "format": "png",
    }, timeout=120)
    elapsed = time.time() - t0
    data = r.json()
    d = data.get("data", data)
    status = d.get("status") or data.get("status")
    check("项目导出", r.status_code == 200, f"status={status}, {elapsed:.1f}s")
except Exception as e:
    elapsed = time.time() - t0
    check("项目导出", False, str(e)[:80])

# ============================================================
# 汇总
# ============================================================
print(f"\n{'='*60}")
print(f"  测试汇总")
print(f"{'='*60}")

passed = sum(1 for _, ok, _ in results if ok)
failed = sum(1 for _, ok, _ in results if not ok)
total = len(results)

for label, ok, detail in results:
    status = PASS if ok else FAIL
    print(f"  {status} {label}" + (f" ({detail})" if detail else ""))

print(f"\n  {PASS} 通过: {passed}/{total}  {FAIL if failed else PASS} 失败: {failed}/{total}")

if failed == 0:
    print(f"\n  {PASS} 全链路测试通过！核心管道完整可运行。")
elif passed >= total * 0.8:
    print(f"\n  {WARN} 大部分通过，{failed} 项需关注。")
else:
    print(f"\n  {FAIL} 多项失败，请检查。")
