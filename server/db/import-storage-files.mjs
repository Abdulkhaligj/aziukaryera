// Copies the bytes of every storage object from Supabase Storage to the API's
// disk (STORAGE_DIR/<bucket>/<name>). Run after import-from-supabase.mjs, which
// copies the storage_objects rows; this reads those rows and fetches each file
// with the Supabase service key. Existing files of the same size are skipped,
// so the script can be re-run (e.g. once on the dry run, again at cutover).
//
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=… \
//   MYSQL_URL=mysql://… STORAGE_DIR=/srv/asoiu/storage node db/import-storage-files.mjs
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import mysql from 'mysql2/promise';

const need = name => process.env[name] || (() => { throw new Error(`${name} is required`); })();
const base = need('SUPABASE_URL').replace(/\/$/, '');
const key = need('SUPABASE_SERVICE_ROLE_KEY');
const root = resolve(need('STORAGE_DIR'));
const db = await mysql.createConnection(need('MYSQL_URL'));
const [objects] = await db.query('SELECT bucket_id, name, size FROM storage_objects ORDER BY bucket_id, name');
let copied = 0, skipped = 0, failed = 0;
for (const o of objects) {
  const target = resolve(join(root, o.bucket_id, ...o.name.split('/')));
  if (!target.startsWith(root + sep)) { console.error(`skip unsafe name: ${o.bucket_id}/${o.name}`); failed++; continue; }
  const existing = await stat(target).catch(() => null);
  if (existing && existing.size === Number(o.size)) { skipped++; continue; }
  const url = `${base}/storage/v1/object/${encodeURIComponent(o.bucket_id)}/${o.name.split('/').map(encodeURIComponent).join('/')}`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${key}`, apikey: key } });
  if (!res.ok) { console.error(`failed ${res.status}: ${o.bucket_id}/${o.name}`); failed++; continue; }
  const bytes = new Uint8Array(await res.arrayBuffer());
  await mkdir(dirname(target), { recursive: true });
  await writeFile(`${target}.import`, bytes);
  await rename(`${target}.import`, target);
  if (bytes.length !== Number(o.size)) console.warn(`size differs (${bytes.length} vs ${o.size}): ${o.bucket_id}/${o.name}`);
  copied++;
}
await db.end();
console.log(`files: ${objects.length}, copied: ${copied}, already there: ${skipped}, failed: ${failed}`);
if (failed) process.exitCode = 1;
