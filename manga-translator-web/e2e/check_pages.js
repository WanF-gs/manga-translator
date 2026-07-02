async function main() {
  const r = await fetch('http://localhost:8080/api/v1/auth/login', {
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({account:'3452483881@qq.com',password:'123789'})});
  const t = (await r.json())?.data?.tokens?.access_token;
  const H = {'Authorization':'Bearer '+t};
  
  // Get pages
  const pagesRes = await fetch('http://localhost:8080/api/v1/pages/chapters/42efacca-8bf6-46e2-b4eb-398b098849b3/pages',{headers:H});
  const pd = await pagesRes.json();
  const pages = pd?.data?.items || [];
  console.log('Pages count:', pages.length);
  
  if (pages.length === 0) {
    console.log('All data:', JSON.stringify(pd).substring(0, 500));
    return;
  }

  // Check pages 1, 2, 4
  for (const idx of [0, 1, 3]) {
    if (idx >= pages.length) break;
    const pgId = pages[idx].page_id;
    console.log(`\nGetting page ${idx+1}: ${pgId}`);
    
    const detailRes = await fetch('http://localhost:8080/api/v1/pages/'+pgId,{headers:H});
    const detail = await detailRes.json();
    
    let pdData = detail?.detail || detail?.data;
    if (detail?.code === 0 && !pdData) pdData = detail;
    
    if (pdData && pdData.width) {
      console.log(`  ${pdData.width}×${pdData.height}, ${(pdData.regions||[]).length} regions`);
      for (let j = 0; j < Math.min(3, (pdData.regions||[]).length); j++) {
        const r = pdData.regions[j];
        const b = r.boundary || {};
        console.log(`  r[${j}]: (${b.x},${b.y}) ${b.width}×${b.height} "${(r.original_text||'').substring(0,20)}"`);
      }
    } else {
      console.log('  No detail data, keys:', Object.keys(pdData||{}));
      console.log('  Full:', JSON.stringify(detail).substring(0, 300));
    }
  }
}
main().catch(e => console.error(e.message));
