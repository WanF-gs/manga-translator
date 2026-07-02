/**
 * P0 修复验证脚本：测试翻页时图片宽高比是否正确
 * 测试账号: 3452483881@qq.com / 123789
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';
const CREDENTIALS = { account: '3452483881@qq.com', password: '123789' };
const PROJECT_ID = 'dfaeda8d-05fc-40e3-bcb0-039d6e43650f';

async function getImgInfo(page) {
  return page.evaluate(() => {
    const img = document.querySelector('img[alt="漫画页面"]');
    if (!img) return { error: 'no img found' };
    const natW = img.naturalWidth;
    const natH = img.naturalHeight;
    const dispW = img.clientWidth;
    const dispH = img.clientHeight;
    const parent = img.parentElement;
    return {
      naturalWidth: natW,
      naturalHeight: natH,
      displayWidth: dispW,
      displayHeight: dispH,
      containerWidth: parent ? parent.clientWidth : -1,
      containerHeight: parent ? parent.clientHeight : -1,
      imgStyleWidth: img.style.width || 'none',
      imgStyleHeight: img.style.height || 'none',
      aspectRatioNatural: natH ? (natW / natH).toFixed(4) : '0',
      aspectRatioDisplay: dispH ? (dispW / dispH).toFixed(4) : '0',
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
    // ===== 1. 登录 =====
    console.log('[1/6] 登录...');
    const loginRes = await page.request.post('http://localhost:8080/api/v1/auth/login', {
      data: CREDENTIALS,
      headers: { 'Content-Type': 'application/json' },
    });
    const loginData = await loginRes.json();
    const token = loginData.data?.tokens?.access_token || loginData.data?.token;
    if (!token) {
      console.error('登录失败:', JSON.stringify(loginData).slice(0, 200));
      throw new Error('Login failed');
    }
    console.log('  登录成功:', loginData.data.user?.nickname || loginData.data.user?.username || 'unknown');

    // 注入认证
    await context.addCookies([{
      name: 'manga-token', value: token,
      domain: 'localhost', path: '/',
    }]);
    await page.goto(BASE);
    await page.evaluate((tok) => {
      localStorage.setItem('manga-auth', JSON.stringify({
        state: { token: tok, user: { email: '3452483881@qq.com' } },
        version: 0,
      }));
    }, token);

    // ===== 2. 进入项目编辑页 =====
    console.log('[2/6] 进入项目编辑页...');
    await page.goto(`${BASE}/pc/projects/${PROJECT_ID}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    // ===== 3. 获取初始页面渲染信息 =====
    console.log('[3/6] 获取第1页渲染信息...');
    let info = await getImgInfo(page);
    if (info.error) {
      console.error('  无法获取图片信息:', info.error);
      await page.screenshot({ path: 'e2e/p0_debug_1.png', fullPage: true });
      console.log('  调试截图: e2e/p0_debug_1.png');
    } else {
      const diff = Math.abs(parseFloat(info.aspectRatioNatural) - parseFloat(info.aspectRatioDisplay));
      console.log(`  页面1: 原始 ${info.naturalWidth}x${info.naturalHeight}, 显示 ${info.displayWidth}x${info.displayHeight}`);
      console.log(`  自然比例=${info.aspectRatioNatural}, 显示比例=${info.aspectRatioDisplay}, 偏差=${diff.toFixed(4)}`);
    }

    // ===== 4. 翻到第5页（关键测试点） =====
    console.log('[4/6] 翻到第5页...');
    await page.evaluate(() => {
      // 尝试点击侧边栏第5个缩略图
      const buttons = document.querySelectorAll('button');
      let found = false;
      for (const btn of buttons) {
        if (btn.textContent && btn.textContent.includes('第5页')) {
          btn.click();
          found = true;
          break;
        }
      }
      if (!found) {
        // fallback: 尝试其他选择器
        const allClickables = document.querySelectorAll('[class*="page"], [class*="thumb"], li');
        if (allClickables.length >= 5) {
          allClickables[4].click();
        }
      }
    });
    await page.waitForTimeout(2500);

    // ===== 5. 获取第5页渲染信息（P0关键验证） =====
    console.log('[5/6] 获取第5页渲染信息 (P0关键验证)...');
    info = await getImgInfo(page);
    let p0Passed = false;
    let ratioDiff = 0;

    if (info.error) {
      console.error('  无法获取图片信息:', info.error);
    } else {
      ratioDiff = Math.abs(parseFloat(info.aspectRatioNatural) - parseFloat(info.aspectRatioDisplay));
      p0Passed = ratioDiff < 0.01;
      console.log(`  页面5: 原始 ${info.naturalWidth}x${info.naturalHeight}, 显示 ${info.displayWidth}x${info.displayHeight}`);
      console.log(`  自然比例=${info.aspectRatioNatural}, 显示比例=${info.aspectRatioDisplay}, 偏差=${ratioDiff.toFixed(4)}`);
      console.log(`  容器: ${info.containerWidth}x${info.containerHeight}, imgStyle: w=${info.imgStyleWidth} h=${info.imgStyleHeight}`);
    }

    // ===== 6. 多页切换压力测试 =====
    console.log('[6/6] 10页连续切换压力测试...');
    const results = [];
    for (let pageNum = 1; pageNum <= 10; pageNum++) {
      await page.evaluate((n) => {
        const buttons = document.querySelectorAll('button');
        let found = false;
        for (const btn of buttons) {
          if (btn.textContent && btn.textContent.includes('第' + n + '页')) {
            btn.click();
            found = true;
            break;
          }
        }
        if (!found) {
          const allClickables = document.querySelectorAll('[class*="page"], [class*="thumb"], li');
          const idx = n - 1;
          if (allClickables.length > idx) {
            allClickables[idx].click();
          }
        }
      }, pageNum);
      await page.waitForTimeout(2000);

      const result = await getImgInfo(page);
      if (result.error) {
        result.pageNum = pageNum;
        result.ratioDiff = 'error';
        results.push(result);
        console.log(`  页面${pageNum}: ERROR - ${result.error}`);
      } else {
        const diff = Math.abs(parseFloat(result.aspectRatioNatural) - parseFloat(result.aspectRatioDisplay));
        result.pageNum = pageNum;
        result.ratioDiff = diff.toFixed(4);
        results.push(result);
        console.log(`  页面${pageNum}: ${result.naturalWidth}x${result.naturalHeight} -> ${result.displayWidth}x${result.displayHeight}, 偏差=${result.ratioDiff}`);
      }
    }

    // ===== 汇总 =====
    console.log('\n========== P0 验证结果 ==========');
    const allPassed = results.every(function(r) { return r.ratioDiff !== 'error' && parseFloat(r.ratioDiff) < 0.01; });
    console.log('页面5 关键验证:', p0Passed ? 'PASS' : 'FAIL', '(偏差=' + ratioDiff.toFixed(4) + ')');
    console.log('10页压力测试:', allPassed ? 'PASS' : 'FAIL');
    
    const failures = results.filter(function(r) { return r.ratioDiff === 'error' || parseFloat(r.ratioDiff) >= 0.01; });
    if (failures.length > 0) {
      console.log('失败详情:');
      failures.forEach(function(f) { console.log('  页面' + f.pageNum + ': 偏差=' + f.ratioDiff + ', 自然=' + f.naturalWidth + 'x' + f.naturalHeight + ', 显示=' + f.displayWidth + 'x' + f.displayHeight); });
    }

    await page.screenshot({ path: 'e2e/p0_verify_screenshot.png', fullPage: false });
    console.log('截图已保存: e2e/p0_verify_screenshot.png');

    await browser.close();
    return allPassed && p0Passed ? 0 : 1;
  } catch (err) {
    console.error('脚本错误:', err.message);
    if (err.stack) console.error(err.stack);
    try { await browser.close(); } catch (_) {}
    return 2;
  }
}

main().then(function(code) { process.exit(code); });
