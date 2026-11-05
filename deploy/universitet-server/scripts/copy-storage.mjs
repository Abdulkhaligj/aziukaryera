// Copies every Storage file from the cloud project to the new server under
// the same bucket and path, so database references (avatar_path etc.) stay
// valid. Uses only the Storage REST API and Node's built-in fetch (Node 18+).
//
// Environment: SRC_URL, SRC_KEY, DST_URL, DST_KEY (service-role keys).

const required = ['SRC_URL', 'SRC_KEY', 'DST_URL', 'DST_KEY'];
for (const name of required) {
  if (!process.env[name]) { console.error(`XƏTA: ${name} təyin olunmayıb.`); process.exit(1); }
}
const src = { url: process.env.SRC_URL.replace(/\/$/, ''), key: process.env.SRC_KEY };
const dst = { url: process.env.DST_URL.replace(/\/$/, ''), key: process.env.DST_KEY };

// New opaque keys (sb_secret_…) go only in apikey; legacy JWT keys also as bearer.
function headers(side, extra = {}) {
  const h = { apikey: side.key, ...extra };
  if (!side.key.startsWith('sb_')) h.Authorization = `Bearer ${side.key}`;
  return h;
}
const encodePath = path => path.split('/').map(encodeURIComponent).join('/');

async function call(side, method, path, { body, extra, raw } = {}) {
  const response = await fetch(`${side.url}/storage/v1/${path}`, {
    method, headers: headers(side, extra),
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body)
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`${method} ${path} → ${response.status} ${text.slice(0, 200)}`);
  }
  return response;
}

async function listFiles(side, bucket, prefix = '') {
  const files = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await (await call(side, 'POST', `object/list/${encodeURIComponent(bucket)}`, {
      body: { prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } },
      extra: { 'Content-Type': 'application/json' }
    })).json();
    for (const item of page) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null) files.push(...await listFiles(side, bucket, path));
      else files.push({ path, mimetype: item.metadata?.mimetype, cacheControl: item.metadata?.cacheControl });
    }
    if (page.length < 1000) return files;
  }
}

const buckets = await (await call(src, 'GET', 'bucket')).json();
const existing = new Set((await (await call(dst, 'GET', 'bucket')).json()).map(b => b.id));
let copied = 0;
for (const bucket of buckets) {
  if (!existing.has(bucket.id)) {
    await call(dst, 'POST', 'bucket', {
      body: { id: bucket.id, name: bucket.name, public: bucket.public,
        file_size_limit: bucket.file_size_limit, allowed_mime_types: bucket.allowed_mime_types },
      extra: { 'Content-Type': 'application/json' }
    });
    console.log(`bucket yaradıldı: ${bucket.id}`);
  }
  const files = await listFiles(src, bucket.id);
  console.log(`${bucket.id}: ${files.length} fayl`);
  for (const file of files) {
    const objectPath = `object/${encodeURIComponent(bucket.id)}/${encodePath(file.path)}`;
    const data = await (await call(src, 'GET', objectPath)).arrayBuffer();
    await call(dst, 'POST', objectPath, {
      body: data, raw: true,
      extra: {
        'Content-Type': file.mimetype || 'application/octet-stream',
        'Cache-Control': file.cacheControl || 'max-age=3600',
        'x-upsert': 'true'
      }
    });
    copied += 1;
  }
}
console.log(`Hazırdır: ${copied} fayl köçürüldü.`);
