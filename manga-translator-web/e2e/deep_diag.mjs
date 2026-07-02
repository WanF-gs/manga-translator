/**
 * Deep diagnostic: why editor page doesn't render components
 */
import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Collect console messages
  const consoleMsgs = [];
  page.on('console', msg => {
    consoleMsgs.push(`[${msg.type()}] ${msg.text().substring(0, 200)}`);
  });

  try {
    // Login via API
    const apiResp = await page.request.post('http://localhost:8080/api/v1/auth/login', {
      headers: { 'Content-Type': 'application/json' },
      data: { account: '3452483881@qq.com', password: '123789' },
      timeout: 15000,
    });
    const data = await apiResp.json();
    const token = data.data.tokens.access_token;

    // Set auth
    await page.context().addCookies([{
      name: 'manga-token', value: token,
      domain: 'localhost', path: '/', httpOnly: false, secure: false, sameSite: 'Lax',
    }]);

    // Set localStorage
    await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
    await page.evaluate(({ token, refreshToken, userData }) => {
      localStorage.setItem('manga-auth', JSON.stringify({
        state: {
          accessToken: token,
          refreshToken: refreshToken,
          user: userData,
          isAuthenticated: true,
          _hydrated: true,
        },
        version: 0,
      }));
    }, { token, refreshToken: data.data.tokens.refresh_token, userData: data.data.user });

    // Navigate to editor
    const projectId = 'dfaeda8d-05fc-40e3-bcb0-039d6e43650f';
    console.log('Navigating to editor...');
    await page.goto(`http://localhost:3000/pc/projects/${projectId}`, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });
    
    // Wait for React to render
    await page.waitForTimeout(8000);

    console.log('Current URL:', page.url());

    // Check page content
    const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));
    console.log('Body text preview:', bodyText);

    // Check for Spin (loading)
    const spinCount = await page.locator('.ant-spin').count();
    console.log('Spin elements:', spinCount);

    // Check for error states
    const errorText = await page.evaluate(() => {
      const el = document.querySelector('.ant-alert-error, [class*="error"], [class*="Error"]');
      return el ? el.textContent?.substring(0, 200) : 'none';
    });
    console.log('Error element:', errorText);

    // Check images
    const allImgs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('img')).map(img => ({
        alt: img.alt,
        src: img.src.substring(0, 100),
        complete: img.complete,
        naturalW: img.naturalWidth,
      }));
    });
    console.log('Images:', allImgs.length);
    allImgs.forEach(i => console.log('  img:', JSON.stringify(i)));

    // Check for Ant Design Skeleton
    const skeletonCount = await page.locator('.ant-skeleton').count();
    console.log('Skeleton elements:', skeletonCount);

    // Check key elements by class
    const elemInfo = await page.evaluate(() => {
      const classes = [];
      document.querySelectorAll('*').forEach(el => {
        const c = el.className;
        if (typeof c === 'string') {
          const lower = c.toLowerCase();
          if (lower.includes('toolbar') || lower.includes('sidebar') || 
              lower.includes('canvas') || lower.includes('statusbar') ||
              lower.includes('propertypanel') || lower.includes('loading') ||
              lower.includes('error') || lower.includes('skeleton') ||
              lower.includes('empty')) {
            classes.push(el.tagName + '.' + c.substring(0, 60));
          }
        }
      });
      return classes;
    });
    console.log('Relevant elements:', elemInfo.length);
    elemInfo.forEach(e => console.log('  ', e));

    // Full HTML snippet
    const html = await page.evaluate(() => document.body.innerHTML.substring(0, 3000));
    console.log('\nHTML snippet:');
    console.log(html);

    // Screenshot
    await page.screenshot({ path: 'e2e/screenshots_v4/deep_diag.png' });
    console.log('\nScreenshot saved');

    // Console messages
    console.log('\nConsole messages:');
    consoleMsgs.forEach(m => console.log('  ', m));

  } catch (err) {
    console.error('ERROR:', err.message);
  } finally {
    await browser.close();
  }
}

main();
