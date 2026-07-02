/**
 * OCR 深度诊断：原始 API 响应 + 后端状态
 */
import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ 
    headless: true,
    executablePath: 'C:\\Users\\WanFi\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1223\\chrome-headless-shell-win64\\chrome-headless-shell.exe',
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    const loginRes = await page.request.post('http://localhost:8080/api/v1/auth/login', {
      data: { account: '3452483881@qq.com', password: '123789' },
      headers: { 'Content-Type': 'application/json' },
    });
    const loginData = await loginRes.json();
    const token = loginData.data?.tokens?.access_token;
    const BASE = 'http://localhost:8080/api/v1';
    const h = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };

    // Test with page 2 (already has detected regions)
    const pageId = '54b3b9ae-ff18-4ddd-a51d-d3e58186bcc0';

    // 1. Get page detail BEFORE OCR
    console.log('=== BEFORE OCR ===');
    const beforeRes = await page.request.get(BASE + '/pages/' + pageId, { headers: h });
    const before = await beforeRes.json();
    console.log('Status:', before.code);
    console.log('Width:', before.data?.width, 'Height:', before.data?.height);
    console.log('Region count:', before.data?.regions?.length);
    if (before.data?.regions?.length > 0) {
      const r0 = before.data.regions[0];
      console.log('First region keys:', Object.keys(r0));
      console.log('First region:', JSON.stringify(r0, null, 2).substring(0, 500));
    }

    // 2. Run OCR
    console.log('\n=== RUNNING OCR ===');
    const ocrRes = await page.request.post(BASE + '/pages/' + pageId + '/ocr', {
      data: { language: 'ja' },
      headers: h,
      timeout: 180000,
    });
    console.log('OCR Status:', ocrRes.status());
    const ocrRaw = await ocrRes.text();
    console.log('OCR Raw Response (first 1000 chars):');
    console.log(ocrRaw.substring(0, 1000));
    
    let ocrData;
    try { ocrData = JSON.parse(ocrRaw); } catch(e) { console.log('Parse error:', e.message); }
    if (ocrData) {
      console.log('OCR code:', ocrData.code);
      console.log('OCR message:', ocrData.message);
      console.log('OCR data keys:', ocrData.data ? Object.keys(ocrData.data) : 'null');
      if (ocrData.data?.regions) {
        console.log('OCR regions count:', ocrData.data.regions.length);
        if (ocrData.data.regions.length > 0) {
          console.log('OCR first region:', JSON.stringify(ocrData.data.regions[0]).substring(0, 300));
        }
      }
      // Check ALL data fields
      if (ocrData.data) {
        console.log('OCR full data (first 500):', JSON.stringify(ocrData.data).substring(0, 500));
      }
    }

    // 3. Get page detail AFTER OCR
    console.log('\n=== AFTER OCR ===');
    const afterRes = await page.request.get(BASE + '/pages/' + pageId, { headers: h });
    const after = await afterRes.json();
    console.log('Region count:', after.data?.regions?.length);
    if (after.data?.regions?.length > 0) {
      const r0 = after.data.regions[0];
      console.log('First region keys:', Object.keys(r0));
      console.log('First region:', JSON.stringify(r0, null, 2).substring(0, 500));
    }

    // 4. Also check if there's a webhook/status endpoint
    console.log('\n=== CHECKING PAGE STATUS ===');
    console.log('Page status:', after.data?.status);
    console.log('OCR result fields:', after.data?.ocr_result ? Object.keys(after.data.ocr_result) : 'none');

    await browser.close();
  } catch (err) {
    console.error('Error:', err.message);
    try { await browser.close(); } catch(_) {}
  }
}

main().then(code => process.exit(code));
