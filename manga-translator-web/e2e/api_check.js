const main = async () => {
  const r = await fetch('http://localhost:8080/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: '3452483881@qq.com', password: '123789' }),
  });
  const d = await r.json();
  console.log('login keys:', Object.keys(d));
  const t = d?.data?.tokens?.access_token;
  console.log('token:', t ? t.substring(0, 30) : 'NULL');

  const p = await fetch('http://localhost:8080/api/v1/projects', {
    headers: { 'Authorization': 'Bearer ' + t },
  });
  const pd = await p.json();
  console.log('projects status:', p.status);
  console.log('projects keys:', Object.keys(pd));
  console.log('projects data type:', typeof pd.data, Array.isArray(pd.data) ? 'array' : 'not array');
  console.log('full:', JSON.stringify(pd).substring(0, 600));
};
main().catch(e => console.error(e));
