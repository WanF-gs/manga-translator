/**
 * 强制视觉复现：在 25%/100%/200% 缩放下截图第2页、第4页
 * 测试账号: 3452483881@qq.com / 123789
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';
const PROJECT_URL = BASE + '/pc/projects/dfaeda8d-05fc-40e3-bcb0-039d6e43650f';

async function login(context, page) {
  const r = await page.request.post('http://localhost:8080/api/v1/auth/login', {
    data: { account: '3452483881@qq.com', password: '123789' },
    headers: { 'Content-Type': 'application/json' },
  });
  const d = await r.json();
  const tok = d.data?.tokens?.access_token;
  await context.addCookies([{ name: 'manga-token', value: tok, domain: 'localhost', path: '/' }]);
  await page.goto(BASE);
  await page.evaluate((t) => {
    localStorage.setItem('manga-auth', JSON.stringify({
      state: { token: t, user: { email: '3452483881@qq.com' } }, version: 0,
    }));
  }, tok);
  return tok;
}

async function setZoom(page, targetScale) {
  // Try to set zoom via clicking toolbar buttons or store mutation
  await page.evaluate((s) => {
    // First try to reset to 100% by double-clicking canvas
    const canvas = document.querySelector('[class*="flex-1 overflow-hidden flex"]');
    if (canvas) {
      canvas.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    }
  });
  await page.waitForTimeout(500);
  
  // Try to set zoom via zoom buttons or direct manipulation
  const currentScale = await page.evaluate(() => {
    const scaleEl = document.querySelector('[class*="tabular-nums"]');
    if (scaleEl) return parseInt(scaleEl.textContent) || 100;
    return 100;
  });
  console.log('  Current scale:', currentScale, '% → target:', targetScale, '%');
  
  // Click zoom buttons to adjust
  if (targetScale < currentScale) {
    const steps = Math.round((currentScale - targetScale) / 25);
    for (let i = 0; i < steps; i++) {
      await page.click('[title*="缩小"]').catch(() => {});
      await page.waitForTimeout(100);
    }
  } else if (targetScale > currentScale) {
    const steps = Math.round((targetScale - currentScale) / 25);
    for (let i = 0; i < steps; i++) {
      await page.click('[title*="放大"]').catch(() => {});
      await page.waitForTimeout(100);
    }
  }
  await page.waitForTimeout(500);
}

async function gotoPage(page, pageNum) {
  await page.evaluate((n) => {
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
      if (b.textContent && b.textContent.includes('第' + n + '页')) {
        b.click(); return;
      }
    }
  }, pageNum);
  await page.waitForTimeout(2500);
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Users\\WanFi\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1223\\chrome-headless-shell-win64\\chrome-headless-shell.exe',
  });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  try {
    await login(context, page);
    await page.goto(PROJECT_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    const testPages = [2, 4];
    const testScales = [25, 100, 200];
    
    for (const pageNum of testPages) {
      await gotoPage(page, pageNum);
      console.log('\n=== 第' + pageNum + '页 ===');
      
      for (const s of testScales) {
        await setZoom(page, s);
        
        // Get detailed info
        const info = await page.evaluate(() => {
          const img = document.querySelector('img[alt="漫画页面"]');
          if (!img) return { error: 'no img' };
          const wrapper = img.parentElement;
          const wrapperCS = wrapper ? window.getComputedStyle(wrapper) : null;
          
          // Get region overlay elements
          const overlays = document.querySelectorAll('[data-region-id]');
          const overlayInfos = [];
          overlays.forEach((el, i) => {
            if (i < 3) {
              const r = el.getBoundingClientRect();
              overlayInfos.push({
                id: el.getAttribute('data-region-id'),
                rect: { x: r.x.toFixed(0), y: r.y.toFixed(0), w: r.width.toFixed(0), h: r.height.toFixed(0) },
              });
            }
          });
          
          return {
            natW: img.naturalWidth, natH: img.naturalHeight,
            dispW: img.clientWidth, dispH: img.clientHeight,
            wrapperW: wrapper?.clientWidth, wrapperH: wrapper?.clientHeight,
            wrapperCSS: wrapperCS ? { w: wrapperCS.width, h: wrapperCS.height, transform: wrapperCS.transform } : null,
            overlayCount: overlays.length,
            overlaySamples: overlayInfos,
            scaleDisplay: document.querySelector('[class*="tabular-nums"]')?.textContent || '?',
          };
        });
        
        console.log('  缩放 ' + info.scaleDisplay + ': 图片 ' + info.natW + 'x' + info.natH + 
          ' → 显示 ' + info.dispW + 'x' + info.dispH + 
          ', 容器 ' + info.wrapperW + 'x' + info.wrapperH +
          ', 选区数=' + info.overlayCount);
        console.log('    wrapperCSS:', JSON.stringify(info.wrapperCSS));
        console.log('    选区样本:', JSON.stringify(info.overlaySamples));
        
        const fname = 'e2e/reproduce_p' + pageNum + '_s' + s + '.png';
        await page.screenshot({ path: fname, fullPage: false });
        console.log('  截图: ' + fname);
      }
    }

    await browser.close();
    console.log('\n所有截图已保存。');
  } catch (err) {
    console.error('Error:', err.message);
    try { await browser.close(); } catch(_) {}
  }
}

main().then(() => process.exit(0));
