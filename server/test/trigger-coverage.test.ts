// Every Postgres trigger on a public table (and our two on storage.objects) has a port with the same name,
// timing, events, UPDATE OF columns and function security (db/source/pg-triggers.json is the
// schema-only export), and no port exists that Postgres does not have.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../src/write/rules/index.ts';
import { registeredTriggers } from '../src/write/pipeline.ts';

const source = JSON.parse(readFileSync(new URL('../db/source/pg-triggers.json', import.meta.url), 'utf8')) as { table: string; name: string; def: string; security: string }[];

function expected() {
  const list: string[] = [];
  for (const { table, name, def, security } of source) {
    const m = def.match(/ (BEFORE|AFTER) (.+?) ON (?:public|storage)\.\S+ FOR EACH ROW/);
    assert.ok(m, `unparsed trigger ${table}.${name}`);
    for (const event of m[2].split(' OR ')) {
      const [, op, of] = event.match(/^(INSERT|UPDATE|DELETE)(?: OF (.+))?$/)!;
      list.push(`${table}.${name} ${m[1]} ${op.toLowerCase()}${of ? ' of ' + of.split(', ').sort().join(',') : ''} ${security}`);
    }
  }
  return list.sort();
}

test('every Postgres trigger is ported with the same name, events, UPDATE OF columns and security', () => {
  const ported = registeredTriggers()
    .map(t => `${t.table}.${t.name} ${t.timing} ${t.op}${t.op === 'update' && t.of ? ' of ' + [...t.of].sort().join(',') : ''} ${t.security}`).sort();
  const want = expected();
  assert.deepEqual(want.filter(x => !ported.includes(x)), [], 'missing ports');
  // Guards added by the security audit of 2026-11-13 (src/write/rules/hardening.ts) have no Postgres original.
  const added = (x: string) => /^\S+\.001_security_/.test(x)
    || /^(moderation_terms|moderation_allow)\.security_audit_changes /.test(x) || /^(post_comments|messages)\.security_audit_deletes /.test(x);
  assert.deepEqual(ported.filter(x => !want.includes(x) && !added(x)), [], 'ports without a Postgres trigger');
  // 77 on public tables, plus the 2 avatar triggers on storage.objects (the storage service's own triggers are not ours).
  assert.equal(new Set(source.map(s => `${s.table}.${s.name}`)).size, 79);
});
