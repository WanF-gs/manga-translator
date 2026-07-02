/**
 * Quick diagnostic: check what's actually rendering on the editor page
 */
import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:3000';
const TEST_USER = { account: '3452483881@qq.com', password: '123789' };

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Login via API
    const apiResp = await page.request.post('http://localhost:8080/api/v1/auth/login', {
      headers: { 'Content-Type': 'application/json' },
      data: TEST_USER,
      timeout: 15000,
    });
    
    if (apiResp.status() !== 200) {
      console.log('LOGIN FAILED:', apiResp.status());
      return;
    }
    
    const data = await apiResp.json();
    const token = data.data.tokens.access_token;
    console.log('Login OK:', data.data.user.email);

    // Set auth
    await page.context().addCookies([{
      name: 'manga-token', value: token,
      domain: 'localhost', path: '/', httpOnly: false, secure: false, sameSite: 'Lax',
    }]);

    // Get project list
    const listResp = await page.request.get('http://localhost:8080/api/v1/projects', {
      headers: { 'Authorization': 'Bearer ' + token },
      timeout: 10000,
    });
    
    const listData = await listResp.json();
    const items = listData.data?.items || [];
    
    if (items.length === 0) {
      console.log('No projects found!');
      return;
    }
    
    const project = items[0];
    console.log('Project:', project.name, project.project_id);

    // Get chapters and pages
    const chResp = await page.request.get(`http://localhost:8080/api/v1/projects/${project.project_id}/chapters`, {
      headers: { 'Authorization': 'Bearer ' + token },
      timeout: 10000,
    });
    const chData = await chResp.json();
    const chapters = chData.data?.items || [];
    console.log('Chapters:', chapters.length);
    
    if (chapters.length > 0) {
      const ch = chapters[0];
      console.log('  Chapter:', ch.name, 'pages:', ch.pages?.length || 0);
      if (ch.pages?.length > 0) {
        const p = ch.pages[0];
        console.log('  Page 1:', p.page_id, 'original_url:', p.original_url?.substring(0, 80));
      }
    }

    // Navigate to editor
    const editorUrl = `${BASE_URL}/pc/projects/${project.project_id}`;
    console.log('\nNavigating to:', editorUrl);
    await page.goto(editorUrl, { waitUntil: 'networkidle', timeout: 30000 });
    
    // Extra wait for lazy images
    await page.waitForTimeout(5000);
    
    // Check page URL
    console.log('Current URL:', page.url());
    
    // Check console errors
    page.on('console', msg => {
      if (msg.type() === 'error') console.log('CONSOLE ERROR:', msg.text().substring(0, 200));
    });
    
    // Check all images on page
    const allImgs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('img')).map(img => ({
        alt: img.getAttribute('alt'),
        src: img.src?.substring(0, 120),
        natural: img.naturalWidth + 'x' + img.naturalHeight,
        display: img.clientWidth + 'x' + img.clientHeight,
        complete: img.complete,
        visible: img.offsetParent !== null,
      }));
    });
    console.log('\nImages found:', allImgs.length);
    allImgs.forEach((img, i) => console.log(`  [${i}] alt="${img.alt}" natural=${img.natural} display=${img.display} complete=${img.complete} visible=${img.visible} src=${img.src}`));

    // Check main elements
    const structure = await page.evaluate(() => {
      const result = {};
      const toolbar = document.querySelector('[class*="toolbar"], [class*="Toolbar"], header');
      result.toolbar = toolbar ? toolbar.tagName : 'NOT FOUND';
      
      const sidebar = document.querySelector('[class*="sidebar"], [class*="Sidebar"], aside');
      result.sidebar = sidebar ? sidebar.tagName : 'NOT FOUND';
      
      const statusbar = document.querySelector('[class*="statusbar"], [class*="StatusBar"], footer');
      result.statusbar = statusbar ? statusbar.tagName : 'NOT FOUND';
      
      const canvas = document.querySelector('[class*="canvas"], [class*="Canvas"]');
      result.canvas = canvas ? canvas.tagName : 'NOT FOUND';
      
      return result;
    });
    console.log('\nPage structure:', JSON.stringify(structure, null, 2));

    // Screenshot
    await page.screenshot({ path: 'e2e/screenshots_v4/diag_screenshot.png', fullPage: false });
    console.log('\nScreenshot saved: e2e/screenshots_v4/diag_screenshot.png');

  } catch (err) {
    console.error('ERROR:', err.message);
  } finally {
    await browser.close();
  }
}

main();
