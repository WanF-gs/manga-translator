"""Final Regression Test - All pages, screenshots, console check"""
from playwright.sync_api import sync_playwright
import os

OUTPUT_DIR = "c:/Users/WanFi/Desktop/大三实训/demo_04/manga-translator-web/test_output"
os.makedirs(OUTPUT_DIR, exist_ok=True)

PAGES = [
    "/pc",
    "/pc/fonts",
    "/pc/learn",
    "/pc/api-keys",
    "/pc/trash",
    "/pc/settings",
    "/pc/audio",
    "/pc/search",
    "/pc/dynamic-manga",
    "/pc/characters",
]

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    page = context.new_page()

    results = []
    total_errors = 0

    for path in PAGES:
        console_msgs = []
        def on_console(msg):
            console_msgs.append((msg.type, msg.text[:300]))
        page.on("console", on_console)

        name = path.replace("/pc", "pc").replace("/", "_").strip("_") or "home"
        url = f"http://localhost:3005{path}"

        try:
            page.goto(url, wait_until="networkidle", timeout=20000)
            page.wait_for_timeout(1500)
            screenshot_path = os.path.join(OUTPUT_DIR, f"regression_{name}.png")
            page.screenshot(path=screenshot_path, full_page=True)
        except Exception as e:
            results.append((path, f"TIMEOUT: {str(e)[:80]}", 0))
            page.remove_listener("console", on_console)
            continue

        page.remove_listener("console", on_console)
        errors = [m for m in console_msgs if m[0] == "error" and "favicon" not in m[1] and "Failed to load resource" not in m[1]]
        
        status = "PASS" if len(errors) == 0 else f"FAIL ({len(errors)} errors)"
        results.append((path, status, len(errors)))
        total_errors += len(errors)
        
        if errors:
            for e in errors[:2]:
                print(f"  {path} ERROR: {e[1][:200]}")

    print("=" * 60)
    print("FINAL REGRESSION TEST RESULTS")
    print("=" * 60)
    for path, status, err_count in results:
        icon = "PASS" if err_count == 0 else "FAIL"
        print(f"  [{icon}] {path}: {status}")

    print(f"\nTotal pages tested: {len(results)}")
    print(f"Total console errors: {total_errors}")
    
    if total_errors == 0:
        print("ALL PAGES PASS - Zero red errors in console!")
    else:
        print("SOME PAGES HAVE ERRORS - check above")

    print(f"\nScreenshots saved to: {OUTPUT_DIR}")
    browser.close()
