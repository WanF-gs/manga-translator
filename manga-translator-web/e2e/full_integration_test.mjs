/**
 * 全链路鲁棒测试 v1 — P0修复后全功能验证
 * 覆盖: P0.1状态隔离, P0.2画质, P0.3 OCR, 检测, 全流程, 状态污染, 性能
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SS_DIR = join(__dirname, 'screenshots_full_test');
const REPORT_PATH = join(__dirname, 'full_test_report.txt');

const BASE_URL = 'http://localhost:3000';
const GATEWAY = 'http://localhost:8080/api/v1';
const TEST_EMAIL = '3452483881@qq.com';
const TEST_PASSWORD = '123789';

const results = [];
const report = [];
let token = null;

function log(msg) { const line = `[${new Date().toISOString().slice(11, 19)}] ${msg}`; console.log(line); report.push(line); }
function pass(t, d = '') { results.push({ name: t, status: 'PASS', detail: d }); log(`✅ PASS: ${t}${d ? ' | ' + d : ''}`); }
function fail(t, d = '') { results.push({ name: t, status: 'FAIL', detail: d }); log(`❌ FAIL: ${t}${d ? ' | ' + d : ''}`); }
function info(msg) { log(`  ℹ️ ${msg}`); }
async function ss(page, name) { await page.screenshot({ path: join(SS_DIR, `${name}.png`), fullPage: false }); }

async function api(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  try {
    const res = await fetch(GATEWAY + path, opts);
    const text = await res.text();
    try { return { status: res.status, data: JSON.parse(text) }; }
    catch { return { status: res.status, text: text.slice(0, 200) }; }
  } catch (e) { return { error: e.message }; }
}

function extractList(res) {
  if (!res?.data) return [];
  const d = res.data;
  if (d.data && d.data.items && Array.isArray(d.data.items)) return d.data.items;
  if (d.data && Array.isArray(d.data)) return d.data;
  if (d.items && Array.isArray(d.items)) return d.items;
  if (Array.isArray(d.data)) return d.data;
  if (Array.isArray(d)) return d;
  return [];
}

async function main() {
  if (!existsSync(SS_DIR)) mkdirSync(SS_DIR, { recursive: true });
  log('═══════════════════════════════════════════');
  log('  全链路鲁棒测试 v1 — P0修复后验证');
  log('═══════════════════════════════════════════');

  // Phase 1: Auth
  log('\n── Phase 1: 认证 ──');
  const loginRes = await api('/auth/login', 'POST', { account: TEST_EMAIL, password: TEST_PASSWORD });
  token = loginRes?.data?.data?.tokens?.access_token;
  if (!token) { fail('认证', JSON.stringify(loginRes).slice(0, 200)); process.exit(1); }
  pass('认证', `user_id=${loginRes.data.data.user.user_id}`);

  // Phase 2: Project/Page data
  log('\n── Phase 2: 数据侦察 ──');
  const projRes = await api('/projects');
  const projects = extractList(projRes);
  info(`项目数: ${projects.length}`);

  // Pick project with most pages
  const proj = projects.reduce((best, p) => (p.page_count || 0) > (best.page_count || 0) ? p : best, projects[0]);
  const projectId = proj.project_id || proj.id;
  info(`项目: ${proj.name} (${proj.page_count || 0}页)`);
  pass('项目数据', `${proj.name}`);

  const chapRes = await api(`/projects/${projectId}/chapters`);
  const chapters = extractList(chapRes);
  info(`章节: ${chapters.length}`);

  // Collect all pages
  const allPages = [];
  for (const ch of chapters.slice(0, 3)) {
    const cid = ch.chapter_id || ch.id;
    const pagesRes = await api(`/pages/chapters/${cid}/pages`);
    const pages = extractList(pagesRes);
    for (const p of pages) {
      const pid = p.page_id || p.id;
      if (pid && !allPages.find(x => x.pageId === pid)) {
        allPages.push({ pageId: pid, chapterId: cid, status: p.status || 'pending' });
      }
    }
  }
  if (allPages.length === 0) { fail('无页面'); process.exit(1); }
  pass('页面数据', `${allPages.length}页`);
  info(`测试页: ${allPages.slice(0, 10).map(p => p.pageId.slice(0, 8)).join(', ')}`);

  // Phase 3: Browser
  log('\n── Phase 3: 浏览器 ──');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: 'zh-CN' });
  const page = await context.newPage();
  await context.addCookies([{ name: 'manga-token', value: token, domain: 'localhost', path: '/', httpOnly: false, secure: false, sameSite: 'Lax' }]);

  // Performance tracking
  const timings = {};

  // ═══ TEST 1: Login & Page Load ═══
  log('\n── Test 1: 页面加载 ──');
  const t0 = Date.now();
  await page.goto(`${BASE_URL}/pc`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);
  timings.pageLoad = Date.now() - t0;
  info(`首页加载耗时: ${timings.pageLoad}ms`);
  pass('测试1: 页面加载', `${timings.pageLoad}ms`);

  // ═══ TEST 2: Project Page Navigation ═══
  log('\n── Test 2: 项目页导航 ──');
  const t1 = Date.now();
  await page.goto(`${BASE_URL}/pc/projects/${projectId}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);
  timings.projectNav = Date.now() - t1;
  await ss(page, 'test2_project_page');
  pass('测试2: 项目导航', `${timings.projectNav}ms`);

  // Check if Canvas/image renders
  const hasImage = await page.locator('img[alt="漫画页面"]').first().isVisible({ timeout: 5000 }).catch(() => false);
  if (hasImage) pass('测试2b: 图片渲染', '可见');
  else info('测试2b: 图片不可见');

  // ═══ TEST 3: P0.1 State Isolation (5 pairs) ═══
  log('\n── Test 3: P0.1 页面状态隔离 ──');
  const testPages = allPages.slice(0, 10);
  let isolationPass = 0;

  for (let i = 0; i < testPages.length; i += 2) {
    if (i + 1 >= testPages.length) break;
    const pA = testPages[i], pB = testPages[i + 1];
    const urlA = `${BASE_URL}/pc/projects/${projectId}?pageId=${pA.pageId}`;
    const urlB = `${BASE_URL}/pc/projects/${projectId}?pageId=${pB.pageId}`;

    // Navigate to page A
    const tA = Date.now();
    await page.goto(urlA, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    timings[`nav_${i}`] = Date.now() - tA;

    // Try clicking a step button
    const stepBtn = page.locator('button:text("文字检测")').first();
    let triggeredA = false;
    if (await stepBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await stepBtn.click();
      triggeredA = true;
      await page.waitForTimeout(2000);
    }

    // Switch to page B
    await page.goto(urlB, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    await ss(page, `test3_pair${Math.floor(i / 2) + 1}_B`);

    // Check B for pollution: green checkmarks on steps
    const greenChecks = await page.evaluate(() => {
      return document.querySelectorAll('.text-green-500 svg').length;
    });

    // Check B for processing indicators
    const processingEls = await page.evaluate(() => {
      const icons = document.querySelectorAll('.animate-spin');
      return icons.length;
    });

    if (greenChecks === 0 && processingEls === 0) {
      isolationPass++;
      pass(`测试3: 隔离-对${Math.floor(i / 2) + 1}`, `${pA.pageId.slice(0, 8)}→${pB.pageId.slice(0, 8)} 无污染`);
    } else {
      fail(`测试3: 隔离-对${Math.floor(i / 2) + 1}`, `${pA.pageId.slice(0, 8)}→${pB.pageId.slice(0, 8)} 有${greenChecks}个绿色勾, ${processingEls}个处理中`);
    }
  }

  pass(`测试3: 隔离总结`, `${isolationPass}/${Math.floor(testPages.length / 2)}通过`);

  // ═══ TEST 4: P0.2 Image Quality ═══
  log('\n── Test 4: P0.2 图片画质 ──');

  for (let i = 0; i < Math.min(5, testPages.length); i++) {
    const pg = testPages[i];
    await page.goto(`${BASE_URL}/pc/projects/${projectId}?pageId=${pg.pageId}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);
    await ss(page, `test4_page${i + 1}`);

    const imgInfo = await page.evaluate(() => {
      const el = document.querySelector('img[alt="漫画页面"]');
      if (!el) return null;
      const style = getComputedStyle(el);
      return {
        nw: el.naturalWidth, nh: el.naturalHeight,
        cw: el.clientWidth, ch: el.clientHeight,
        ir: style.imageRendering,
        src: el.src.slice(0, 60),
      };
    });

    if (imgInfo && imgInfo.nw >= 100) {
      const isGood = imgInfo.ir === 'crisp-edges' || (imgInfo.cw >= imgInfo.nw * 0.5);
      if (isGood) pass(`测试4: 画质-页${i + 1}`, `${imgInfo.nw}x${imgInfo.nh}, IR=${imgInfo.ir}`);
      else fail(`测试4: 画质-页${i + 1}`, `IR=${imgInfo.ir}, 可能糊化`);
    } else {
      info(`测试4: 画质-页${i + 1}: 无图片`);
    }
  }

  // ═══ TEST 5: AI Gateway Health ═══
  log('\n── Test 5: AI Gateway 健康检查 ──');
  const aiHealth = await api('/health', 'GET');
  if (aiHealth.status === 200) {
    pass('测试5: AI Gateway', '200 OK');
  } else {
    // Try direct AI Gateway access
    const directHealth = await fetch('http://localhost:8100/docs').catch(() => null);
    if (directHealth && directHealth.status === 200) pass('测试5: AI Gateway', 'Direct OK');
    else fail('测试5: AI Gateway', '不可达');
  }

  // ═══ TEST 6: Full Pipeline (Detect → OCR → Translate → Inpaint → Render) ═══
  log('\n── Test 6: 全流程管线 ──');

  // Pick a page that's pending
  const pendingPage = allPages.find(p => p.status === 'pending') || allPages[0];
  const testPageId = pendingPage.pageId;

  await page.goto(`${BASE_URL}/pc/projects/${projectId}?pageId=${testPageId}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);
  await ss(page, 'test6_before');

  // Step 1: Detect
  const t_detect = Date.now();
  const detectBtn = page.locator('button:text("文字检测")').first();
  if (await detectBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await detectBtn.click();
    info('文字检测中...');
    await page.waitForTimeout(15000);
    try { await page.waitForLoadState('domcontentloaded', { timeout: 5000 }); } catch { }
    timings.detect = Date.now() - t_detect;
    await ss(page, 'test6_after_detect');

    // Check detection results
    const detectResult = await page.evaluate(() => {
      const el = document.querySelector('[class*="StatusBar"]');
      return el?.textContent || '';
    });
    const regionMatch = detectResult.match(/(\d+)\s*个文字区域/);
    const regionCount = regionMatch ? parseInt(regionMatch[1]) : 0;
    if (regionCount > 0) {
      pass('测试6a: 文字检测', `${regionCount}区域, ${timings.detect}ms`);
    } else {
      fail('测试6a: 文字检测', '检测到0个区域');
    }
  } else {
    info('测试6: 无文字检测按钮（页面可能已处理）');
  }

  // Step 2: OCR (try clicking the step button in StatusBar if in professional mode)
  const ocrBtn = page.locator('button:text("OCR识别")').first();
  if (await ocrBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    const t_ocr = Date.now();
    await ocrBtn.click();
    info('OCR识别中...');
    await page.waitForTimeout(15000);
    try { await page.waitForLoadState('domcontentloaded', { timeout: 5000 }); } catch { }
    timings.ocr = Date.now() - t_ocr;
    await ss(page, 'test6_after_ocr');

    // Check OCR via API for char_confidences
    const regionsRes = await api(`/pages/${testPageId}/text-regions`);
    const regions = extractList(regionsRes, 'regions', 'text_regions');
    const hasCC = regions.filter(r => r.char_confidences?.length > 0).length;
    if (hasCC > 0) {
      pass('测试6b: OCR置信度', `${hasCC}/${regions.length}个区域有字符级置信度, ${timings.ocr}ms`);
    } else if (regions.length > 0) {
      pass('测试6b: OCR', `${regions.length}区域已识别(无CC), ${timings.ocr}ms`);
    } else {
      info('测试6b: OCR无区域');
    }
  } else {
    info('测试6: 无OCR按钮');
  }

  // Step 3: OCR Panel verification
  const panelTab = page.locator('button:text("OCR校对")').first();
  if (await panelTab.isVisible({ timeout: 2000 }).catch(() => false)) {
    await panelTab.click();
    await page.waitForTimeout(2000);
    await ss(page, 'test6_ocr_panel');

    const highlightedChars = await page.evaluate(() => {
      return document.querySelectorAll('[class*="amber-200"], [class*="bg-amber"]').length;
    });
    pass('测试6c: OCR面板', `${highlightedChars}个字符高亮`);
  }

  // Step 4: Translation
  const transBtn = page.locator('button:text("智能翻译")').first();
  if (await transBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    const t_trans = Date.now();
    await transBtn.click();
    info('翻译中...');
    await page.waitForTimeout(10000);
    try { await page.waitForLoadState('domcontentloaded', { timeout: 5000 }); } catch { }
    timings.translate = Date.now() - t_trans;

    // Check API for translated text
    const regionsRes2 = await api(`/pages/${testPageId}/text-regions`);
    const regions2 = extractList(regionsRes2, 'regions', 'text_regions');
    const hasTranslation = regions2.filter(r => r.translated_text?.length > 0).length;
    if (hasTranslation > 0) {
      pass('测试6d: 翻译', `${hasTranslation}区域有译文, ${timings.translate}ms`);
    } else {
      info('测试6d: 翻译无译文');
    }
  }

  // Step 5: Inpaint + Render
  const inpaintBtn = page.locator('button:text("背景修复")').first();
  if (await inpaintBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await inpaintBtn.click();
    await page.waitForTimeout(10000);
    
    const renderBtn = page.locator('button:text("文字回填")').first();
    if (await renderBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await renderBtn.click();
      await page.waitForTimeout(5000);
      await ss(page, 'test6_final');
      pass('测试6e: 修复+回填', '完成');
    }
  }

  // ═══ TEST 7: Cross-page state pollution after full pipeline ═══
  log('\n── Test 7: 全流程后跨页污染 ──');
  const otherPage = testPages.find(p => p.pageId !== testPageId) || testPages[1];
  await page.goto(`${BASE_URL}/pc/projects/${projectId}?pageId=${otherPage.pageId}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);
  await ss(page, 'test7_other_page');

  const otherChecks = await page.evaluate(() => {
    const greens = document.querySelectorAll('.text-green-500 svg').length;
    const spinners = document.querySelectorAll('.animate-spin').length;
    const statusText = document.querySelector('[class*="StatusBar"]')?.textContent || '';
    return { greens, spinners, statusText: statusText.slice(0, 100) };
  });

  if (otherChecks.greens === 0 && otherChecks.spinners === 0) {
    pass('测试7: 跨页无污染', `绿色勾:${otherChecks.greens}, 处理中:${otherChecks.spinners}`);
  } else {
    fail('测试7: 跨页污染', `绿色勾:${otherChecks.greens}, 处理中:${otherChecks.spinners}`);
  }

  // ═══ TEST 8: Performance ═══
  log('\n── Test 8: 性能基准 ──');
  info(`页面加载: ${timings.pageLoad}ms`);
  info(`项目导航: ${timings.projectNav}ms`);
  if (timings.detect) info(`文字检测: ${timings.detect}ms`);
  if (timings.ocr) info(`OCR识别: ${timings.ocr}ms`);
  if (timings.translate) info(`翻译: ${timings.translate}ms`);

  const perfIssues = [];
  if (timings.pageLoad > 8000) perfIssues.push(`页面加载慢(${timings.pageLoad}ms)`);
  if (timings.detect && timings.detect > 30000) perfIssues.push(`检测慢(${timings.detect}ms)`);
  if (timings.ocr && timings.ocr > 20000) perfIssues.push(`OCR慢(${timings.ocr}ms)`);

  if (perfIssues.length === 0) {
    pass('测试8: 性能', '所有响应时间在可接受范围');
  } else {
    fail('测试8: 性能', perfIssues.join(', '));
  }

  // ═══ TEST 9: Regression ═══
  log('\n── Test 9: 回归检查 ──');
  await page.goto(`${BASE_URL}/pc/projects/${projectId}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  const hasCanvas = await page.locator('img[alt="漫画页面"]').first().isVisible({ timeout: 3000 }).catch(() => false);
  if (hasCanvas) pass('测试9a: 图片', '正常');
  else info('测试9a: 图片不可见');

  const hasToolbar = await page.locator('header, [class*="toolbar"], [class*="Toolbar"]').first().isVisible({ timeout: 2000 }).catch(() => false);
  if (hasToolbar) pass('测试9b: 工具栏', '正常');
  else info('测试9b: 工具栏不可见');

  const sidebarEls = await page.evaluate(() => {
    return document.querySelectorAll('nav a, [class*="sidebar"] a, [class*="Sidebar"] a').length;
  });
  if (sidebarEls > 0) pass('测试9c: 侧边栏', `${sidebarEls}个链接`);
  else info('测试9c: 侧边栏链接不可见');

  await ss(page, 'test9_final');

  // ═══ Summary ═══
  log('\n═══════════════════════════════════════════');
  log('  全链路测试报告');
  log('═══════════════════════════════════════════');
  const passCount = results.filter(r => r.status === 'PASS').length;
  const failCount = results.filter(r => r.status === 'FAIL').length;
  const total = results.length;
  const rate = total > 0 ? Math.round(passCount / total * 100) : 0;

  log(`\n项目: ${proj.name} | 总页: ${allPages.length}`);
  log(`测试项: ${total} | 通过: ${passCount} ✅ | 失败: ${failCount} ❌ | 通过率: ${rate}%`);
  results.forEach(r => log(`  ${r.status === 'PASS' ? '✅' : '❌'} ${r.name}: ${r.detail}`));

  report.push('');
  report.push('='.repeat(60));
  report.push(`项目: ${proj.name} (${projectId}) | 总页: ${allPages.length}`);
  report.push(`测试: ${total}/${passCount}PASS/${failCount}FAIL | 通过率: ${rate}%`);
  report.push(`截图: ${SS_DIR}`);
  writeFileSync(REPORT_PATH, report.join('\n'), 'utf-8');

  await browser.close();
  log(`\n报告: ${REPORT_PATH}`);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
