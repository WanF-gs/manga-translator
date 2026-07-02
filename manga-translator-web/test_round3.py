"""Verify B4-B9 fixes: all pages with extra detail"""
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
    all_warnings = []

    for path in PAGES:
        console_msgs = []
        
        def on_console(msg):
            console_msgs.append((msg.type, msg.text[:250]))

        page.on("console", on_console)
        
        url = f"http://localhost:3005{path}"
        try:
            page.goto(url, wait_until="networkidle", timeout=15000)
            page.wait_for_timeout(1500)
        except Exception as e:
            print(f"  {path}: TIMEOUT/ERROR - {str(e)[:100]}")
            page.remove_listener("console", on_console)
            continue

        page.remove_listener("console", on_console)

        page_errors = [m for m in console_msgs if m[0] == "error"]
        # Filter noise
        page_errors = [m for m in page_errors if "Failed to load resource" not in m[1] and "favicon" not in m[1]]
        page_warnings = [m for m in console_msgs if m[0] == "warning"]
        
        status = "PASS" if len(page_errors) == 0 else f"FAIL"
        print(f"  {path}: {status} (errors={len(page_errors)}, warnings={len(page_warnings)})")
        for e in page_errors[:3]:
            print(f"    ERROR: {e[1][:150]}")
        for w in page_warnings[:2]:
            print(f"    WARN: {w[1][:150]}")
        all_errors.extend(page_errors)
        all_warnings.extend(page_warnings)

        # For fonts page, check if action buttons exist
        if path == "/pc/fonts":
            preview_btns = page.locator('button:has(svg)').count()
            print(f"    UI elements found: {preview_btns} buttons")
        
        # For audio page, check sound effects section
        if path == "/pc/audio":
            effect_cards = page.locator('text=场景音效库').count()
            print(f"    Sound effects section: {'FOUND' if effect_cards > 0 else 'MISSING'}")

    print(f"\n=== SUMMARY ===")
    print(f"Total pages: {len(PAGES)}")
    print(f"Total console errors: {len(all_errors)}")
    print(f"Total console warnings: {len(all_warnings)}")
    
    if all_errors:
        print("\nERRORS:")
        for e in all_errors:
            print(f"  [{e[0]}] {e[1][:200]}")
    else:
        print("ALL PAGES PASS!")

    # Check for deprecated warnings (B9)
    dep_warnings = [w for w in all_warnings if "destroyOnClose" in w[1] or "deprecated" in w[1].lower()]
    if dep_warnings:
        print(f"\nB9: {len(dep_warnings)} deprecation warnings remaining")
    else:
        print("B9: No deprecation warnings (destroyOnClose replaced)")

    browser.close()
