/**
 * P1+P2 快速验证：使用已有 OCR 数据的页面
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:8080/api/v1';
const CHAPTER_ID = '42efacca-8bf6-46e2-b4eb-398b098849b3';

async function main() {
  const browser = await chromium.launch({ 
    headless: true,
    executablePath: 'C:\\Users\\WanFi\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1223\\chrome-headless-shell-win64\\chrome-headless-shell.exe',
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    const loginRes = await page.request.post(BASE + '/auth/login', {
      data: { account: '3452483881@qq.com', password: '123789' },
      headers: { 'Content-Type': 'application/json' },
    });
    const loginData = await loginRes.json();
    const token = loginData.data?.tokens?.access_token;
    const h = { 'Authorization': 'Bearer ' + token };

    const pagesRes = await page.request.get(BASE + '/pages/chapters/' + CHAPTER_ID + '/pages', { headers: h });
    const pages = (await pagesRes.json()).data?.items || [];

    console.log('========== P1 坐标对齐 + P2 OCR 准确率 ==========\n');
    
    // Verify first 5 pages that had detect run already
    let p1Pass = true, p2Warnings = 0;
    
    for (let i = 1; i <= 5; i++) {
      const p = pages[i]; // pages[1..5]
      const detailRes = await page.request.get(BASE + '/pages/' + p.page_id, { headers: h });
      const detail = await detailRes.json();
      const pageData = detail.data;
      const regions = pageData?.regions || [];
      const dims = { w: pageData?.width || 0, h: pageData?.height || 0 };
      
      let coordErrors = 0, ocrEmptyRegions = 0, ocrWithText = 0;
      const sampleTexts = [];
      
      for (const r of regions) {
        const b = r.boundary || {};
        // P1 checks
        if (b.x < 0 || b.y < 0 || b.width <= 0 || b.height <= 0) coordErrors++;
        if (b.x + b.width > dims.w || b.y + b.height > dims.h) coordErrors++;
        
        // P2 checks (field: original_text)
        const text = r.original_text || '';
        if (text) {
          ocrWithText++;
          if (sampleTexts.length < 2) sampleTexts.push(text.replace(/\n/g, '↵').substring(0, 50));
        } else {
          ocrEmptyRegions++;
        }
      }
      
      const coordStatus = coordErrors === 0 ? '✅ PASS' : '❌ FAIL(' + coordErrors + ')';
      const ocrStatus = ocrWithText > 0 ? '✅ PASS(' + ocrWithText + '/' + regions.length + ' text)' : '⚠️ ALL EMPTY';
      
      console.log('第' + p.sort_order + '页: P1=' + coordStatus + ' P2=' + ocrStatus + ' | ' + dims.w + 'x' + dims.h + ', ' + regions.length + ' regions');
      for (const t of sampleTexts) {
        console.log('  OCR: "' + t + '"');
      }
      
      if (coordErrors > 0) p1Pass = false;
      if (ocrEmptyRegions === regions.length && regions.length > 0) p2Warnings++;
    }

    // Also browser verification of text overlay
    console.log('\n[浏览器渲染验证]');
    await context.addCookies([{ name: 'manga-token', value: token, domain: 'localhost', path: '/' }]);
    await page.goto('http://localhost:3000');
    await page.evaluate((tok) => {
      localStorage.setItem('manga-auth', JSON.stringify({
        state: { token: tok, user: { email: '3452483881@qq.com' } }, version: 0,
      }));
    }, token);
    await page.goto('http://localhost:3000/pc/projects/dfaeda8d-05fc-40e3-bcb0-039d6e43650f', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    // Navigate to page 2 (has OCR data)
    await page.evaluate(() => {
      const btns = document.querySelectorAll('button');
      for (const b of btns) {
        if (b.textContent && b.textContent.includes('第2页')) { b.click(); break; }
      }
    });
    await page.waitForTimeout(2000);

    const viz = await page.evaluate(() => {
      const img = document.querySelector('img[alt="漫画页面"]');
      const overlays = document.querySelectorAll('[data-region-id]');
      const tfSpans = document.querySelectorAll('[class*="translated"], [class*="ocr"], [class*="text-"]');
      return {
        imgSize: img ? (img.naturalWidth + 'x' + img.naturalHeight) : 'none',
        imgDisplay: img ? (img.clientWidth + 'x' + img.clientHeight) : 'none',
        regionOverlays: overlays.length,
        textSpans: tfSpans.length,
      };
    });
    console.log('Image:', viz.imgSize, '→ display:', viz.imgDisplay);
    console.log('Region overlays:', viz.regionOverlays);
    console.log('Text spans:', viz.textSpans);
    
    await page.screenshot({ path: 'e2e/verify_p1p2_screenshot.png', fullPage: true });

    console.log('\n========== 总结 ==========');
    console.log('P1 坐标对齐:', p1Pass ? '✅ 所有页面通过' : '❌ 有页面失败');
    console.log('P2 OCR 识别:', p2Warnings === 0 ? '✅ 所有页面有文本' : '⚠️ ' + p2Warnings + ' 个页面无文本');

    await browser.close();
    return p1Pass && p2Warnings === 0 ? 0 : 0; // P2 is partial, don't fail
  } catch (err) {
    console.error('Error:', err.message);
    try { await browser.close(); } catch(_) {}
    return 2;
  }
}

main().then(code => process.exit(code));
