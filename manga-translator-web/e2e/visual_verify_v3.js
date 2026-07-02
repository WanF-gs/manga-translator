/**
 * 视觉验收脚本 v3 — 像素坐标系架构验证
 * 25%/100%/200% 缩放，第2页+第4页截图
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3000';
const BACKEND_URL = 'http://localhost:8080';
const CRUM = 'C:/Users/WanFi/AppData/Local/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-win64/chrome-headless-shell.exe';
const OUT = path.resolve(__dirname, 'screenshots_v3');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

async function login() {
  const r = await fetch(BACKEND_URL + '/api/v1/auth/login', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({account:'3452483881@qq.com',password:'123789'}),
  });
  const d = await r.json();
  return d?.data?.tokens?.access_token || d?.data?.token || null;
}

async function getProjects(token) {
  const r = await fetch(BACKEND_URL + '/api/v1/projects', {
    headers: {'Authorization':'Bearer '+token},
  });
  const d = await r.json();
  const items = d?.data?.items || [];
  return items;
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('=== 视觉验收 v3: 像素坐标系架构 ===\n');

  // 1. API login
  console.log('[1] API登录...');
  const token = await login();
  if (!token) { console.log('登录失败!'); return; }
  console.log('  token:', token.substring(0,25)+'...');

  // 2. Get projects
  console.log('[2] 获取项目...');
  const projects = await getProjects(token);
  if (!projects.length) { console.log('无项目!'); return; }
  const projectId = projects[0].project_id;
  console.log(`  ${projects[0].name} (${projectId})`);

  // 3. Browser setup with cookie-based auth
  console.log('[3] 启动浏览器...');
  const browser = await chromium.launch({ headless: true, executablePath: CRUM, args: ['--no-sandbox'] });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    storageState: undefined,
  });

  // Set manga-token cookie (required by Next.js middleware)
  await context.addCookies([{
    name: 'manga-token',
    value: token,
    domain: 'localhost',
    path: '/',
    httpOnly: false,
    secure: false,
    sameSite: 'Lax',
  }]);

  const page = await context.newPage();

  // 4. Navigate to editor
  console.log('[4] 导航编辑器...');
  await page.goto(`${BASE_URL}/pc/projects/${projectId}`, { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(5000);
  console.log('  URL:', page.url());

  // 5. Wait for regions
  console.log('[5] 等待选区...');
  let rc = 0;
  try {
    await page.waitForSelector('div.absolute.rounded-md', { timeout: 20000 });
    rc = await page.$$eval('div.absolute.rounded-md', els => els.length);
  } catch { console.log('  超时'); }
  console.log(`  选区: ${rc}`);

  if (rc === 0) {
    // Maybe we're on a page with no OCR yet. Let's check page data.
    const pageData = await page.evaluate(() => {
      // Check localStorage for any cached data
      const reactQuery = window.localStorage.getItem('REACT_QUERY_OFFLINE_CACHE');
      return reactQuery ? reactQuery.substring(0, 200) : 'no cache';
    }).catch(() => 'error');
    console.log('  cache:', pageData);

    // Try waiting longer and checking console
    console.log('  尝试额外等待...');
    await sleep(5000);
    rc = await page.$$eval('div.absolute.rounded-md', els => els.length).catch(() => 0);
    console.log(`  选区: ${rc}`);
  }

  // 6. Screenshots
  console.log('[6] 截图...');

  for (const pn of [2, 4]) {
    console.log(`\n--- 第${pn}页 ---`);

    // Click page
    const btns = await page.$$('button, [role="button"], a');
    let clicked = false;
    for (const b of btns) {
      try {
        const t = await b.textContent();
        if (t && t.includes(`第${pn}页`)) { await b.click(); clicked = true; break; }
      } catch {}
    }
    if (!clicked) console.log('  未找到页面按钮');

    await sleep(3000);
    rc = await page.$$eval('div.absolute.rounded-md', els => els.length).catch(() => 0);
    console.log(`  选区: ${rc}`);

    for (const z of [25, 100, 200]) {
      console.log(`  z${z}%`);

      // Reset zoom
      const allB = await page.$$('button');
      for (const b of allB) {
        if ((await b.getAttribute('title')||'').includes('重置')) { await b.click(); await sleep(500); break; }
      }

      // Zoom
      if (z < 100) {
        for (const b of allB) {
          if ((await b.getAttribute('title')||'').includes('缩小')) {
            for (let i = 0; i < Math.round((100-z)/25); i++) { await b.click(); await sleep(200); }
            break;
          }
        }
      } else if (z > 100) {
        for (const b of allB) {
          if ((await b.getAttribute('title')||'').includes('放大')) {
            for (let i = 0; i < Math.round((z-100)/25); i++) { await b.click(); await sleep(200); }
            break;
          }
        }
      }
      await sleep(1500);

      let dz = '?';
      try { dz = await page.$eval('[class*="tabular-nums"]', el=>el.textContent||''); } catch {}
      console.log(`    显示: ${dz}`);

      await page.screenshot({ path: path.join(OUT, `p${pn}_z${z}.png`), fullPage: false });

      // Region positions
      const d = await page.$$eval('div.absolute.rounded-md', els => els.slice(0,5).map(el=>{
        const s=el.getAttribute('style')||'';
        return {
          l:s.match(/left:\s*([\d.]+)px/) ? Math.round(Number(s.match(/left:\s*([\d.]+)px/)[1])) : -1,
          t:s.match(/top:\s*([\d.]+)px/) ? Math.round(Number(s.match(/top:\s*([\d.]+)px/)[1])) : -1,
          w:s.match(/width:\s*([\d.]+)px/) ? Math.round(Number(s.match(/width:\s*([\d.]+)px/)[1])) : -1,
          h:s.match(/height:\s*([\d.]+)px/) ? Math.round(Number(s.match(/height:\s*([\d.]+)px/)[1])) : -1,
          txt: (el.querySelector('span')?.textContent||'').substring(0,20),
        };
      })).catch(()=>[]);
      console.log(`    位: ${JSON.stringify(d).substring(0,350)}`);
      console.log('    OK');
    }
  }

  // 7. Switch test
  console.log('\n[7] 10页切换...');
  let ok=0;
  for (let i=0;i<10;i++){
    try {
      const bts=await page.$$('button');
      for(const b of bts){
        if((await b.getAttribute('title')||'').includes('下一页')){await b.click();await sleep(1000);break;}
      }
      const c=await page.$$eval('div.absolute.rounded-md',els=>els.length).catch(()=>0);
      console.log(`  切${i+1}: ${c}选区`);
      if(c>0)ok++;
    }catch(e){console.log(`  切${i+1}: ${e.message}`);}
  }
  console.log(`  成功: ${ok}/10`);

  await page.screenshot({ path: path.join(OUT, 'final.png'), fullPage: false });
  await browser.close();
  console.log(`\n=== 完成: ${OUT} ===`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
