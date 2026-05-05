import fs from 'node:fs';
import path from 'node:path';
import fetch from 'node-fetch';

const BASE = 'http://localhost:3000';
const CREDENTIALS = { email: 'dungd@example.com', password: 'Password123!' };

function choosePdf() {
  // prefer user-uploaded PDF if present
  const candidates = [
    path.resolve(process.cwd(), '23127486 (8).pdf'),
    path.resolve(process.cwd(), 'storage', 'pdfs', '0428e2c0-5ca8-41bd-a04f-4e37d8b495b2', '1777731294364_PROJECT2_EN.pdf')
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  // fallback: find any pdf in storage/pdfs
  const storageDir = path.resolve(process.cwd(), 'storage', 'pdfs');
  if (fs.existsSync(storageDir)) {
    const walk = (dir) => {
      const items = fs.readdirSync(dir);
      for (const it of items) {
        const full = path.join(dir, it);
        if (fs.statSync(full).isDirectory()) {
          const r = walk(full);
          if (r) return r;
        } else if (full.toLowerCase().endsWith('.pdf')) {
          return full;
        }
      }
      return null;
    };
    const found = walk(storageDir);
    if (found) return found;
  }
  throw new Error('No PDF found in repository');
}

async function httpJson(url, opts) {
  const r = await fetch(url, opts);
  const t = await r.text();
  try { return { status: r.status, ok: r.ok, json: JSON.parse(t) }; } catch(e) { return { status: r.status, ok: r.ok, text: t }; }
}

(async function main(){
  try {
    console.log('Logging in...');
    const loginRes = await httpJson(BASE + '/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(CREDENTIALS)
    });
    if (!loginRes.ok) {
      console.error('Login failed:', loginRes.status, loginRes.json || loginRes.text);
      process.exit(1);
    }
    const tokens = loginRes.json;
    const access = tokens.access_token;
    console.log('Logged in, access token received.');

    console.log('Fetching admin workshops...');
    const workshopsRes = await httpJson(BASE + '/admin/workshops', { headers: { Authorization: `Bearer ${access}` } });
    if (!workshopsRes.ok) { console.error('Failed to list workshops:', workshopsRes); process.exit(1); }
    const list = workshopsRes.json.data ?? workshopsRes.json;
    let target = list.find(w => /test/i.test(w.title));
    if (!target) {
      console.log('No workshop with "test" in title — creating one.');
      const now = new Date();
      const startsAt = new Date(now.getTime() + 3600*1000).toISOString();
      const endsAt = new Date(now.getTime() + 3*3600*1000).toISOString();
      const createRes = await httpJson(BASE + '/admin/workshops', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access}` },
        body: JSON.stringify({ title: 'test workshop', description: 'smoke test', speakerName: 'Tester', room: 'Online', startsAt, endsAt, capacity: 10, priceVnd: 0 })
      });
      if (!createRes.ok) { console.error('Failed to create workshop:', createRes); process.exit(1); }
      target = createRes.json.data ?? createRes.json;
      console.log('Created workshop id=', target.id);
    } else {
      console.log('Found workshop:', target.id, target.title);
    }

    // upload the PDF
    const pdfPath = choosePdf();
    console.log('Uploading pdf:', pdfPath);
    const fileName = path.basename(pdfPath);
    const fileBytes = fs.readFileSync(pdfPath);

    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).slice(2);
    const header = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/pdf\r\n\r\n`, 'utf8');
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
    const body = Buffer.concat([header, fileBytes, footer]);

    const upload = await fetch(`${BASE}/admin/workshops/${target.id}/pdf`, { method: 'POST', headers: { Authorization: `Bearer ${access}`, 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': String(body.length) }, body });
    const uploadText = await upload.text();
    console.log('Upload response status:', upload.status);
    console.log('Upload response body:', uploadText);

    if (upload.status >= 200 && upload.status < 300) {
      console.log('Upload accepted. Polling workshop detail until status is ready/fallback/failed...');
      for (let i=0;i<20;i++){
        await new Promise(r=>setTimeout(r, 1000));
        const det = await httpJson(`${BASE}/admin/workshops/${target.id}`, { headers: { Authorization: `Bearer ${access}` } });
        if (!det.ok) { console.log('Detail fetch failed', det); break; }
        const state = det.json.data ?? det.json;
        console.log('Current summary_status=', state.summaryStatus ?? state.summary_status ?? 'unknown');
        if ((state.summaryStatus ?? state.summary_status) !== 'processing') { console.log('Final state:', state); break; }
      }
    }

    console.log('Done');
  } catch (err) {
    console.error('Error during debug flow:', err);
    process.exit(1);
  }
})();
