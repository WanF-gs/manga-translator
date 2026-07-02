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

// Set cookie
await p.context().addCookies([{
  name: 'manga-token', value: token,
  domain: 'localhost', path: '/', httpOnly: false, secure: false, sameSite: 'Lax',
}]);

// Set localStorage
await p.goto('http://localhost:3000', { waitUntil: 'domcontentloaded', timeout: 15000 });
await p.evaluate(({ t, u }) => {
  localStorage.setItem('manga-auth', JSON.stringify({
    state: {
      accessToken: t, refreshToken: '',
      user: { user_id: u.user_id, email: u.email, nickname: u.nickname, plan_type: u.plan_type },
    }, version: 0,
  }));
}, { t: token, u: user });

// Navigate to first project
const projectId = 'dfaeda8d-05fc-40e3-bcb0-039d6e43650f';
console.log('Navigating to project:', projectId);
await p.goto('http://localhost:3000/pc/projects/' + projectId, { waitUntil: 'networkidle', timeout: 30000 });
await p.waitForTimeout(5000);

console.log('Editor URL:', p.url());

// Check images
const imgs = p.locator('img[alt="漫画页面"]');
const imgCount = await imgs.count();
console.log('Manga images:', imgCount);

if (imgCount > 0) {
  const info = await imgs.first().evaluate(el => ({
    nw: (el).naturalWidth, nh: (el).naturalHeight,
    dw: (el).clientWidth, dh: (el).clientHeight,
    complete: (el).complete,
    opacity: getComputedStyle(el).opacity,
    src: (el).src.substring(0, 80),
  }));
  console.log('Image:', JSON.stringify(info, null, 2));
}

// Check all images
const allImgs = p.locator('img');
const allImgCount = await allImgs.count();
console.log('Total images on page:', allImgCount);
for (let i = 0; i < Math.min(allImgCount, 5); i++) {
  const info = await allImgs.nth(i).evaluate(el => ({
    alt: el.getAttribute('alt') || '',
    nw: el.naturalWidth, nh: el.naturalHeight,
    dw: el.clientWidth, dh: el.clientHeight,
    src: el.src.substring(0, 60),
  }));
  console.log('  img', i, ':', JSON.stringify(info));
}

// GPU layer check
const gpuInfo = await p.evaluate(() => {
  const willChange = [];
  const contain = [];
  document.querySelectorAll('*').forEach(el => {
    const st = el.style;
    if (st.willChange && st.willChange !== 'auto') willChange.push({ tag: el.tagName, val: st.willChange });
    const cs = getComputedStyle(el);
    if (cs.contain && cs.contain !== 'none') contain.push({ tag: el.tagName, val: cs.contain });
  });
  return { willChange, contain };
});
console.log('willChange elements:', gpuInfo.willChange.length);
gpuInfo.willChange.forEach(w => console.log('  ', w.tag, ':', w.val));
console.log('contain elements:', gpuInfo.contain.length);
gpuInfo.contain.forEach(c => console.log('  ', c.tag, ':', c.val));

// Page content
const bodyLen = (await p.textContent('body')).length;
console.log('Body content length:', bodyLen);

// Check for page list items / thumbnails
const thumbItems = p.locator('[class*="thumb"], [class*="pageItem"], [class*="page-item"], [class*="Sidebar"] img, [class*="PageList"] img');
const thumbCount = await thumbItems.count();
console.log('Thumbnail items:', thumbCount);

// Console errors
const errors = [];
p.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
p.on('pageerror', err => errors.push(err.message));
await p.waitForTimeout(2000);
console.log('Console errors:', errors.length);
errors.slice(0, 10).forEach(e => console.log('  ERR:', e.substring(0, 120)));

// Take screenshot
await p.screenshot({ path: 'e2e/reproduce_screenshot_001.png', fullPage: false });
console.log('Screenshot saved to e2e/reproduce_screenshot_001.png');

await b.close();
console.log('DONE');
