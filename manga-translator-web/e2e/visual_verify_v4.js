/**
 * v4 完整视觉验收 — 多级缩放 + 多页面 + 截图
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const CRUM = 'C:/Users/WanFi/AppData/Local/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-win64/chrome-headless-shell.exe';
const OUT = path.join(__dirname, 'screenshots_v4');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

async function login() {
  const r = await fetch('http://localhost:8080/api/v1/auth/login', {
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({account:'3452483881@qq.com',password:'123789'})});
  return (await r.json())?.data?.tokens?.access_token||null;
}
async function get(url, token) {
  return (await fetch(url,{headers:{'Authorization':'Bearer '+token}})).json();
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const t = await login();
  if (!t) { console.error('LOGIN FAILED'); process.exit(1); }
  
  const proj = await get('http://localhost:8080/api/v1/projects', t);
  const pid = proj?.data?.items?.[0]?.project_id || proj?.items?.[0]?.project_id;
  console.log('Project:', pid.substring(0,8));
  
  const CID = '42efacca-8bf6-46e2-b4eb-398b098849b3';
  const pagesResp = await get('http://localhost:8080/api/v1/pages/chapters/'+CID+'/pages', t);
  const pages = pagesResp?.data?.items || pagesResp?.items || pagesResp?.data || [];

  const browser = await chromium.launch({headless:true,executablePath:CRUM,args:['--no-sandbox']});
  const ctx = await browser.newContext({viewport:{width:1920,height:1080}});
  await ctx.addCookies([{name:'manga-token',value:t,domain:'localhost',path:'/',sameSite:'Lax'}]);
  const page = await ctx.newPage();
  await page.goto('http://localhost:3000/pc/projects/'+pid,{waitUntil:'domcontentloaded',timeout:30000});
  await sleep(6000);

  let passCount = 0, failCount = 0;

  for (const test of [
    {pn:2, z:25}, {pn:2, z:100}, {pn:2, z:200},
    {pn:4, z:25}, {pn:4, z:100}, {pn:4, z:200},
  ]) {
    const {pn, z} = test;
    
    // 切换页面
    const btns = await page.$$('button');
    for (const b of btns) {
      const text = (await b.textContent()||'').trim();
      if (text.includes('第'+pn+'页')) { await b.click(); await sleep(4000); break; }
    }

    // 设置缩放: 先重置到100%
    const allBtns = await page.$$('button');
    for (const b of allBtns) {
      const title = await b.getAttribute('title');
      if (title && title.includes('重置')) { await b.click(); await sleep(800); break; }
    }
    
    // 调整到目标缩放
    if (z !== 100) {
      const refreshBtns = await page.$$('button');
      let targetBtn = null;
      for (const b of refreshBtns) {
        const title = (await b.getAttribute('title') || '');
        if (z < 100 && title.includes('缩小')) { targetBtn = b; break; }
        if (z > 100 && title.includes('放大')) { targetBtn = b; break; }
      }
      
      if (!targetBtn) continue;
      const clicks = Math.abs(Math.round((z - 100) / 25));
      for (let i=0; i<clicks; i++) { await targetBtn.click(); await sleep(300); }
      await sleep(1000);
    }

    // 获取验证数据
    const layout = await page.evaluate(() => {
      const w = document.querySelector('.relative.shadow-2xl');
      if (!w) return {err:'no wrapper'};
      const img = w.querySelector('img');
      if (!img) return {err:'no img'};
      const wr = w.getBoundingClientRect();
      const ir = img.getBoundingClientRect();
      const regs = [];
      document.querySelectorAll('div.absolute.rounded-md').forEach((r,i)=>{
        const rc=r.getBoundingClientRect();
        const s=r.getAttribute('style')||'';
        regs.push({
          i,
          cssL:parseFloat((s.match(/left:\s*([\d.]+)px/)||[])[1])||0,
          cssT:parseFloat((s.match(/top:\s*([\d.]+)px/)||[])[1])||0,
          cssW:parseFloat((s.match(/width:\s*([\d.]+)px/)||[])[1])||0,
          cssH:parseFloat((s.match(/height:\s*([\d.]+)px/)||[])[1])||0,
        });
      });
      return {
        wW:Math.round(wr.width), wH:Math.round(wr.height),
        nW:img.naturalWidth, nH:img.naturalHeight,
        zoom:document.querySelector('[class*="tabular-nums"]')?.textContent?.trim()||'?',
        regs, total:regs.length,
      };
    });

    if (layout.err) { console.log(`[${pn}/${z}%] ERR:${layout.err}`); failCount++; continue; }

    const ds = z/100;
    const expW = Math.round(layout.nW * ds);
    const expH = Math.round(layout.nH * ds);
    const sizeMatch = layout.wW === expW && layout.wH === expH;
    
    // 验证每个选区的公式: cssX = originalX × displayScale
    let cssMatch = true;
    const pageIdx = pn-1;
    if (pages[pageIdx]) {
      const pageData = await get('http://localhost:8080/api/v1/pages/'+pages[pageIdx].page_id, t);
      const pd = pageData?.data || pageData?.detail;
      const apiRegions = pd?.regions || [];
      layout.regs.forEach((r,i) => {
        if (i >= apiRegions.length) return;
        const b = apiRegions[i].boundary || {};
        const expLeft = Math.round(b.x * ds);
        const expTop = Math.round(b.y * ds);
        if (Math.abs(r.cssL - expLeft) > 1 || Math.abs(r.cssT - expTop) > 1) cssMatch = false;
      });
    }

    // 边界检查
    let oob=0;
    layout.regs.forEach(r=>{
      if(r.cssL<-1||r.cssT<-1||r.cssL+r.cssW>layout.wW+1||r.cssT+r.cssH>layout.wH+1) oob++;
    });

    const pass = sizeMatch && cssMatch && oob===0;
    const icon = pass ? '✓' : '✗';
    console.log(`[页${pn}/${z}%] ${icon} size:${layout.wW}×${layout.wH}=${expW}×${expH} regs:${layout.total}/${layout.regs.length} oob:${oob}`);

    if (pass) passCount++; else failCount++;

    // 截图
    const fname = `p${pn}_z${z}.png`;
    await page.screenshot({path:path.join(OUT,fname),fullPage:false});
    console.log(`  截图: ${fname}`);
  }

  console.log(`\n===============`);
  console.log(`通过: ${passCount}/6  失败: ${failCount}/6`);
  console.log(`截图目录: ${OUT}`);

  await browser.close();
}
main().catch(e=>{console.error(e.message);process.exit(1);});
