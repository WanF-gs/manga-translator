/**
 * Performance verification test
 */
import { chromium } from 'playwright';

async function main() {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext();
  const p = await ctx.newPage();

  // Login
  const apiR = await p.request.post('http://localhost:8080/api/v1/auth/login', {
    headers: { 'Content-Type': 'application/json' },
    data: { account: '3452483881@qq.com', password: '123789' },
  });
  const d = await apiR.json();
  const t = d.data.tokens.access_token;
  await p.context().addCookies([{
    name: 'manga-token', value: t,
    domain: 'localhost', path: '/', httpOnly: false, secure: false, sameSite: 'Lax',
  }]);
  await p.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
  await p.evaluate(({ t, u }) => {
    localStorage.setItem('manga-auth', JSON.stringify({
      state: { accessToken: t, user: u, isAuthenticated: true, _hydrated: true },
      version: 0,
    }));
  }, { t, u: d.data.user });

  // Cold load test
  console.log('=== 性能专项验证 ===\n');
  
  const start = Date.now();
  await p.goto('http://localhost:3000/pc/projects/dfaeda8d-05fc-40e3-bcb0-039d6e43650f', {
    waitUntil: 'networkidle',
    timeout: 30000,
  });
  const loadTime = Date.now() - start;

  // Get perf data
  const perf = await p.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const resources = performance.getEntriesByType('resource');
    const jsResources = resources.filter(r => r.name.includes('.js') || r.name.includes('.mjs'));
    const jsTotalSize = jsResources.reduce((s, r) => s + (r.transferSize || 0), 0);
    const lazyComponents = ['PropertyPanel', 'ExportPanel', 'StylePanel', 'BatchProgressModal', 'OcrReviewPanel'];
    const lazyChunks = resources.filter(r => lazyComponents.some(c => r.name.includes(c)));

    return {
      domContentLoaded: nav ? nav.domContentLoadedEventEnd : 0,
      loadComplete: nav ? nav.loadEventEnd : 0,
      firstPaint: performance.getEntriesByType('paint').find(e => e.name === 'first-contentful-paint')?.startTime || 0,
      jsTotal: jsTotalSize,
      jsCount: jsResources.length,
      lazyChunks: lazyChunks.map(r => ({
        name: r.name.substring(r.name.lastIndexOf('/') + 1),
        size: r.transferSize || 0,
      })),
      totalResources: resources.length,
      totalTransfer: resources.reduce((s, r) => s + (r.transferSize || 0), 0),
    };
  });

  console.log('页面加载时间:', loadTime, 'ms');
  console.log('DOM内容加载:', Math.round(perf.domContentLoaded), 'ms');
  console.log('完整加载:', Math.round(perf.loadComplete), 'ms');
  console.log('首次内容绘制(FCP):', Math.round(perf.firstPaint), 'ms');
  console.log('JS 文件数:', perf.jsCount);
  console.log('JS 总大小:', Math.round(perf.jsTotal / 1024), 'KB');
  console.log('懒加载 chunk 数:', perf.lazyChunks.length);
  perf.lazyChunks.forEach(c => console.log('  ', c.name, Math.round(c.size / 1024) + 'KB'));
  console.log('总资源数:', perf.totalResources);
  console.log('总传输量:', Math.round(perf.totalTransfer / 1024), 'KB');

  // Memory
  const mem = await p.evaluate(() => {
    if (!performance.memory) return null;
    return {
      used: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024),
      total: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024),
      limit: Math.round(performance.memory.jsHeapSizeLimit / 1024 / 1024),
    };
  });
  if (mem) console.log('JS堆内存:', mem.used + 'MB /', mem.total + 'MB (limit:', mem.limit + 'MB)');

  // Interaction test
  console.log('\n交互响应测试:');
  const btnStart = Date.now();
  await p.click('button:has-text("保存")');
  const btnEnd = Date.now();
  console.log('  保存按钮点击响应:', btnEnd - btnStart, 'ms');

  // ===== 性能评分 =====
  console.log('\n=== 性能评分 ===');
  const scores = [];
  
  // FCP < 1.8s = good (Lighthouse P0)
  if (perf.firstPaint < 1800) {
    scores.push({ metric: 'FCP', value: Math.round(perf.firstPaint) + 'ms', grade: 'PASS', threshold: '<1800ms' });
  } else {
    scores.push({ metric: 'FCP', value: Math.round(perf.firstPaint) + 'ms', grade: 'WARN', threshold: '<1800ms' });
  }
  
  // Page load < 5s
  if (loadTime < 5000) {
    scores.push({ metric: '页面加载', value: loadTime + 'ms', grade: 'PASS', threshold: '<5000ms' });
  } else {
    scores.push({ metric: '页面加载', value: loadTime + 'ms', grade: 'WARN', threshold: '<5000ms' });
  }
  
  // Memory < 200MB
  if (mem && mem.used < 200) {
    scores.push({ metric: '内存', value: mem.used + 'MB', grade: 'PASS', threshold: '<200MB' });
  } else if (mem) {
    scores.push({ metric: '内存', value: mem.used + 'MB', grade: 'WARN', threshold: '<200MB' });
  }
  
  // Interaction < 100ms
  if (btnEnd - btnStart < 100) {
    scores.push({ metric: '交互响应', value: (btnEnd - btnStart) + 'ms', grade: 'PASS', threshold: '<100ms' });
  } else {
    scores.push({ metric: '交互响应', value: (btnEnd - btnStart) + 'ms', grade: 'WARN', threshold: '<100ms' });
  }
  
  // JS bundle optimization (lazy loading success)
  const hasLazyChunks = perf.lazyChunks.length >= 5;
  scores.push({ metric: '代码分割', value: perf.lazyChunks.length + ' chunks', grade: hasLazyChunks ? 'PASS' : 'WARN', threshold: '>=5 lazy chunks' });

  console.table(scores);
  
  const passCount = scores.filter(s => s.grade === 'PASS').length;
  console.log('性能评分: ' + passCount + '/' + scores.length + ' 通过');
  
  if (passCount === scores.length) {
    console.log('结论: 性能指标全部达标 ✓');
  } else {
    console.log('结论: 有 ' + (scores.length - passCount) + ' 项需优化');
  }

  await b.close();
}

main().catch(e => console.error('ERROR:', e.message));
