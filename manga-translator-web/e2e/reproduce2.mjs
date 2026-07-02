import { chromium } from 'playwright';

const b = await chromium.launch({ headless: true, channel: 'msedge' });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });

// Login
const loginResp = await p.request.post('http://localhost:8080/api/v1/auth/login', {
  headers: { 'Content-Type': 'application/json' },
  data: { account: '3452483881@qq.com', password: '123789' },
});
const loginData = await loginResp.json();
const token = loginData.data.tokens.access_token;
const user = loginData.data.user;
console.log('Login OK:', user.email, user.nickname);

// Set cookie + localStorage
await p.context().addCookies([{ name: 'manga-token', value: token, domain: 'localhost', path: '/', httpOnly: false, secure: false, sameSite: 'Lax' }]);
await p.goto('http://localhost:3000', { waitUntil: 'domcontentloaded', timeout: 15000 });
await p.evaluate(({ t, u }) => {
  localStorage.setItem('manga-auth', JSON.stringify({
    state: { accessToken: t, refreshToken: '', user: { user_id: u.user_id, email: u.email, nickname: u.nickname, plan_type: u.plan_type } }, version: 0,
  }));
}, { t: token, u: user });

// Navigate
const projectId = 'dfaeda8d-05fc-40e3-bcb0-039d6e43650f';
await p.goto('http://localhost:3000/pc/projects/' + projectId, { waitUntil: 'networkidle', timeout: 30000 });
await p.waitForTimeout(5000);
console.log('URL:', p.url());

// Get current page info from network
const apiBase = 'http://localhost:8080/api/v1';

// Get chapters for this project
const chResp = await p.request.get(apiBase + '/projects/' + projectId + '/chapters', {
  headers: { 'Authorization': 'Bearer ' + token },
});
const chData = await chResp.json();
const chapters = chData.data || [];
console.log('Chapters:', chapters.length);
const chId = chapters[0]?.chapter_id;
console.log('Chapter ID:', chId);

// Get pages
const pgResp = await p.request.get(apiBase + '/pages/chapters/' + chId + '/pages', {
  headers: { 'Authorization': 'Bearer ' + token },
});
const pgData = await pgResp.json();
const pages = pgData.data?.items || [];
console.log('Pages count:', pages.length);

// Show first 5 pages
pages.slice(0, 5).forEach(pg => {
  console.log('  Page:', pg.page_id, '| order:', pg.sort_order, '| size:', pg.width + 'x' + pg.height, '| regions:', pg.region_count, '| status:', pg.status);
});

// Get page details for first page
const firstPageId = pages[0]?.page_id;
if (firstPageId) {
  const detResp = await p.request.get(apiBase + '/pages/' + firstPageId, {
    headers: { 'Authorization': 'Bearer ' + token },
  });
  const detData = await detResp.json();
  console.log('Page detail:', JSON.stringify(detData.data).substring(0, 600));
  
  // Get regions
  const regResp = await p.request.get(apiBase + '/pages/' + firstPageId + '/regions', {
    headers: { 'Authorization': 'Bearer ' + token },
  });
  const regData = await regResp.json();
  const regions = regData.data?.items || regData.data || [];
  console.log('Regions count:', regions.length);
  regions.slice(0, 3).forEach(r => {
    console.log('  Region:', JSON.stringify(r).substring(0, 200));
  });
}

// Check ZOOM controls in DOM
console.log('\n--- DOM ZOOM check ---');
const zoomCheck = await p.evaluate(() => {
  const results = { sliders: 0, zoomTexts: [], toolbars: [] };
  document.querySelectorAll('input[type="range"]').forEach(el => results.sliders++);
  document.querySelectorAll('*').forEach(el => {
    const t = el.textContent || '';
    if (t.match(/\d+%/)) results.zoomTexts.push(t.substring(0, 30));
    if (el.className && typeof el.className === 'string' && el.className.includes('Toolbar')) {
      results.toolbars.push(el.tagName + ': ' + el.className.substring(0, 60));
    }
  });
  return results;
});
console.log('Range sliders:', zoomCheck.sliders);
console.log('Zoom text elements:', zoomCheck.zoomTexts.length);
console.log('Toolbar elements:', zoomCheck.toolbars.length);

// Check the image container's CSS transforms
const cssInfo = await p.evaluate(() => {
  const img = document.querySelector('img[alt="漫画页面"]');
  if (!img) return null;
  const parent = img.parentElement;
  const grandparent = parent?.parentElement;
  const styles = {
    img: { w: img.style.width, h: img.style.height, transform: img.style.transform, maxW: img.style.maxWidth },
    parent: { transform: parent?.style.transform || 'none', w: parent?.clientWidth, h: parent?.clientHeight, overflow: getComputedStyle(parent).overflow },
    grandparent: { w: grandparent?.clientWidth, h: grandparent?.clientHeight },
  };
  return styles;
});
console.log('CSS transform info:', JSON.stringify(cssInfo, null, 2));

// Try clicking page 2 from sidebar
console.log('\n--- Navigate to page 5 ---');
const pageImg5 = p.locator('img[alt="第5页"]');
if (await pageImg5.count() > 0) {
  await pageImg5.first().click();
  await p.waitForTimeout(3000);
  
  const newImg = p.locator('img[alt="漫画页面"]');
  if (await newImg.count() > 0) {
    const info = await newImg.first().evaluate(el => ({
      nw: el.naturalWidth, nh: el.naturalHeight,
      dw: el.clientWidth, dh: el.clientHeight,
      opacity: getComputedStyle(el).opacity,
    }));
    console.log('After page switch - Image:', JSON.stringify(info));
    // Ratio check
    const nr = info.nw / info.nh;
    const dr = info.dw / info.dh;
    console.log('Natural ratio:', nr.toFixed(3), '| Display ratio:', dr.toFixed(3), '| Deviation:', Math.abs(nr - dr).toFixed(3));
  }
}

// Take final screenshot
await p.screenshot({ path: 'e2e/reproduce_screenshot_002.png', fullPage: false });
console.log('Screenshot saved');

await b.close();
console.log('DONE');
