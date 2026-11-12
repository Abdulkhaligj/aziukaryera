// Copies the bytes of every storage object from the final backup's storage
// folder (<bucket>/<name>, as saved on 2026-11-12) to the API's disk
// (STORAGE_DIR/<bucket>/<name>). Run after import-from-backup.mjs, which copies
// the storage_objects rows; every row must have its file, with the same size.
// Existing files of the same size are skipped, so the script can be re-run.
//
//   STORAGE_SOURCE_DIR=/backup/storage MYSQL_URL=mysql://… STORAGE_DIR=/srv/asoiu/storage node db/import-storage-files.mjs
import { copyFile, mkdir, rename, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import mysql from 'mysql2/promise';

const need = name => process.env[name] || (() => { throw new Error(`${name} is required`); })();
const from = resolve(need('STORAGE_SOURCE_DIR'));
const root = resolve(need('STORAGE_DIR'));
const db = await mysql.createConnection(need('MYSQL_URL'));
const [objects] = await db.query('SELECT bucket_id, name, size FROM storage_objects ORDER BY bucket_id, name');
let copied = 0, skipped = 0, failed = 0;
for (const o of objects) {
  const parts = [o.bucket_id, ...o.name.split('/')];
  const target = resolve(join(root, ...parts));
  const source = resolve(join(from, ...parts));
  if (!target.startsWith(root + sep) || !source.startsWith(from + sep)) { console.error(`skip unsafe name: ${o.bucket_id}/${o.name}`); failed++; continue; }
  const existing = await stat(target).catch(() => null);
  if (existing && existing.size === Number(o.size)) { skipped++; continue; }
  const original = await stat(source).catch(() => null);
  if (!original || original.size !== Number(o.size)) { console.error(`missing or wrong size in backup: ${o.bucket_id}/${o.name}`); failed++; continue; }
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, `${target}.import`);
  await rename(`${target}.import`, target);
  copied++;
}
await db.end();
console.log(`Fayllar: ${copied} köçürüldü, ${skipped} artıq var idi, ${failed} xəta (cəmi ${objects.length}).`);
process.exitCode = failed ? 1 : 0;
