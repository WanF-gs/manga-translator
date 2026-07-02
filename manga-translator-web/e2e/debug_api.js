const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
async function main() {
  const r = await fetch('http://localhost:8080/api/v1/auth/login', {
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({account:'3452483881@qq.com',password:'123789'})});
  const data = await r.json();
  const t = data?.data?.tokens?.access_token;
  console.log('token:', t ? 'OK' : 'FAIL');

  const projects = await fetch('http://localhost:8080/api/v1/projects', {
    headers:{'Authorization':'Bearer '+t}}).then(r=>r.json());
  const pid = projects?.data?.items?.[0]?.project_id;
  console.log('pid:', pid);

  const chs = await fetch(`http://localhost:8080/api/v1/projects/${pid}/chapters`, {
    headers:{'Authorization':'Bearer '+t}}).then(r=>r.json());
  const cid = chs?.data?.items?.[0]?.chapter_id;
  console.log('cid:', cid);

  const pagesResp = await fetch(`http://localhost:8080/api/v1/pages/chapters/${cid}/pages`, {
    headers:{'Authorization':'Bearer '+t}}).then(r=>r.json());
  
  // 探索结构
  const pp = pagesResp?.data?.items || pagesResp?.items || pagesResp?.data || [];
  console.log('pages count:', Array.isArray(pp) ? pp.length : 'NOT_ARRAY');
  console.log('pagesResp keys:', Object.keys(pagesResp));
  
  if (Array.isArray(pp) && pp.length > 3) {
    console.log('page 4 id:', pp[3]?.page_id || pp[3]?.id || 'MISSING');
    console.log('page 4 keys:', Object.keys(pp[3]));
  } else if (pp.length > 0) {
    console.log('page 1:', JSON.stringify(pp[0]).substring(0,200));
  }
}
main().catch(e => console.error(e));
