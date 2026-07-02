/**
 * Setup test data: create chapter + upload test page
 */
import fs from 'fs';

const API_BASE = 'http://localhost:8080/api/v1';
const PROJECT_ID = 'dfaeda8d-05fc-40e3-bcb0-039d6e43650f';

async function main() {
  // Login
  const r = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: '3452483881@qq.com', password: '123789' }),
  });
  const d = await r.json();
  const token = d.data.tokens.access_token;
  const H = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };
  console.log('Logged in as:', d.data.user.email);

  // Create chapter
  const cr = await fetch(`${API_BASE}/projects/${PROJECT_ID}/chapters`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ name: 'Chapter 1' }),
  });
  const cd = await cr.json();
  console.log('Create chapter:', cr.status, JSON.stringify(cd).substring(0, 300));

  let chapterId = cd.data?.chapter_id || cd.data?.id;
  if (!chapterId) {
    console.log('Chapter already exists? Checking...');
    const lr = await fetch(`${API_BASE}/projects/${PROJECT_ID}/chapters`, { headers: H });
    const ld = await lr.json();
    console.log('Chapters list:', JSON.stringify(ld).substring(0, 500));
    if (ld.data && Array.isArray(ld.data) && ld.data.length > 0) {
      chapterId = ld.data[0].chapter_id || ld.data[0].id;
    }
    if (!chapterId) {
      console.error('Could not create or find chapter!');
      return;
    }
  }
  console.log('Using chapter ID:', chapterId);

  // Create a minimal 1x1 PNG
  const pngBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  fs.writeFileSync('e2e/test_page.png', pngBuffer);

  // Multipart form upload
  const boundary = '----TestBoundary' + Date.now();
  let bodyParts = [];
  bodyParts.push(Buffer.from(
    '--' + boundary + '\r\n' +
    'Content-Disposition: form-data; name="file"; filename="test.png"\r\n' +
    'Content-Type: image/png\r\n\r\n',
    'utf8'
  ));
  bodyParts.push(pngBuffer);
  bodyParts.push(Buffer.from('\r\n--' + boundary + '--\r\n', 'utf8'));
  const bodyBuffer = Buffer.concat(bodyParts);

  const ur = await fetch(`${API_BASE}/projects/${PROJECT_ID}/chapters/${chapterId}/pages/upload`, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'multipart/form-data; boundary=' + boundary,
    },
    body: bodyBuffer,
  });
  const ud = await ur.text();
  console.log('Upload status:', ur.status);
  console.log('Upload response:', ud.substring(0, 500));

  // Verify
  const vr = await fetch(`${API_BASE}/projects/${PROJECT_ID}/chapters`, { headers: H });
  const vd = await vr.json();
  console.log('\nVerification:');
  if (vd.data && Array.isArray(vd.data)) {
    for (const ch of vd.data) {
      const pages = ch.pages || [];
      console.log(`  ${ch.name}: ${pages.length} pages`);
      if (pages.length > 0) {
        console.log(`    First page: ${pages[0].page_id}`);
      }
    }
  } else {
    console.log('  Raw:', JSON.stringify(vd).substring(0, 300));
  }
  
  console.log('\n✓ Done!');
}

main().catch(e => console.error('ERROR:', e.message, e.stack));
