async function main() {
  const r = await fetch('http://localhost:8080/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: '3452483881@qq.com', password: '123789' }),
  });
  const d = await r.json();
  const t = d.data.tokens.access_token;
  const H = { 'Authorization': 'Bearer ' + t };

  const ep = 'http://localhost:8080/api/v1/pages/chapters/42efacca-8bf6-46e2-b4eb-398b098849b3/pages';
  const r2 = await fetch(ep, { headers: H });
  const d2 = await r2.json();
  console.log('Status:', r2.status);
  
  const pages = Array.isArray(d2.data) ? d2.data : (d2.data ? d2.data.items || [] : []);
  console.log('Pages count:', pages.length);
  
  if (pages.length > 0) {
    const p = pages[0];
    console.log('First page:', p.page_id);
    console.log('  original_url:', (p.original_url || '').substring(0, 120));
    console.log('  size:', p.width + 'x' + p.height);
    console.log('  thumbnail_url:', (p.thumbnail_url || '').substring(0, 80));
    
    pages.slice(0, 5).forEach((p, i) => {
      console.log('  [' + i + ']', p.page_id, 'sort:', p.sort_order, 'status:', p.status);
    });
  } else {
    console.log('No pages found - the page_count in chapters response may be inaccurate');
    console.log('Raw response:', JSON.stringify(d2).substring(0, 300));
  }
}

main().catch(e => console.error('ERROR:', e.message));
