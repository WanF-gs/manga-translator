"""B1 Fix Verification - Check for [object Object] 404 and console errors"""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()

    # Collect console messages
    console_errors = []
    page.on("console", lambda msg: (
        console_errors.append(f"[{msg.type}] {msg.text}") if msg.type in ("error", "warning") else None
    ))

    # Collect network requests
    requests_with_object = []
    def check_request(req):
        url = req.url.lower()
        if "[object" in url:
            requests_with_object.append(req.url)
    page.on("request", check_request)

    # Navigate to PC page
    print("=== Testing /pc (Project List) ===")
    page.goto('http://localhost:3005/pc', wait_until='networkidle', timeout=30000)
    page.wait_for_timeout(2000)

    error_msgs = [e for e in console_errors if e.startswith('[error]')]
    print(f"Console errors: {len(error_msgs)}")
    for e in error_msgs[:10]:
        print(f"  {e}")
    print(f"Requests with [object Object]: {len(requests_with_object)}")

    # Take screenshot
    page.screenshot(path='c:/Users/WanFi/Desktop/大三实训/demo_04/manga-translator-web/test_output/pc_list.png', full_page=True)
    print("Screenshot saved: test_output/pc_list.png")

    # Navigate to project detail if any
    project_links = page.locator('a[href*="/pc/projects/"]').all()
    if project_links:
        print(f"\n=== Testing /pc/projects/[id] (Project Detail) ===")
        href = project_links[0].get_attribute('href')
        print(f"Navigating to: {href}")
        page.goto(f'http://localhost:3005{href}', wait_until='networkidle', timeout=30000)
        page.wait_for_timeout(2000)
        page.screenshot(path='c:/Users/WanFi/Desktop/大三实训/demo_04/manga-translator-web/test_output/pc_project_detail.png', full_page=True)
        print("Screenshot saved: test_output/pc_project_detail.png")
    else:
        print("\nNo project links found (possible: not logged in, or redirect to login)")

    # Final summary
    error_msgs = [e for e in console_errors if e.startswith('[error]')]
    print(f"\n=== FINAL RESULT ===")
    print(f"Total console errors: {len(error_msgs)}")
    print(f"Total [object Object] requests: {len(requests_with_object)}")
    if error_msgs:
        print("ERRORS:")
        for e in error_msgs[:5]:
            print(f"  {e}")
    elif len(requests_with_object) == 0:
        print("PASS: No console errors, no [object Object] in URLs!")
    else:
        print("WARNING: No console errors but [object Object] requests found")

    browser.close()
