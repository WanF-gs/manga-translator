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

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const token = await login();
  const pjR = await fetch('http://localhost:8080/api/v1/projects',{headers:{'Authorization':'Bearer '+token}});
  const pid = (await pjR.json())?.data?.items?.[0]?.project_id;
  
  // Get page 4 detail from API
  const chR = await fetch('http://localhost:8080/api/v1/projects/'+pid+'/chapters',{headers:{'Authorization':'Bearer '+token}});
  const chData = await chR.json();
  const cid = (chData?.data?.items||chData?.data||[])[0]?.chapter_id;
  
  const pgR = await fetch('http://localhost:8080/api/v1/chapters/'+cid+'/pages',{headers:{'Authorization':'Bearer '+token}});
  const pgData = await pgR.json();
  const pages = pgData?.data?.items||pgData?.data||[];
  
  console.log('=== 坐标系诊断 ===\n');
  
  // Check page 2 (index 1) and page 4 (index 3)
  for (const idx of [1, 3]) {
    if (idx >= pages.length) continue;
    const pageId = pages[idx].page_id;
    const detailR = await fetch('http://localhost:8080/api/v1/pages/'+pageId,{headers:{'Authorization':'Bearer '+token}});
    const detail = (await detailR.json())?.data;
    
    console.log(`页面 ${idx+1} (${pageId.substring(0,8)}):`);
    console.log(`  API width: ${detail.width}, height: ${detail.height}`);
    console.log(`  original_url: ${(detail.original_url||'').substring(0,80)}`);
    console.log(`  regions: ${(detail.regions||[]).length}`);
    
    if (detail.regions && detail.regions.length > 0) {
      const r0 = detail.regions[0];
      const b = r0.boundary || {};
      console.log(`  region0 boundary: x=${b.x} y=${b.y} w=${b.width} h=${b.height}`);
      console.log(`  region0 type: ${r0.type}`);
      
      // Check last region too
      const rLast = detail.regions[detail.regions.length-1];
      const bLast = rLast.boundary || {};
      console.log(`  region${detail.regions.length-1} boundary: x=${bLast.x} y=${bLast.y} w=${bLast.width} h=${bLast.height}`);
    }
  }

  // Browser diagnosis
  console.log('\n--- 浏览器诊断 ---');
  const browser = await chromium.launch({headless:true,executablePath:CRUM,args:['--no-sandbox']});
  const ctx = await browser.newContext({viewport:{width:1920,height:1080}});
  await ctx.addCookies([{name:'manga-token',value:token,domain:'localhost',path:'/',sameSite:'Lax'}]);
  const page = await ctx.newPage();
  
  await page.goto('http://localhost:3000/pc/projects/'+pid,{waitUntil:'domcontentloaded',timeout:60000});
  await sleep(5000);
  
  // Wait for regions at 100% zoom
  try { await page.waitForSelector('div.absolute.rounded-md',{timeout:15000}); } catch(e) { console.log('no regions'); }

  // Get layout info at 100%
  const info = await page.evaluate(() => {
    const wrapper = document.querySelector('.relative.shadow-2xl');
    const img = wrapper?.querySelector('img');
    const overlays = document.querySelectorAll('div.absolute.rounded-md');
    
    const wr = wrapper?.getBoundingClientRect();
    const ir = img?.getBoundingClientRect();
    
    // Get wrapper's first child positions
    const children = wrapper ? Array.from(wrapper.children) : [];
    const childInfo = children.map((c, i) => ({
      tag: c.tagName,
      className: (c.className||'').substring(0,50),
      rect: c.getBoundingClientRect() ? {
        x: Math.round(c.getBoundingClientRect().x),
        y: Math.round(c.getBoundingClientRect().y),
        w: Math.round(c.getBoundingClientRect().width),
        h: Math.round(c.getBoundingClientRect().height),
      } : null,
    }));
    
    // Check img dimensions
    const imgNSize = img ? {nw:img.naturalWidth, nh:img.naturalHeight} : null;
    const imgRSize = img ? {ow:img.offsetWidth, oh:img.offsetHeight} : null;
    
    // Overlay positions (first 5 and last)
    const regionPositions = [];
    overlays.forEach((r, i) => {
      if (i > 4 && i < overlays.length - 1) return;
      const rc = r.getBoundingClientRect();
      regionPositions.push({
        i,
        x: Math.round(rc.x - (ir ? ir.x : 0)),  // relative to image top-left
        y: Math.round(rc.y - (ir ? ir.y : 0)),
        w: Math.round(rc.width),
        h: Math.round(rc.height),
        absX: Math.round(rc.x),
        absY: Math.round(rc.y),
      });
    });

    return {
      wrapper: wr ? {x:Math.round(wr.x),y:Math.round(wr.y),w:Math.round(wr.width),h:Math.round(wr.height)}:null,
      img: ir ? {x:Math.round(ir.x),y:Math.round(ir.y),w:Math.round(ir.width),h:Math.round(ir.height)}:null,
      imgNatural: imgNSize,
      imgOffset: imgNSize,
      offsetDiff: wr && ir ? {dx:Math.round(ir.x-wr.x), dy:Math.round(ir.y-wr.y)} : null,
      children: childInfo,
      regions: regionPositions,
      zoom: document.querySelector('[class*="tabular-nums"]')?.textContent || 'N/A',
    };
  });

  console.log('  zoom:', info.zoom);
  console.log('  wrapper rect:', JSON.stringify(info.wrapper));
  console.log('  img rect:', JSON.stringify(info.img));
  console.log('  img offset vs wrapper:', JSON.stringify(info.offsetDiff));
  console.log('  img natural size:', JSON.stringify(info.imgNatural));
  console.log('  img offset size:', JSON.stringify(info.imgOffset));
  console.log('  wrapper children:');
  info.children.forEach(c => console.log('    ', c.tag, c.className, JSON.stringify(c.rect)));
  console.log('  region positions (relative to img):');
  info.regions.forEach(r => console.log(`    region[${r.i}]: (${r.x},${r.y}) ${r.w}×${r.h} abs(${r.absX},${r.absY})`));

  // Now navigate to page 4 and check
  console.log('\n--- 切换到第4页 ---');
  const allBtns = await page.$$('button');
  for (const b of allBtns) {
    try {
      const t = await b.textContent();
      if (t && t.includes('第4页')) { await b.click(); break; }
    } catch {}
  }
  await sleep(3000);
  
  // Re-read dimensions for page 4
  const info4 = await page.evaluate(() => {
    const wrapper = document.querySelector('.relative.shadow-2xl');
    const img = wrapper?.querySelector('img');
    const wr = wrapper?.getBoundingClientRect();
    const ir = img?.getBoundingClientRect();
    const overlays = document.querySelectorAll('div.absolute.rounded-md');
    
    const regionPositions = [];
    overlays.forEach((r, i) => {
      if (i > 3 && i < overlays.length - 1) return;
      const rc = r.getBoundingClientRect();
      regionPositions.push({
        i,
        rx: Math.round(rc.x - (ir ? ir.x : 0)),
        ry: Math.round(rc.y - (ir ? ir.y : 0)),
        rw: Math.round(rc.width),
        rh: Math.round(rc.height),
      });
    });

    return {
      wrapper: wr ? {x:Math.round(wr.x),y:Math.round(wr.y),w:Math.round(wr.width),h:Math.round(wr.height)}:null,
      img: ir ? {x:Math.round(ir.x),y:Math.round(ir.y),w:Math.round(ir.width),h:Math.round(ir.height)}:null,
      imgN: img ? {nw:img.naturalWidth, nh:img.naturalHeight} : null,
      offset: wr&&ir ? {dx:Math.round(ir.x-wr.x),dy:Math.round(ir.y-wr.y)}:null,
      regions: regionPositions,
    };
  });

  console.log('  wrapper:', JSON.stringify(info4.wrapper));
  console.log('  img:', JSON.stringify(info4.img));
  console.log('  img natural:', JSON.stringify(info4.imgN));
  console.log('  img-wrp offset:', JSON.stringify(info4.offset));
  console.log('  regions:');
  info4.regions.forEach(r => console.log(`    region[${r.i}]: rel(${r.rx},${r.ry}) ${r.rw}×${r.rh}`));

  await browser.close();
}
main().catch(e => { console.error(e.message); process.exit(1); });
