/**
 * P1+P2 测试脚本：触发 OCR 并验证坐标对齐与识别准确率
 * 测试账号: 3452483881@qq.com / 123789
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:8080/api/v1';
const CHAPTER_ID = '42efacca-8bf6-46e2-b4eb-398b098849b3';

async function apiPost(request, path, data, token) {
  const res = await request.post(BASE + path, {
    data: data || {},
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
  });
  return { status: res.status(), data: await res.json().catch(() => null) };
}

async function apiGet(request, path, token) {
  const res = await request.get(BASE + path, {
    headers: { 'Authorization': 'Bearer ' + token },
  });
  return { status: res.status(), data: await res.json().catch(() => null) };
}

async function main() {
  const browser = await chromium.launch({ 
    headless: true,
    executablePath: 'C:\\Users\\WanFi\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1223\\chrome-headless-shell-win64\\chrome-headless-shell.exe',
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // ===== 1. Login =====
    console.log('[1] 登录...');
    const loginRes = await page.request.post(BASE + '/auth/login', {
      data: { account: '3452483881@qq.com', password: '123789' },
      headers: { 'Content-Type': 'application/json' },
    });
    const loginData = await loginRes.json();
    const token = loginData.data?.tokens?.access_token;
    console.log('   Token obtained:', token ? 'YES' : 'NO');

    // ===== 2. Get pages =====
    console.log('[2] 获取页面列表...');
    const pagesRes = await page.request.get(BASE + '/pages/chapters/' + CHAPTER_ID + '/pages', {
      headers: { 'Authorization': 'Bearer ' + token },
    });
    const pagesData = await pagesRes.json();
    const pages = pagesData.data?.items || pagesData.data || [];
    console.log('   共', pages.length, '页');

    // Select pages 2-6 for OCR testing (page 1 is double-page spread, might be problematic)
    const testPages = pages.slice(1, Math.min(6, pages.length));
    console.log('   测试页:', testPages.map(p => '第' + p.sort_order + '页(' + p.page_id.substring(0,8) + '...)').join(', '));

    // ===== 3. Trigger detect (region detection) for each test page =====
    console.log('\n[3] 开始文字区域检测...');
    const detectResults = [];
    for (const p of testPages) {
      console.log('   检测 第' + p.sort_order + '页 (' + p.page_id + ')...');
      const detectRes = await page.request.post(BASE + '/pages/' + p.page_id + '/detect', {
        data: {},
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        timeout: 120000,
      });
      const detectData = await detectRes.json().catch(() => null);
      const regionCount = detectData?.data?.detected_count || (detectData?.data?.regions || []).length;
      console.log('   结果: status=' + detectRes.status() + ', 检测到 ' + regionCount + ' 个区域');
      detectResults.push({ pageId: p.page_id, pageNum: p.sort_order, status: detectRes.status(), regionCount });
    }

    // ===== 4. Trigger OCR for each test page =====
    console.log('\n[4] 开始 OCR 识别...');
    const ocrResults = [];
    for (const p of testPages) {
      console.log('   OCR 第' + p.sort_order + '页 (' + p.page_id + ')...');
      const ocrRes = await page.request.post(BASE + '/pages/' + p.page_id + '/ocr', {
        data: { language: 'ja' },
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        timeout: 180000,
      });
      const ocrData = await ocrRes.json().catch(() => null);
      const ocrRegions = ocrData?.data?.regions || [];
      console.log('   结果: status=' + ocrRes.status() + ', OCR区域数=' + ocrRegions.length);
      if (ocrRegions.length > 0) {
        const sample = ocrRegions[0];
        console.log('   样本: region_id=' + sample.region_id + ', text="' + (sample.text || '').substring(0, 40) + '", confidence=' + sample.confidence);
      }
      ocrResults.push({ pageId: p.page_id, pageNum: p.sort_order, status: ocrRes.status(), regions: ocrRegions });
    }

    // ===== 5. Get page detail with OCR results =====
    console.log('\n[5] 验证 OCR 结果与坐标...');
    const verifyResults = [];
    for (const p of testPages) {
      const detailRes = await page.request.get(BASE + '/pages/' + p.page_id, {
        headers: { 'Authorization': 'Bearer ' + token },
      });
      const detail = await detailRes.json();
      const pageData = detail.data;
      const regions = pageData?.regions || [];
      const dims = { width: pageData?.width || 0, height: pageData?.height || 0 };
      
      console.log('\n   --- 第' + p.sort_order + '页 ---');
      console.log('   页面尺寸: ' + dims.width + 'x' + dims.height + ', 区域数: ' + regions.length);
      
      let coordIssues = 0;
      let ocrIssues = 0;
      
      for (const r of regions) {
        const b = r.boundary || {};
        // P1: Check coordinate boundaries
        if (b.x < 0 || b.y < 0 || b.width <= 0 || b.height <= 0) {
          coordIssues++;
          console.log('   P1-坐标异常: region=' + r.region_id + ' boundary=' + JSON.stringify(b));
        }
        if (b.x + b.width > dims.width || b.y + b.height > dims.height) {
          coordIssues++;
          console.log('   P1-越界: region=' + r.region_id + ' x+' + b.width + '=' + (b.x + b.width) + ' > ' + dims.width);
        }
        
        // P2: Check OCR text quality
        const ocrText = r.ocr_result?.text || r.text || '';
        const confidence = r.ocr_result?.confidence || r.confidence || 0;
        if (!ocrText && regions.length > 0) {
          ocrIssues++;
          console.log('   P2-空文本: region=' + r.region_id);
        }
        if (ocrText && ocrText.length < 2 && confidence > 0.5) {
          // Very short text might be actual (e.g., "!"), so just note it
        }
      }
      
      // Show first 3 regions detail
      for (let i = 0; i < Math.min(3, regions.length); i++) {
        const r = regions[i];
        const b = r.boundary || {};
        const text = r.ocr_result?.text || r.text || '(空)';
        const conf = r.ocr_result?.confidence || r.confidence || 0;
        console.log('   Region ' + (i+1) + ': id=' + r.region_id + 
          ', boundary={' + b.x + ',' + b.y + ',' + b.width + ',' + b.height + '}' +
          ', text="' + text.substring(0, 30) + '", conf=' + conf);
      }
      
      verifyResults.push({
        pageId: p.page_id, pageNum: p.sort_order,
        dimensions: dims, regionCount: regions.length,
        coordIssues, ocrIssues,
      });
    }

    // ===== 6. Summary =====
    console.log('\n========== P1+P2 验证汇总 ==========');
    for (const vr of verifyResults) {
      const p1Status = vr.coordIssues === 0 ? 'PASS' : ('FAIL(' + vr.coordIssues + ' issues)');
      const p2Status = vr.ocrIssues === 0 ? 'PASS' : ('FAIL(' + vr.ocrIssues + ' issues)');
      console.log('第' + vr.pageNum + '页: P1=' + p1Status + ' P2=' + p2Status + 
        ' | ' + vr.regionCount + ' regions, ' + vr.dimensions.width + 'x' + vr.dimensions.height);
    }

    await browser.close();
    const totalCoordIssues = verifyResults.reduce((s, v) => s + v.coordIssues, 0);
    const totalOcrIssues = verifyResults.reduce((s, v) => s + v.ocrIssues, 0);
    return totalCoordIssues === 0 && totalOcrIssues === 0 ? 0 : 1;
  } catch (err) {
    console.error('Error:', err.message);
    try { await browser.close(); } catch(_) {}
    return 2;
  }
}

main().then(code => process.exit(code));
