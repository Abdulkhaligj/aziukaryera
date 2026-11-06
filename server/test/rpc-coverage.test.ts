// Every .rpc('name') call in the portal, the admin panel and the Edge Functions
// has a port in src/rpc (a new call without one fails here, not in production).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import '../src/rpc/index.ts';
import { findRpc } from '../src/rpc/registry.ts';

const ROOT = new URL('../../', import.meta.url).pathname;
const DIRS = ['student-web', 'app', 'lib', 'supabase/functions'];

function* files(dir: string): Generator<string> {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (/\.(m?js|tsx?)$/.test(name)) yield path;
  }
}

test('every RPC the apps call is ported', () => {
  const called = new Map<string, string>();
  for (const dir of DIRS) for (const file of files(join(ROOT, dir))) {
    for (const m of readFileSync(file, 'utf8').matchAll(/\.rpc\(\s*['"`]([a-z_0-9]+)['"`]/g)) called.set(m[1], file.slice(ROOT.length));
  }
  assert.ok(called.size >= 20, `found ${called.size} RPC names`);
  const missing = [...called].filter(([name]) => !findRpc(name)).map(([name, file]) => `${name} (${file})`);
  assert.deepEqual(missing, []);
});
