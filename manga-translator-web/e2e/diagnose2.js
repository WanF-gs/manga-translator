const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const CRUM = 'C:/Users/WanFi/AppData/Local/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-win64/chrome-headless-shell.exe';

async function login() {
  const r = await fetch('http://localhost:8080/api/v1/auth/login', {
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({account:'3452483881@qq.com',password:'123789'})});
  return (await r.json())?.data?.tokens?.access_token||null;
}

async function get(url, token) {
  const resp = await fetch(url,{headers:{'Authorization':'Bearer '+token}});
  const txt = await resp.text();
  try { return JSON.parse(txt); } catch { return { raw: txt, status: resp.status }; }
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const token = await login();
  
  // Get project
  const pj = (await get('http://localhost:8080/api/v1/projects',token))?.data?.items?.[0];
  const pid = pj?.project_id;
  console.log('Project:', pj?.name, pid);

  // Try chapter API
  let chResp = await get('http://localhost:8080/api/v1/projects/'+pid+'/chapters',token);
  console.log('Chapters keys:', Object.keys(chResp));
  let chapters = chResp?.data?.items || chResp?.data || [];
  if (!Array.isArray(chapters)) chapters = [];
  console.log('Chapters count:', chapters.length);
  
  const cid = chapters[0]?.chapter_id;
  console.log('Chapter ID:', cid);

  let pages = [];
  if (cid) {
    let pgResp = await get('http://localhost:8080/api/v1/chapters/'+cid+'/pages',token);
    console.log('Pages keys:', Object.keys(pgResp));
    pages = pgResp?.data?.items || pgResp?.data || [];
    if (!Array.isArray(pages)) pages = [];
  }
  console.log('Pages count:', pages.length);

  // Cross-validate specific pages
  const checkPages = [0, 1, 2, 3]; // pages 1-4
  for (const idx of checkPages) {
    if (idx >= pages.length) break;
    const pId = pages[idx].page_id;
    const detail = await get('http://localhost:8080/api/v1/pages/'+pId,token);
    const pd = detail?.data;
    if (!pd) { console.log(`  Page ${idx+1}: no data`); continue; }
    
    const regs = pd.regions || [];
    console.log(`\n===== API 页面 ${idx+1}: ${pd.width}×${pd.height}, ${regs.length}选区 =====`);
    
    for (let j = 0; j < Math.min(3, regs.length); j++) {
      const r = regs[j];
      const b = r.boundary || {};
      console.log(`  r[${j}]: b=(${b.x},${b.y},${b.width},${b.height}) type=${r.type} "${(r.original_text||'').substring(0,25)}"`);
    }
    if (regs.length > 3) {
      const r = regs[regs.length-1];
      const b = r.boundary || {};
      console.log(`  r[${regs.length-1}]: b=(${b.x},${b.y},${b.width},${b.height})`);
    }
  }

  // Browser verification: page 4 at 100%
  console.log('\n\n===== 浏览器: 第4页 100%缩放 =====');
  const browser = await chromium.launch({headless:true,executablePath:CRUM,args:['--no-sandbox']});
  const ctx = await browser.newContext({viewport:{width:1920,height:1080}});
  await ctx.addCookies([{name:'manga-token',value:token,domain:'localhost',path:'/',sameSite:'Lax'}]);
  const page = await ctx.newPage();
  await page.goto('http://localhost:3000/pc/projects/'+pid,{waitUntil:'domcontentloaded',timeout:60000});
  await sleep(5000);
  try { await page.waitForSelector('div.absolute.rounded-md',{timeout:15000}); } catch {}

  // Navigate to page 4
  const btns = await page.$$('button');
  for (const b of btns) {
    if ((await b.textContent()||'').includes('第4页')) { await b.click(); break; }
  }
  await sleep(5000);

  // Ensure 100% zoom
  const allBtns = await page.$$('button');
  for (const b of allBtns) {
    if ((await b.getAttribute('title')||'').includes('重置')) { await b.click(); await sleep(500); break; }
  }
  await sleep(1000);

  // Capture detail
  const bdata = await page.evaluate(() => {
    const wrapper = document.querySelector('.relative.shadow-2xl');
    const img = wrapper?.querySelector('img');
    const imgRect = img?.getBoundingClientRect();
    const overlays = document.querySelectorAll('div.absolute.rounded-md');
    
    const wstyle = wrapper ? window.getComputedStyle(wrapper) : null;
    const imgStyle = img ? window.getComputedStyle(img) : null;
    const overlay = document.querySelector('[class*="absolute inset"][class*="z-50"]');
    const overlayStyle = overlay ? window.getComputedStyle(overlay) : null;
    const overlayRect = overlay?.getBoundingClientRect();
    
    const regions = [];
    overlays.forEach((r, i) => {
      const rc = r.getBoundingClientRect();
      const style = r.getAttribute('style') || '';
      regions.push({
        i,
        cssLeft: (style.match(/left:\s*([\d.]+)px/)||[])[1],
        cssTop: (style.match(/top:\s*([\d.]+)px/)||[])[1],
        cssW: (style.match(/width:\s*([\d.]+)px/)||[])[1],
        cssH: (style.match(/height:\s*([\d.]+)px/)||[])[1],
        relX: imgRect ? Math.round(rc.x - imgRect.x) : null,
        relY: imgRect ? Math.round(rc.y - imgRect.y) : null,
        absX: Math.round(rc.x),
        absY: Math.round(rc.y),
        absW: Math.round(rc.width),
        absH: Math.round(rc.height),
      });
    });

    return {
      imgRenderedW: imgRect ? Math.round(imgRect.width) : 0,
      imgRenderedH: imgRect ? Math.round(imgRect.height) : 0,
      imgNaturalW: img?.naturalWidth || 0,
      imgNaturalH: img?.naturalHeight || 0,
      overlayW: overlayRect ? Math.round(overlayRect.width) : 0,
      overlayH: overlayRect ? Math.round(overlayRect.height) : 0,
      imgWrpOffsetX: imgRect && overlayRect ? Math.round(imgRect.x - overlayRect.x) : null,
      imgWrpOffsetY: imgRect && overlayRect ? Math.round(imgRect.y - overlayRect.y) : null,
      wrapperPadding: wstyle?.padding || '',
      wrapperBorder: wstyle?.border || '',
      wrapperOverflow: wstyle?.overflow || '',
      imgDisplay: imgStyle?.display || '',
      imgPosition: imgStyle?.position || '',
      regions: regions,
    };
  });

  console.log(`  img rendered: ${bdata.imgRenderedW}×${bdata.imgRenderedH}`);
  console.log(`  img natural: ${bdata.imgNaturalW}×${bdata.imgNaturalH}`);
  console.log(`  overlay: ${bdata.overlayW}×${bdata.overlayH}`);
  console.log(`  img-overlay offset: (${bdata.imgWrpOffsetX}, ${bdata.imgWrpOffsetY})`);
  console.log(`  wrapper padding: ${bdata.wrapperPadding}, border: ${bdata.wrapperBorder}`);
  console.log(`  img display: ${bdata.imgDisplay}, position: ${bdata.imgPosition}`);

  // Cross-compare with API data
  if (pages.length >= 4) {
    const p4 = await get('http://localhost:8080/api/v1/pages/'+pages[3].page_id,token);
    const pd = p4?.data;
    const apiW = pd?.width || 1;
    const apiH = pd?.height || 1;
    const regs = pd?.regions || [];
    
    console.log(`\n  API: ${apiW}×${apiH}, ${regs.length}选区`);
    console.log(`  Rendered: ${bdata.imgRenderedW}×${bdata.imgRenderedH}`);
    console.log(`  缩放比: ${(bdata.imgRenderedW/apiW).toFixed(4)}`);
    
    console.log(`\n  交叉验证 (API期望 vs 浏览器实际):`);
    for (let i = 0; i < Math.min(6, regs.length); i++) {
      const ab = regs[i].boundary || {};
      const expX = Math.round(ab.x / apiW * bdata.imgRenderedW);
      const expY = Math.round(ab.y / apiH * bdata.imgRenderedH);
      const expW = Math.round(ab.width / apiW * bdata.imgRenderedW);
      const expH = Math.round(ab.height / apiH * bdata.imgRenderedH);
      
      const act = bdata.regions[i] || {};
      const dx = act.relX != null ? act.relX - expX : 'N/A';
      const dy = act.relY != null ? act.relY - expY : 'N/A';
      
      console.log(`  r[${i}]: API(${ab.x},${ab.y},${ab.width},${ab.height}) -> exp(${expX},${expY},${expW},${expH}) vs act(${act.relX},${act.relY},${act.absW},${act.absH}) diff=(${dx},${dy})`);
    }
  }

  // Screenshot
  await page.screenshot({ path: path.join(__dirname, 'screenshots_v3', 'diagnose_p4_full.png'), fullPage: false });
  console.log('\n  Full screenshot saved.');

  await browser.close();
}
main().catch(e => { console.error(e); process.exit(1); });
