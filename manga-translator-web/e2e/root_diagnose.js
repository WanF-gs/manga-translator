/**
 * 彻底诊断：坐标映射错误根因
 * 对比 3 个关键维度：
 *   A) OCR边界坐标 (API返回)
 *   B) 图片文件自然尺寸 (img.naturalWidth/Height)
 *   C) 浏览器中图片与文本框的原点偏移
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const CRUM = 'C:/Users/WanFi/AppData/Local/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-win64/chrome-headless-shell.exe';
const OUT = path.join(__dirname, 'screenshots_root');
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

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const t = await login();
  const pid = (await get('http://localhost:8080/api/v1/projects',t))?.data?.items?.[0]?.project_id;
  
  // 获取第4页的完整数据
  const chs = (await get('http://localhost:8080/api/v1/projects/'+pid+'/chapters',t))?.data?.items;
  const cid = chs?.[0]?.chapter_id;
  const pages = (await get('http://localhost:8080/api/v1/pages/chapters/'+cid+'/pages',t))?.data?.items || [];
  
  // 逐页检查
  for (let idx = 0; idx < Math.min(5, pages.length); idx++) {
    const pgId = pages[idx].page_id;
    const detail = await get('http://localhost:8080/api/v1/pages/'+pgId,t);
    const pd = detail?.data || detail?.detail;
    if (!pd) continue;
    
    const regs = pd.regions || [];
    const apiW = pd.width;
    const apiH = pd.height;
    const imgUrl = pd.original_url || '';
    
    // 下载图片获取真实尺寸
    let imgSize = null;
    try {
      const ir = await fetch(imgUrl);
      if (ir.ok) {
        const buf = Buffer.from(await ir.arrayBuffer());
        // PNG: bytes 16-23 = width,height (big-endian)
        if (buf[1]===80 && buf[2]===78 && buf[3]===71) { // PNG
          imgSize = {w: buf.readUInt32BE(16), h: buf.readUInt32BE(20)};
        }
        // JPEG: find SOF marker
        else if (buf[0]===0xFF && buf[1]===0xD8) {
          for (let i=2;i<buf.length-9;i++) {
            if (buf[i]===0xFF && (buf[i+1]>=0xC0 && buf[i+1]<=0xC2)) {
              imgSize = {w: buf.readUInt16BE(i+7), h: buf.readUInt16BE(i+5)};
              break;
            }
          }
        }
      }
    } catch(e) {}
    
    console.log(`\n====== 页面 ${idx+1} (${pgId.substring(0,8)}) ======`);
    console.log(`  API尺寸: ${apiW}×${apiH}`);
    console.log(`  图片真实尺寸: ${imgSize ? imgSize.w+'×'+imgSize.h : 'UNKNOWN'}`);
    if (imgSize) console.log(`  API/图片比: ${(apiW/imgSize.w).toFixed(3)} × ${(apiH/imgSize.h).toFixed(3)}`);
    console.log(`  图片URL: ${imgUrl.substring(0,80)}`);
    console.log(`  选区数: ${regs.length}`);
    
    if (regs.length > 0) {
      // 检查选区边界与API尺寸的关系
      let inApiBounds = 0, inImgBounds = 0;
      for (const r of regs) {
        const b = r.boundary || {};
        if (b.x >= 0 && b.y >= 0 && (b.x+b.width) <= apiW && (b.y+b.height) <= apiH) inApiBounds++;
        if (imgSize && b.x >= 0 && b.y >= 0 && (b.x+b.width) <= imgSize.w && (b.y+b.height) <= imgSize.h) inImgBounds++;
      }
      console.log(`  在API边界内: ${inApiBounds}/${regs.length}`);
      if (imgSize) console.log(`  在图片边界内: ${inImgBounds}/${regs.length}`);
      
      // 打印前3个选区
      for (let j = 0; j < Math.min(3, regs.length); j++) {
        const b = regs[j].boundary || {};
        const right = b.x + b.width;
        const bottom = b.y + b.height;
        const apiPctX = (b.x / apiW * 100).toFixed(1);
        const apiPctW = (b.width / apiW * 100).toFixed(1);
        console.log(`  r[${j}]: (${b.x},${b.y}) ${b.width}×${b.height} 右=${right} 底=${bottom} API占比=${apiPctX}%+${apiPctW}%`);
        if (imgSize) {
          const imgPctX = (b.x / imgSize.w * 100).toFixed(1);
          const imgPctW = (b.width / imgSize.w * 100).toFixed(1);
          console.log(`        图片占比=${imgPctX}%+${imgPctW}% 原文="${(r.original_text||'').substring(0,40)}"`);
        }
      }
    }
  }

  // 浏览器验证
  console.log('\n\n====== 浏览器验证 ======');
  const browser = await chromium.launch({headless:true,executablePath:CRUM,args:['--no-sandbox']});
  const ctx = await browser.newContext({viewport:{width:1920,height:1080}});
  await ctx.addCookies([{name:'manga-token',value:t,domain:'localhost',path:'/',sameSite:'Lax'}]);
  const page = await ctx.newPage();
  await page.goto('http://localhost:3000/pc/projects/'+pid,{waitUntil:'domcontentloaded',timeout:60000});
  await sleep(6000);
  try { await page.waitForSelector('div.absolute.rounded-md',{timeout:15000}); } catch {}

  // 切换到第4页
  const allBtns = await page.$$('button');
  for (const b of allBtns) {
    if ((await b.textContent()||'').includes('第4页')) { await b.click(); break; }
  }
  await sleep(5000);

  // 重置到100%
  for (const b of allBtns) {
    if ((await b.getAttribute('title')||'').includes('重置')) { await b.click(); await sleep(500); break; }
  }
  await sleep(1000);

  // 获取浏览器中图片与叠加层的原点对比
  const layout = await page.evaluate(() => {
    const wrapper = document.querySelector('.relative.shadow-2xl');
    if (!wrapper) return {error:'no wrapper'};
    
    const img = wrapper.querySelector('img');
    if (!img) return {error:'no img'};
    
    const overlay = wrapper.querySelector('[class*="absolute inset"][class*="z-50"]');
    
    const wr = wrapper.getBoundingClientRect();
    const ir = img.getBoundingClientRect();
    const ovr = overlay ? overlay.getBoundingClientRect() : null;
    
    const wStyle = window.getComputedStyle(wrapper);
    const iStyle = window.getComputedStyle(img);
    
    const regions = [];
    document.querySelectorAll('div.absolute.rounded-md').forEach((r, i) => {
      if (i >= 5) return;
      const rc = r.getBoundingClientRect();
      const style = r.getAttribute('style') || '';
      regions.push({
        i,
        cssLeft: (style.match(/left:\s*([\d.]+)px/)||[])[1],
        cssTop:  (style.match(/top:\s*([\d.]+)px/)||[])[1],
        cssW:    (style.match(/width:\s*([\d.]+)px/)||[])[1],
        cssH:    (style.match(/height:\s*([\d.]+)px/)||[])[1],
        renderedX: Math.round(rc.x),
        renderedY: Math.round(rc.y),
        renderedW: Math.round(rc.width),
        renderedH: Math.round(rc.height),
        relImgX: Math.round(rc.x - ir.x),
        relImgY: Math.round(rc.y - ir.y),
      });
    });
    
    return {
      wrapper: {x:Math.round(wr.x), y:Math.round(wr.y), w:Math.round(wr.width), h:Math.round(wr.height)},
      img: {x:Math.round(ir.x), y:Math.round(ir.y), w:Math.round(ir.width), h:Math.round(ir.height)},
      imgNatural: {w:img.naturalWidth, h:img.naturalHeight},
      overlay: ovr ? {x:Math.round(ovr.x), y:Math.round(ovr.y), w:Math.round(ovr.width), h:Math.round(ovr.height)} : null,
      imgStyle: {width:iStyle.width, height:iStyle.height, display:iStyle.display, position:iStyle.position},
      wrapperStyle: {width:wStyle.width, height:wStyle.height, padding:wStyle.padding, overflow:wStyle.overflow},
      wrapperChildren: Array.from(wrapper.children).map((c,i)=>({tag:c.tagName,offsetLeft:c.offsetLeft,offsetTop:c.offsetTop})),
      zoom: document.querySelector('[class*="tabular-nums"]')?.textContent,
      regions,
    };
  });
  
  console.log('  zoom:', layout.zoom);
  console.log('  wrapper:', layout.wrapper?.w, 'x', layout.wrapper?.h, 'at (', layout.wrapper?.x, ',', layout.wrapper?.y, ')');
  console.log('  img:', layout.img?.w, 'x', layout.img?.h, 'natural:', layout.imgNatural?.w, 'x', layout.imgNatural?.h);
  console.log('  overlay:', layout.overlay?.w, 'x', layout.overlay?.h);
  console.log('  img offset in wrapper:', layout.img?.x - layout.wrapper?.x, ',', layout.img?.y - layout.wrapper?.y);
  console.log('  overlay offset in wrapper:', layout.overlay?.x - layout.wrapper?.x, ',', layout.overlay?.y - layout.wrapper?.y);
  console.log('  wrapper children offsets:');
  layout.wrapperChildren?.forEach(c => console.log('    ', c.tag, 'left:', c.offsetLeft, 'top:', c.offsetTop));
  
  console.log('\n  选区渲染位置(相对图片原点):');
  layout.regions?.forEach(r => {
    console.log(`    r[${r.i}]: css(${r.cssLeft},${r.cssTop}) ${r.cssW}×${r.cssH} | rendered(${r.relImgX},${r.relImgY}) ${r.renderedW}×${r.renderedH}`);
  });

  // 截图
  await page.screenshot({ path: path.join(OUT, 'root_p4_100.png'), fullPage: false });
  console.log('\n  截图已保存');

  await browser.close();
}
main().catch(e => { console.error(e); process.exit(1); });
