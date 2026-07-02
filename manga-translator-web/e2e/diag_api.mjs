/**
 * 快速诊断 API 响应格式
 */
import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:3000';
const GATEWAY = 'http://localhost:8080/api/v1';
const EMAIL = '3452483881@qq.com';
const PASS = '123789';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();

  // 登录
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);
  await page.locator('input[type="email"]').first().fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASS);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(6000);
  try { await page.waitForLoadState('networkidle', { timeout: 5000 }); } catch {}
  console.log('URL:', page.url());
  console.log('Cookie:', (await page.evaluate(() => document.cookie)).slice(0, 80));

  // 通过浏览器 eval 调用 API
  const r1 = await page.evaluate(async (gw) => {
    const m = document.cookie.match(/(?:^|;\s*)manga-token=([^;]*)/);
    const token = m ? m[1] : '';
    try {
      const res = await fetch(gw + '/projects', {
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
      });
      const text = await res.text();
      return { status: res.status, text: text.slice(0, 800), isJson: text.startsWith('{') };
    } catch(e) { return { error: e.message }; }
  }, GATEWAY);
  console.log('\n=== /projects ===');
  console.log(JSON.stringify(r1, null, 2));

  // 尝试解析并提取 projectId
  let data = null;
  try { data = JSON.parse(r1.text); } catch {}
  if (data) {
    // 遍历所有可能的路径找到 projectId
    function findFirstId(obj, key) {
      if (!obj || typeof obj !== 'object') return null;
      if (obj[key]) return obj[key];
      for (const v of Object.values(obj)) {
        if (Array.isArray(v) && v.length > 0 && v[0][key]) return v[0][key];
        const r = findFirstId(v, key);
        if (r) return r;
      }
      return null;
    }
    const pid = findFirstId(data, 'project_id') || findFirstId(data, 'id');
    console.log('\nExtracted project_id:', pid);

    if (pid) {
      const r2 = await page.evaluate(async (gw) => {
        const m = document.cookie.match(/(?:^|;\s*)manga-token=([^;]*)/);
        const token = m ? m[1] : '';
        const res = await fetch(gw + '/projects/' + 'PID_PLACEHOLDER' + '/chapters', {
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
        });
        return { status: res.status, text: (await res.text()).slice(0, 800) };
      }, GATEWAY);
      // Actually replace PID in URL
      const actualR2 = await page.evaluate(async ({gw, pid}) => {
        const m = document.cookie.match(/(?:^|;\s*)manga-token=([^;]*)/);
        const token = m ? m[1] : '';
        const res = await fetch(`${gw}/projects/${pid}/chapters`, {
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
        });
        return { status: res.status, text: (await res.text()).slice(0, 800) };
      }, {gw: GATEWAY, pid});
      console.log('\n=== /projects/' + pid + '/chapters ===');
      console.log(JSON.stringify(actualR2, null, 2));
    }
  }

  await browser.close();
}

main().catch(e => console.error('FATAL:', e));
