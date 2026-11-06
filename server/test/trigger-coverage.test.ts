// Every Postgres trigger on a public table has a port with the same name,
// timing, events and UPDATE OF columns (db/source/pg-triggers.json is the
// schema-only export), and no port exists that Postgres does not have.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../src/write/rules/index.ts';
import { registeredTriggers } from '../src/write/pipeline.ts';

const source = JSON.parse(readFileSync(new URL('../db/source/pg-triggers.json', import.meta.url), 'utf8')) as { table: string; name: string; def: string }[];

function expected() {
  const list: string[] = [];
  for (const { table, name, def } of source) {
    const m = def.match(/ (BEFORE|AFTER) (.+?) ON public\.\S+ FOR EACH ROW/);
    assert.ok(m, `unparsed trigger ${table}.${name}`);
    for (const event of m[2].split(' OR ')) {
      const [, op, of] = event.match(/^(INSERT|UPDATE|DELETE)(?: OF (.+))?$/)!;
      list.push(`${table}.${name} ${m[1]} ${op.toLowerCase()}${of ? ' of ' + of.split(', ').sort().join(',') : ''}`);
    }
  }
  return list.sort();
}

test('every Postgres trigger is ported with the same name, events and UPDATE OF columns', () => {
  const ported = registeredTriggers()
    .map(t => `${t.table}.${t.name} ${t.timing} ${t.op}${t.op === 'update' && t.of ? ' of ' + [...t.of].sort().join(',') : ''}`).sort();
  const want = expected();
  assert.deepEqual(want.filter(x => !ported.includes(x)), [], 'missing ports');
  assert.deepEqual(ported.filter(x => !want.includes(x)), [], 'ports without a Postgres trigger');
  assert.equal(new Set(source.map(s => `${s.table}.${s.name}`)).size, 77);
});
