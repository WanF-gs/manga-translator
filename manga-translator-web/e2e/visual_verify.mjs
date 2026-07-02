/**
 * 真实视觉验收：等待数据加载，截图三个缩放比例
 * 页面2、页面4, 缩放25%/100%/200%
 */
import { chromium } from 'playwright';

const PROJECT = 'http://localhost:3000/pc/projects/dfaeda8d-05fc-40e3-bcb0-039d6e43650f';

async function login(context, page) {
  const r = await page.request.post('http://localhost:8080/api/v1/auth/login', {
    data: { account: '3452483881@qq.com', password: '123789' },
    headers: { 'Content-Type': 'application/json' },
  });
  const d = await r.json();
  const tok = d.data?.tokens?.access_token;
  await context.addCookies([{ name: 'manga-token', value: tok, domain: 'localhost', path: '/' }]);
  await page.goto('http://localhost:3000');
  await page.evaluate((t) => {
    localStorage.setItem('manga-auth', JSON.stringify({
      state: { token: t, user: { email: '3452483881@qq.com' } }, version: 0,
    }));
  }, tok);
}

async function waitForRegions(page, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    // RegionRect renders div.absolute.rounded-md with percentage left/top
    const count = await page.evaluate(() => {
      const all = document.querySelectorAll('div.absolute.rounded-md');
      let c = 0;
      all.forEach(el => {
        const s = el.getAttribute('style') || '';
        if (s.includes('%') && (s.includes('left:') || s.includes('top:'))) c++;
      });
      return c;
    });
    if (count > 0) return count;
    await page.waitForTimeout(500);
  }
  return 0;
}

async function gotoPageAndWait(page, pageNum) {
  // Click page button
  const clicked = await page.evaluate((n) => {
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
      if (b.textContent && b.textContent.includes('第' + n + '页')) {
        b.click(); return true;
      }
    }
    // Fallback: try sidebar items
    const items = document.querySelectorAll('[class*="thumb"], [class*="page-item"], li button');
    if (items.length >= n) { items[n-1].click(); return true; }
    return false;
  }, pageNum);
  
  await page.waitForTimeout(3000);
  
  // Wait for regions to load
  const regions = await waitForRegions(page);
  console.log('  第' + pageNum + '页: 选区数=' + regions, clicked ? '(点击成功)' : '(点击可能失败)');
  return regions;
}

async function setZoomByClick(page, targetPercent) {
  // Reset to 100% first
  await page.evaluate(() => {
    const reset = document.querySelector('[title*="重置"]');
    if (reset) reset.click();
  });
  await page.waitForTimeout(500);
  
  // Get current scale
  let current = await page.evaluate(() => {
    const el = document.querySelector('[class*="tabular-nums"]');
    return el ? parseInt(el.textContent) : 100;
  });
  
  // Click zoom buttons
  while (current > targetPercent + 5) {
    const btn = await page.$('[title*="缩小"]');
    if (btn) { await btn.click(); current -= 25; await page.waitForTimeout(200); }
    else break;
  }
  while (current < targetPercent - 5) {
    const btn = await page.$('[title*="放大"]');
    if (btn) { await btn.click(); current += 25; await page.waitForTimeout(200); }
    else break;
  }
  
  // Verify
  const final = await page.evaluate(() => {
    const el = document.querySelector('[class*="tabular-nums"]');
    return el ? parseInt(el.textContent) : -1;
  });
  console.log('  缩放:', final + '%');
  await page.waitForTimeout(500);
}

async function getRegionDetail(page) {
  return page.evaluate(() => {
    const img = document.querySelector('img[alt="漫画页面"]');
    const wrapper = img?.parentElement;
    
    // RegionRect uses div.absolute.rounded-md with percentage positioning
    const rects = document.querySelectorAll('div.absolute.rounded-md');
    const regionData = [];
    rects.forEach((el, i) => {
      const style = el.getAttribute('style') || '';
      if (!style.includes('%')) return; // not a region
      if (i >= 5) return;
      const rect = el.getBoundingClientRect();
      regionData.push({
        idx: i,
        style: style.substring(0, 80),
        rect: { x: rect.x.toFixed(0), y: rect.y.toFixed(0), w: rect.width.toFixed(0), h: rect.height.toFixed(0) },
      });
    });
    
    return {
      imgNat: img ? (img.naturalWidth + 'x' + img.naturalHeight) : 'none',
      imgDisp: img ? (img.clientWidth + 'x' + img.clientHeight) : 'none',
      wrapperSize: wrapper ? (wrapper.clientWidth + 'x' + wrapper.clientHeight) : 'none',
      regionElements: regionData.length,
      regionSamples: regionData,
    };
  });
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Users\\WanFi\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1223\\chrome-headless-shell-win64\\chrome-headless-shell.exe',
  });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  try {
    console.log('登录...');
    await login(context, page);
    
    console.log('进入项目...');
    await page.goto(PROJECT, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    const pages = [2, 4];
    const scales = [25, 100, 200];
    
    for (const pn of pages) {
      const regCount = await gotoPageAndWait(page, pn);
      
      if (regCount === 0) {
        console.log('  ⚠️ 页面无选区数据，尝试等待更久...');
        await page.waitForTimeout(5000);
      }
      
      for (const s of scales) {
        await setZoomByClick(page, s);
        
        const detail = await getRegionDetail(page);
        console.log('  缩放' + s + '%: img=' + detail.imgNat + '→' + detail.imgDisp + 
          ', wrapper=' + detail.wrapperSize + ', regions=' + detail.regionElements);
        for (const r of detail.regionSamples) {
          console.log('    region[' + r.idx + ']: ' + JSON.stringify(r));
        }
        
        const fname = 'e2e/vv_p' + pn + '_s' + s + '.png';
        await page.screenshot({ path: fname, fullPage: false });
        console.log('  📷 ' + fname);
      }
    }
    
    console.log('\n全部截图完成');
    await browser.close();
  } catch (err) {
    console.error('Error:', err.message);
    try { await browser.close(); } catch(_) {}
  }
}

main().then(() => process.exit(0));
