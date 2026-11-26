import test from 'node:test';
import assert from 'node:assert/strict';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { readdirSync } from 'node:fs';
import { readSource } from './read-source.mjs';

/* The university WAF in front of career.asoiu.edu.az answers 403 to embedded
 * selects (`companies(name)`), to `in.(…)` and to `or=(…)` filters (checked
 * 2026-11-26). Neither the admin panel nor the site may send them. */

const EMBEDDED = /\.select\(\s*['"`][^'"`]*\(/;

test('admin loader and site code send no embedded select, in() or or() filter', () => {
  const admin = readSource('lib/admin-data.ts');
  assert.doesNotMatch(admin, EMBEDDED);
  assert.doesNotMatch(admin, /\.(in|or)\(/);
  const dir = 'student-web/assets/js';
  for (const file of readdirSync(dir).filter(name => name.endsWith('.js') && name !== 'i18n-dict.js')) {
    const source = readSource(`${dir}/${file}`);
    assert.doesNotMatch(source, EMBEDDED, file);
    assert.doesNotMatch(source, /\.sb\.from\([^)]*\)[^;]*\.(in|or)\(/, file);
  }
});

function loadAdmin() {
  let source = readSource('lib/admin-data.ts').replace(/^import .*;\r?\n/gm, '');
  source = stripTypeScriptTypes(source, { mode: 'strip' }).replace(/^export /gm, '');
  const context = { console, Intl, Date, Promise, Map, Set, WeakMap, String, process: { env: {} } };
  vm.createContext(context);
  vm.runInContext(source + '\nglobalThis.subject = { loadResource };', context, { filename: 'lib/admin-data.ts' });
  return context.subject;
}

/** A fake API client: records each select and pages related tables by range. */
function fakeDb(tables) {
  const calls = [];
  const db = {
    from(table) {
      const q = { table, columns: '', offset: 0, limit: Infinity };
      const builder = {
        select(columns) { q.columns = columns; calls.push(q); return builder; },
        order() { return builder; },
        limit(n) { q.limit = n; return builder; },
        range(from, to) { q.offset = from; q.limit = to - from + 1; return builder; },
        then(resolve, reject) {
          const rows = (tables[table] || []).slice(q.offset, q.offset + q.limit);
          return Promise.resolve({ data: rows.map(row => ({ ...row })), error: null }).then(resolve, reject);
        }
      };
      return builder;
    }
  };
  return { db, calls };
}

test('admin lists join related rows without embedded selects, paging past 1000 rows', async () => {
  const { loadResource } = loadAdmin();
  const profiles = Array.from({ length: 1500 }, (_, i) => ({ id: `p${String(i).padStart(4, '0')}`, full_name: `Ad ${i}`, email: `${i}@x.invalid`, avatar_path: null }));
  const { db, calls } = fakeDb({
    jobs: [{ id: 'j1', title: 'Process Intern', status: 'pending', company_id: 'c1', created_at: '2026-11-20' }],
    companies: [{ id: 'c1', name: 'SOCAR' }],
    subscriptions: [{ id: 's1', plan_id: 'pro', status: 'active', company_id: 'c1', requested_at: '2026-11-20' }],
    plans: [{ id: 'pro', name: 'Pro', monthly_price: 49 }],
    notifications: [{ id: 'n1', kind: 'info', title: 'Salam', profile_id: 'p1200', created_at: '2026-11-20' }],
    cv_documents: [{ id: 'cv1', title: 'CV', language: 'az', ats_score: 80, profile_id: 'p0003', updated_at: '2026-11-20' }],
    profiles
  });
  const context = { db };
  const pending = await loadResource(context, 'pending_jobs');
  assert.equal(pending.length, 1);
  assert.match(pending[0].subtitle, /^SOCAR · /);
  const subscriptions = await loadResource(context, 'subscriptions');
  assert.equal(subscriptions[0].title, 'SOCAR');
  assert.match(subscriptions[0].subtitle, /^Pro · 49 AZN\/ay/);
  const notifications = await loadResource(context, 'notifications');
  assert.match(notifications[0].subtitle, /^Ad 1200 · /);
  const cvs = await loadResource(context, 'cv_analytics');
  assert.equal(cvs[0].title, 'Ad 3');
  for (const call of calls) assert.doesNotMatch(call.columns, /\(/, `${call.table}: ${call.columns}`);
  // Each related table is read once per request (profiles: two pages of 1000).
  assert.equal(calls.filter(call => call.table === 'profiles').length, 2);
  assert.equal(calls.filter(call => call.table === 'companies').length, 1);
});
