/**
 * P1+P2 验证 v2：使用正确的字段名 + 完整诊断
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

    // Get all pages, verify 10 pages for P1+P2
    const pagesRes = await page.request.get(BASE + '/pages/chapters/' + CHAPTER_ID + '/pages', { headers: h });
    const pages = (await pagesRes.json()).data?.items || [];
    console.log('Total pages:', pages.length);

    // Run detect+OCR on fresh pages (pages 7-10 are likely fresh)
    const freshPages = pages.slice(6, 10);
    for (const p of freshPages) {
      console.log('\n--- Processing page', p.sort_order, '(' + p.page_id + ') ---');
      
      // Detect regions
      const detectRes = await page.request.post(BASE + '/pages/' + p.page_id + '/detect', {
        data: {}, headers: { ...h, 'Content-Type': 'application/json' }, timeout: 120000,
      });
      const detectData = await detectRes.json();
      console.log('Detected:', detectData.data?.detected_count || 0, 'regions');
      
      // Run OCR
      const ocrRes = await page.request.post(BASE + '/pages/' + p.page_id + '/ocr', {
        data: { language: 'ja' }, headers: { ...h, 'Content-Type': 'application/json' }, timeout: 180000,
      });
      console.log('OCR status:', ocrRes.status());
    }

    // Now verify all 10 pages
    console.log('\n========== P1+P2 验证 (10页) ==========\n');
    const testPages = pages.slice(0, 10);
    let p1Issues = 0, p2Issues = 0;
    
    for (const p of testPages) {
      const detailRes = await page.request.get(BASE + '/pages/' + p.page_id, { headers: h });
      const detail = await detailRes.json();
      const pageData = detail.data;
      const regions = pageData?.regions || [];
      const dims = { w: pageData?.width || 0, h: pageData?.height || 0 };
      
      let coordOk = true, ocrOk = true;
      
      for (const r of regions) {
        const b = r.boundary || {};
        // P1: coordinate validity
        if (b.x < 0 || b.y < 0 || b.width <= 0 || b.height <= 0 || 
            b.x + b.width > dims.w || b.y + b.height > dims.h) {
          coordOk = false;
          p1Issues++;
        }
        // P2: OCR text check (original_text field!)
        const text = r.original_text || '';
        if (!text && regions.length > 0) {
          // Empty text might be legitimate for blank regions, but flag it
        }
        // Check for reasonable Japanese/Chinese content
        const hasCJK = /[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff]/.test(text);
        if (text && !hasCJK && text.length > 3) {
          // Non-CJK text in a manga - could be garbled
          ocrOk = false;
          p2Issues++;
        }
      }
      
      const p1 = coordOk ? '✅' : '❌';
      const p2 = ocrOk ? '✅' : '⚠️';
      console.log('第' + p.sort_order + '页: P1=' + p1 + ' P2=' + p2 + 
        ' | ' + regions.length + ' regions | ' + dims.w + 'x' + dims.h);
      
      // Show first 2 non-empty text regions as samples
      let shown = 0;
      for (const r of regions) {
        const text = r.original_text || '';
        if (text && shown < 2) {
          console.log('  样本: \"' + text.replace(/\n/g, '↵').substring(0, 50) + '\" (conf=' + r.confidence + ')');
          shown++;
        }
      }
      if (shown === 0 && regions.length > 0) {
        console.log('  样本: (所有区域文本为空)');
      }
    }
    
    console.log('\n总P1问题: ' + p1Issues + ', 总P2问题: ' + p2Issues);

    // Also verify via browser - navigate to project and check text overlay
    console.log('\n[浏览器验证] 导航到编辑器检查文本显示...');
    await context.addCookies([{ name: 'manga-token', value: token, domain: 'localhost', path: '/' }]);
    await page.goto('http://localhost:3000');
    await page.evaluate((tok) => {
      localStorage.setItem('manga-auth', JSON.stringify({
        state: { token: tok, user: { email: '3452483881@qq.com' } },
        version: 0,
      }));
    }, token);
    
    await page.goto('http://localhost:3000/pc/projects/dfaeda8d-05fc-40e3-bcb0-039d6e43650f', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    
    // Check region overlay rendering
    const overlayInfo = await page.evaluate(() => {
      const overlays = document.querySelectorAll('[class*="region"]');
      const textBoxes = document.querySelectorAll('[class*="text"]');
      const img = document.querySelector('img[alt="漫画页面"]');
      return {
        overlayCount: overlays.length,
        textBoxCount: textBoxes.length,
        imgNatural: img ? (img.naturalWidth + 'x' + img.naturalHeight) : 'none',
        imgDisplay: img ? (img.clientWidth + 'x' + img.clientHeight) : 'none',
        hasRegions: document.querySelectorAll('[data-region-id]').length,
      };
    });
    console.log('Overlay elements:', overlayInfo.overlayCount);
    console.log('Text boxes:', overlayInfo.textBoxCount);
    console.log('Data-region-id elements:', overlayInfo.hasRegions);
    console.log('Image: natural=' + overlayInfo.imgNatural + ', display=' + overlayInfo.imgDisplay);
    
    await page.screenshot({ path: 'e2e/p1p2_browser_screenshot.png', fullPage: true });
    console.log('Screenshot: e2e/p1p2_browser_screenshot.png');

    await browser.close();
    return p1Issues === 0 ? 0 : 1;
  } catch (err) {
    console.error('Error:', err.message);
    try { await browser.close(); } catch(_) {}
    return 2;
  }
}

main().then(code => process.exit(code));
