/**
 * 快速调试: 列出所有按钮文字
 */
const { chromium } = require('playwright');
const CRUM = 'C:/Users/WanFi/AppData/Local/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-win64/chrome-headless-shell.exe';

async function login() {
  const r = await fetch('http://localhost:8080/api/v1/auth/login', {
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({account:'3452483881@qq.com',password:'123789'})});
  return (await r.json())?.data?.tokens?.access_token||null;
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const t = await login();
  
  // Get project
  const proj = await fetch('http://localhost:8080/api/v1/projects', {
    headers:{'Authorization':'Bearer '+t}}).then(r=>r.json());
  const pid = proj?.data?.items?.[0]?.project_id || proj?.items?.[0]?.project_id;
  console.log('pid:', pid);

  const browser = await chromium.launch({headless:true,executablePath:CRUM,args:['--no-sandbox']});
  const ctx = await browser.newContext({viewport:{width:1920,height:1080}});
  await ctx.addCookies([{name:'manga-token',value:t,domain:'localhost',path:'/',sameSite:'Lax'}]);
  const page = await ctx.newPage();
  await page.goto(`http://localhost:3000/pc/projects/${pid}`,{waitUntil:'domcontentloaded',timeout:30000});
  await sleep(8000);

  // 列出所有按钮
  const btnInfo = await page.evaluate(() => {
    const btns = document.querySelectorAll('button');
    return Array.from(btns).slice(0, 40).map((b,i) => ({
      i, text: (b.textContent||'').trim().substring(0,30),
      title: b.getAttribute('title')||'',
      className: (b.className||'').substring(0,80),
      disabled: b.disabled,
    }));
  });
  btnInfo.forEach(b => console.log(`btn[${b.i}]: "${b.text}" title="${b.title}" disabled=${b.disabled}`));

  // 获取当前渲染信息
  const layout = await page.evaluate(() => {
    const w = document.querySelector('.relative.shadow-2xl');
    if (!w) return {error:'no wrapper'};
    const img = w.querySelector('img');
    const wr=w.getBoundingClientRect();
    return {
      wW:Math.round(wr.width), wH:Math.round(wr.height),
      nW:img?.naturalWidth, nH:img?.naturalHeight,
      src: (img?.getAttribute('src')||'').substring(0,60),
      zoom: document.querySelector('[class*="tabular-nums"]')?.textContent?.trim(),
    };
  });
  console.log('当前:', layout);

  await browser.close();
}
main().catch(e=>console.error(e.message));
