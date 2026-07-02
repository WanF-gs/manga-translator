/**
 * 快速诊断：检查 auth token 存储和页面结构
 */
import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:3000';
const TEST_EMAIL = '3452483881@qq.com';
const TEST_PASSWORD = '123789';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  // 1. 登录
  console.log('1. 登录...');
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);

  const emailInput = page.locator('input[type="email"], input[name="email"]').first();
  const passwordInput = page.locator('input[type="password"]').first();

  if (await emailInput.isVisible()) {
    await emailInput.fill(TEST_EMAIL);
    await passwordInput.fill(TEST_PASSWORD);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(4000);
    await page.waitForLoadState('networkidle');
    console.log('   登录后 URL:', page.url());
  }

  // 2. 检查 localStorage 中的 token
  console.log('\n2. localStorage keys:');
  const lsKeys = await page.evaluate(() => {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const val = localStorage.getItem(key);
      keys.push({ key, valLen: val?.length, valStart: val?.slice(0, 50) });
    }
    return keys;
  });
  lsKeys.forEach(k => console.log(`   ${k.key}: length=${k.valLen}, start="${k.valStart}"`));

  // 3. 用找到的 token 测试 API
  console.log('\n3. 测试 API:');
  const apiTest = await page.evaluate(async () => {
    const results = {};
    
    // 尝试找 token
    let token = null;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const val = localStorage.getItem(key);
      if (val && val.length > 20 && (key.includes('token') || key.includes('auth') || key.includes('access') || key.includes('session'))) {
        token = { key, val: val.slice(0, 40) + '...' };
      }
    }
    results.token = token;

    // 用各种可能的 header 格式测试
    const headers1 = token ? { 'Authorization': `Bearer ${localStorage.getItem(token.key)}` } : {};
    
    // 也检查 cookies
    results.cookies = document.cookie;

    // 尝试 API
    try {
      const res = await fetch('/api/v1/projects', { headers: headers1 });
      const text = await res.text();
      results.projectsApi = { status: res.status, isJson: text.startsWith('{') || text.startsWith('['), textStart: text.slice(0, 100) };
    } catch (e) {
      results.projectsApi = { error: e.message };
    }

    // 也尝试不加 header
    try {
      const res2 = await fetch('/api/v1/projects');
      const text2 = await res2.text();
      results.projectsApiNoAuth = { status: res2.status, textStart: text2.slice(0, 100) };
    } catch (e) {
      results.projectsApiNoAuth = { error: e.message };
    }

    return results;
  });
  console.log('   Token:', JSON.stringify(apiTest.token));
  console.log('   Cookies:', apiTest.cookies?.slice(0, 100));
  console.log('   API (with auth):', JSON.stringify(apiTest.projectsApi));
  console.log('   API (no auth):', JSON.stringify(apiTest.projectsApiNoAuth));

  // 4. 进入项目页，检查 DOM 结构
  console.log('\n4. 项目页 DOM 结构:');
  await page.goto(`${BASE_URL}/pc/projects/dfaeda8d-05fc-40e3-bcb0-039d6e43650f`, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(3000);

  // 输出所有主要 class 名称来了解布局
  const domInfo = await page.evaluate(() => {
    const info = {};
    
    // 找主容器
    const mainEls = document.querySelectorAll('[class*="layout"], [class*="Layout"], [class*="main"], [class*="Main"]');
    info.mainContainers = Array.from(mainEls).slice(0, 5).map(el => el.className?.slice(0, 80));

    // 找侧边栏
    const sidebarEls = document.querySelectorAll('[class*="sidebar"], [class*="Sidebar"], [class*="side"], [class*="nav"], [class*="Nav"]');
    info.sidebarEls = Array.from(sidebarEls).slice(0, 5).map(el => ({
      tag: el.tagName,
      class: el.className?.slice(0, 100),
      childCount: el.children.length,
    }));

    // 找所有可以点击的章节/页码
    const allButtons = document.querySelectorAll('button, a, [role="button"]');
    const pageButtons = Array.from(allButtons).filter(b => {
      const text = (b.textContent || '').trim();
      return text && (text.includes('页') || text.includes('Page') || /^\d+$/.test(text));
    });
    info.pageButtons = pageButtons.slice(0, 10).map(b => ({
      tag: b.tagName,
      text: b.textContent?.trim().slice(0, 30),
      href: b.getAttribute('href')?.slice(0, 60),
      class: b.className?.slice(0, 80),
    }));

    // 找所有链接
    const allLinks = document.querySelectorAll('a[href]');
    info.allLinks = Array.from(allLinks).filter(a => a.getAttribute('href')?.includes('pageId')).slice(0, 10).map(a => ({
      href: a.getAttribute('href')?.slice(0, 80),
      text: a.textContent?.trim().slice(0, 30),
    }));

    // 检查是否有 popup/modal 遮挡
    const modals = document.querySelectorAll('[class*="modal"], [class*="Modal"], [class*="popup"], [class*="Popup"], [class*="overlay"], [class*="Overlay"], [class*="drawer"], [class*="Drawer"]');
    info.modals = Array.from(modals).slice(0, 5).map(el => ({
      class: el.className?.slice(0, 80),
      visible: el.offsetParent !== null,
    }));

    return info;
  });

  console.log('   主容器:', JSON.stringify(domInfo.mainContainers));
  console.log('   侧边栏:', JSON.stringify(domInfo.sidebarEls));
  console.log('   页码按钮:', JSON.stringify(domInfo.pageButtons));
  console.log('   pageId 链接:', JSON.stringify(domInfo.allLinks));
  console.log('   弹窗/遮罩:', JSON.stringify(domInfo.modals));

  // 5. 截图
  await page.screenshot({ path: 'e2e/screenshots_p0_test/diag_project.png', fullPage: false });
  console.log('\n5. 已截图到 screenshots_p0_test/diag_project.png');

  // 6. 尝试直接通过章节API获取页面
  console.log('\n6. 直接通过网关 API 获取数据:');
  const directApi = await page.evaluate(async () => {
    const results = {};
    // 找 token
    let token = null;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const val = localStorage.getItem(key);
      if (val && val.length > 20) token = val;
    }

    if (!token) return { error: 'no token found' };

    const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

    // 获取项目详情
    try {
      const r1 = await fetch('/api/v1/projects/dfaeda8d-05fc-40e3-bcb0-039d6e43650f', { headers });
      const t1 = await r1.text();
      results.projectDetail = { status: r1.status, textStart: t1.slice(0, 200) };
    } catch(e) {
      results.projectDetail = { error: e.message };
    }

    // 获取章节
    try {
      const r2 = await fetch('/api/v1/projects/dfaeda8d-05fc-40e3-bcb0-039d6e43650f/chapters', { headers });
      const t2 = await r2.text();
      results.chapters = { status: r2.status, textStart: t2.slice(0, 200) };
    } catch(e) {
      results.chapters = { error: e.message };
    }

    return results;
  });
  console.log('   项目详情:', JSON.stringify(directApi.projectDetail));
  console.log('   章节:', JSON.stringify(directApi.chapters));

  await browser.close();
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
