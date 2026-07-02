/**
 * CSS 层叠诊断：追踪为什么 img 渲染宽度不等于 style 宽度
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
    const loginRes = await page.request.post('http://localhost:8080/api/v1/auth/login', {
      data: { account: '3452483881@qq.com', password: '123789' },
      headers: { 'Content-Type': 'application/json' },
    });
    const loginData = await loginRes.json();
    const token = loginData.data?.tokens?.access_token;
    
    await context.addCookies([{ name: 'manga-token', value: token, domain: 'localhost', path: '/' }]);
    await page.goto('http://localhost:3000');
    await page.evaluate((tok) => {
      localStorage.setItem('manga-auth', JSON.stringify({
        state: { token: tok, user: { email: '3452483881@qq.com' } },
        version: 0,
      }));
    }, token);

    // Navigate to project
    await page.goto('http://localhost:3000/pc/projects/dfaeda8d-05fc-40e3-bcb0-039d6e43650f', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    // Deep CSS diagnostics
    const diag = await page.evaluate(() => {
      const img = document.querySelector('img[alt="漫画页面"]');
      if (!img) return { error: 'No img found' };
      
      // Get computed styles for img and ancestors
      function getCS(el) {
        const cs = window.getComputedStyle(el);
        return {
          tag: el.tagName,
          display: cs.display,
          width: cs.width,
          height: cs.height,
          maxWidth: cs.maxWidth,
          minWidth: cs.minWidth,
          overflow: cs.overflow,
          flexBasis: cs.flexBasis,
          flexGrow: cs.flexGrow,
          flexShrink: cs.flexShrink,
          position: cs.position,
          boxSizing: cs.boxSizing,
          rectW: el.getBoundingClientRect().width,
          rectH: el.getBoundingClientRect().height,
          clientW: el.clientWidth,
          clientH: el.clientHeight,
          scrollW: el.scrollWidth,
          scrollH: el.scrollHeight,
          inlineStyle: el.getAttribute('style') || '',
          hasOverflow: el.scrollWidth > el.clientWidth,
        };
      }

      const chain = [];
      let el = img;
      while (el && el !== document.body) {
        chain.push(getCS(el));
        el = el.parentElement;
      }
      
      return {
        imgNatural: { w: img.naturalWidth, h: img.naturalHeight },
        imgAttr: { w: img.getAttribute('width'), h: img.getAttribute('height') },
        chain: chain,
        viewportW: window.innerWidth,
        viewportH: window.innerHeight,
        allImgOnPage: document.querySelectorAll('img').length,
      };
    });

    console.log('=== CSS Layout Diagnostic ===');
    console.log('Viewport:', diag.viewportW, 'x', diag.viewportH);
    console.log('Natural:', JSON.stringify(diag.imgNatural));
    console.log('Attr:', JSON.stringify(diag.imgAttr));
    console.log('Total images on page:', diag.allImgOnPage);
    console.log('\n--- CSS Chain (from img up to body) ---');
    diag.chain.forEach(function(el, i) {
      console.log('\n[' + i + '] ' + el.tag + ' | display:' + el.display + ' | CSS:' + el.width + 'x' + el.height);
      console.log('    rect:' + el.rectW.toFixed(0) + 'x' + el.rectH.toFixed(0) + ' | client:' + el.clientW + 'x' + el.clientH + ' | scroll:' + el.scrollW + 'x' + el.scrollH);
      console.log('    inlineStyle: ' + el.inlineStyle.substring(0, 100));
      console.log('    maxW:' + el.maxWidth + ' | minW:' + el.minWidth + ' | overflow:' + el.overflow);
      console.log('    flexBasis:' + el.flexBasis + ' | grow:' + el.flexGrow + ' | shrink:' + el.flexShrink);
      if (el.hasOverflow) console.log('    *** HAS OVERFLOW ***');
    });

    // Also check how image URL resolves
    const imgSrc = await page.evaluate(() => {
      const img = document.querySelector('img[alt="漫画页面"]');
      return img ? img.src : 'none';
    });
    console.log('\nImage URL:', imgSrc);

    // Fetch image headers to check actual file size
    if (imgSrc && imgSrc.startsWith('http')) {
      const imgRes = await page.request.head(imgSrc);
      console.log('Image content-type:', imgRes.headers()['content-type']);
      console.log('Image content-length:', imgRes.headers()['content-length']);
      console.log('Image status:', imgRes.status());
    }

    await page.screenshot({ path: 'e2e/css_diag_screenshot.png', fullPage: true });
    console.log('\nScreenshot: e2e/css_diag_screenshot.png');

    await browser.close();
  } catch (err) {
    console.error('Error:', err.message);
    try { await browser.close(); } catch(_) {}
    return 1;
  }
  return 0;
}

main().then(code => process.exit(code));
