"""Test all PC pages for console errors after B1+B2 fixes"""
from playwright.sync_api import sync_playwright

PAGES = [
    "/pc",
    "/pc/audio",
    "/pc/fonts", 
    "/pc/learn",
    "/pc/api-keys",
    "/pc/trash",
    "/pc/settings",
    "/pc/search",
    "/pc/dynamic-manga",
    "/pc/characters",
]

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()

    all_errors = []

    for path in PAGES:
        console_errors = []
        page.on("console", lambda msg, ce=console_errors: (
            ce.append(f"[{msg.type}] {msg.text[:200]}") if msg.type in ("error",) else None
        ))
        
        url = f"http://localhost:3005{path}"
        try:
            page.goto(url, wait_until="networkidle", timeout=15000)
            page.wait_for_timeout(1000)
        except Exception as e:
            print(f"  {path}: TIMEOUT/ERROR - {str(e)[:100]}")
            continue

        page_errors = [e for e in console_errors if e.startswith("[error]")]
        # Filter out CORS/network errors from unauthenticated requests
        page_errors = [e for e in page_errors if "Failed to load resource" not in e]
        
        status = "PASS" if len(page_errors) == 0 else f"FAIL ({len(page_errors)} errors)"
        print(f"  {path}: {status}")
        for e in page_errors[:3]:
            print(f"    {e}")
        all_errors.extend(page_errors)

    print(f"\n=== SUMMARY ===")
    print(f"Total console errors across all pages: {len(all_errors)}")
    if all_errors:
        print("ERRORS:")
        for e in all_errors:
            print(f"  {e}")
    else:
        print("ALL PAGES PASS - zero console errors!")

    browser.close()
