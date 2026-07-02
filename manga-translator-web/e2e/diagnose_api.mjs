/**
 * 简化诊断：API 数据 vs 图片实际尺寸
 */
import { chromium } from 'playwright';

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
    console.log('Token:', token ? token.substring(0, 20) + '...' : 'MISSING');

    // Get project detail
    const projRes = await page.request.get('http://localhost:8080/api/v1/projects/dfaeda8d-05fc-40e3-bcb0-039d6e43650f', {
      headers: { 'Authorization': 'Bearer ' + token },
    });
    const projData = await projRes.json();
    console.log('Project:', projData.data?.name, '| status:', projRes.status());

    // Get chapters
    const chRes = await page.request.get('http://localhost:8080/api/v1/projects/dfaeda8d-05fc-40e3-bcb0-039d6e43650f/chapters', {
      headers: { 'Authorization': 'Bearer ' + token },
    });
    const chData = await chRes.json();
    console.log('Chapters status:', chRes.status(), '| count:', (chData.data || []).length);
    
    if (chData.data && chData.data.length > 0) {
      const chId = chData.data[0].chapter_id;
      console.log('First chapter:', chId);

      // Get pages - correct API path from page.ts service
      const pgRes = await page.request.get('http://localhost:8080/api/v1/pages/chapters/' + chId + '/pages', {
        headers: { 'Authorization': 'Bearer ' + token },
      });
      console.log('Pages endpoint status:', pgRes.status());
      const pgText = await pgRes.text();
      console.log('Pages body (first 500):', pgText.substring(0, 500));

      // Try page detail
      let pgData;
      try {
        pgData = JSON.parse(pgText);
      } catch(e) {
        console.log('Parse error:', e.message);
      }

      if (pgData && pgData.data) {
        const pages = Array.isArray(pgData.data) ? pgData.data : (pgData.data.items || pgData.data.pages || []);
        console.log('Pages count:', pages.length);
        
        if (pages.length > 0) {
          const firstPageId = pages[0].page_id || pages[0].id;
          console.log('First page ID:', firstPageId);
          
          const detailRes = await page.request.get('http://localhost:8080/api/v1/pages/' + firstPageId, {
            headers: { 'Authorization': 'Bearer ' + token },
          });
          const detailData = await detailRes.json();
          console.log('Page detail status:', detailRes.status());
          console.log('Page detail keys:', Object.keys(detailData.data || {}));
          console.log('Width:', detailData.data?.width, 'Height:', detailData.data?.height);
          console.log('Original URL:', detailData.data?.original_url?.substring(0, 80));
          console.log('Region count:', (detailData.data?.regions || []).length);
        }
      }
    }

    await browser.close();
  } catch (err) {
    console.error('Error:', err.message);
    try { await browser.close(); } catch(_) {}
    return 1;
  }
  return 0;
}

main().then(code => process.exit(code));
