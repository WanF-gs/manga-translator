/**
 * 诊断脚本：获取页面 API 数据 vs 实际图片尺寸
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';
const PROJECT_ID = 'dfaeda8d-05fc-40e3-bcb0-039d6e43650f';

async function main() {
  const browser = await chromium.launch({ 
    headless: true,
    executablePath: 'C:\\Users\\WanFi\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1223\\chrome-headless-shell-win64\\chrome-headless-shell.exe',
  });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  try {
    // Login
    const loginRes = await page.request.post('http://localhost:8080/api/v1/auth/login', {
      data: { account: '3452483881@qq.com', password: '123789' },
      headers: { 'Content-Type': 'application/json' },
    });
    const loginData = await loginRes.json();
    const token = loginData.data?.tokens?.access_token;
    
    await context.addCookies([{ name: 'manga-token', value: token, domain: 'localhost', path: '/' }]);
    await page.goto(BASE);
    await page.evaluate((tok) => {
      localStorage.setItem('manga-auth', JSON.stringify({
        state: { token: tok, user: { email: '3452483881@qq.com' } },
        version: 0,
      }));
    }, token);

    // Fetch page detail via API for page 1
    console.log('=== API 数据诊断 ===\n');
    
    // Get chapters
    const chaptersRes = await page.request.get(`http://localhost:8080/api/v1/projects/${PROJECT_ID}/chapters`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const chaptersData = await chaptersRes.json();
    const chapters = chaptersData.data || [];
    
    if (chapters.length > 0) {
      const firstChapterId = chapters[0].chapter_id;
      console.log('Chapter ID:', firstChapterId);
      console.log('Chapter pages:', chapters[0].page_count, '\n');
      
      // Get pages list
      const pagesRes = await page.request.get(`http://localhost:8080/api/v1/chapters/${firstChapterId}/pages`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const pagesData = await pagesRes.json();
      const pages = pagesData.data || [];
      
      // Get detail for first 5 pages
      for (let i = 0; i < Math.min(5, pages.length); i++) {
        const pageInfo = pages[i];
        const detailRes = await page.request.get(`http://localhost:8080/api/v1/pages/${pageInfo.page_id}`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        const detail = await detailRes.json();
        const pdata = detail.data;
        
        // Get image from page
        await page.goto(`${BASE}/pc/projects/${PROJECT_ID}`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(2000);
        
        // Click to navigate to this page
        await page.evaluate((n) => {
          const buttons = document.querySelectorAll('button');
          for (const btn of buttons) {
            if (btn.textContent && btn.textContent.includes('第' + (n+1) + '页')) {
              btn.click();
              return;
            }
          }
        }, i);
        await page.waitForTimeout(2000);
        
        const imgInfo = await page.evaluate(() => {
          const img = document.querySelector('img[alt="漫画页面"]');
          if (!img) return null;
          const cs = window.getComputedStyle(img);
          const parentCs = img.parentElement ? window.getComputedStyle(img.parentElement) : null;
          const grandParent = img.parentElement?.parentElement;
          const grandParentCs = grandParent ? window.getComputedStyle(grandParent) : null;
          return {
            naturalW: img.naturalWidth,
            naturalH: img.naturalHeight,
            attrWidth: img.getAttribute('width'),
            attrHeight: img.getAttribute('height'),
            cssWidth: cs.width,
            cssHeight: cs.height,
            rectW: img.getBoundingClientRect().width,
            rectH: img.getBoundingClientRect().height,
            parentCssW: parentCs?.width,
            parentCssH: parentCs?.height,
            parentRectW: img.parentElement?.getBoundingClientRect().width,
            parentRectH: img.parentElement?.getBoundingClientRect().height,
            gpCssW: grandParentCs?.width,
            gpCssH: grandParentCs?.height,
            gpRectW: grandParent?.getBoundingClientRect().width,
            gpRectH: grandParent?.getBoundingClientRect().height,
          };
        });
        
        console.log(`--- Page ${i+1} (${pageInfo.page_id}) ---`);
        console.log(`  API: width=${pdata?.width}, height=${pdata?.height}, status=${pdata?.status}, region_count=${(pdata?.regions || []).length}`);
        console.log(`  original_url: ${(pdata?.original_url || '').substring(0, 80)}...`);
        if (imgInfo) {
          console.log(`  Image natural: ${imgInfo.naturalW}x${imgInfo.naturalH}`);
          console.log(`  Image CSS: ${imgInfo.cssWidth} x ${imgInfo.cssHeight}`);
          console.log(`  Image rect: ${imgInfo.rectW.toFixed(1)} x ${imgInfo.rectH.toFixed(1)}`);
          console.log(`  Image attr: width=${imgInfo.attrWidth} height=${imgInfo.attrHeight}`);
          console.log(`  Parent CSS: ${imgInfo.parentCssW} x ${imgInfo.parentCssH}, rect: ${imgInfo.parentRectW?.toFixed(1)} x ${imgInfo.parentRectH?.toFixed(1)}`);
          console.log(`  GrandParent CSS: ${imgInfo.gpCssW} x ${imgInfo.gpCssH}, rect: ${imgInfo.gpRectW?.toFixed(1)} x ${imgInfo.gpRectH?.toFixed(1)}`);
          console.log(`  Ratio: natural=${(imgInfo.naturalW/imgInfo.naturalH).toFixed(4)}, css=${(parseFloat(imgInfo.cssWidth)/parseFloat(imgInfo.cssHeight)).toFixed(4)}`);
        }
        console.log('');
      }
    }
    
    await browser.close();
  } catch (err) {
    console.error('Error:', err.message);
    await browser.close();
    return 1;
  }
  return 0;
}

main().then(code => process.exit(code));
