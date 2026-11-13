// PostgREST filters, ordering and column selection applied to rows already in
// memory: the result of a set-returning RPC (`rpc/name?select=…&col=eq.x`).
import { pgErrors } from './errors.ts';
import { isGroup, parseList, type Filter, type FilterNode, type OrderTerm, type SelectItem } from './parse.ts';
import type { Row } from '../db.ts';

const numeric = (v: unknown) => typeof v === 'number';

/** Compares a stored value with the text of a filter, by the stored value's type. */
function compare(value: unknown, raw: string): number {
  if (numeric(value)) { const n = Number(raw); return value as number < n ? -1 : value as number > n ? 1 : 0; }
  if (typeof value === 'boolean') { const b = raw === 'true'; return value === b ? 0 : value ? 1 : -1; }
  const text = String(value);
  return text < raw ? -1 : text > raw ? 1 : 0;
}

/** LIKE / ILIKE (`%` or `*` any run, `_` one character) without a regular
 *  expression: the greedy wildcard matcher backtracks at most to the last `%`,
 *  so the time is linear in text × pattern, never exponential (audit
 *  2026-11-13, H-03). Patterns are capped like PostgREST inputs. */
const MAX_PATTERN = 1000;
export function likeMatch(text: string, pattern: string, insensitive: boolean): boolean {
  if ([...pattern].length > MAX_PATTERN) throw pgErrors.parse('pattern too long');
  const fold = (x: string) => (insensitive ? x.toLowerCase() : x);
  const t = [...fold(text)];
  const p = [...fold(pattern)].map(c => (c === '*' ? '%' : c));
  let ti = 0, pi = 0, star = -1, mark = 0;
  while (ti < t.length) {
    if (pi < p.length && (p[pi] === '_' || (p[pi] !== '%' && p[pi] === t[ti]))) { ti++; pi++; }
    else if (pi < p.length && p[pi] === '%') { star = pi++; mark = ti; }
    else if (star !== -1) { pi = star + 1; ti = ++mark; }
    else return false;
  }
  while (pi < p.length && p[pi] === '%') pi++;
  return pi === p.length;
}

function contains(container: unknown, items: unknown): boolean {
  if (!Array.isArray(container) || !Array.isArray(items)) return false;
  return items.every(i => container.some(c => JSON.stringify(c) === JSON.stringify(i)));
}

function arrayValue(raw: string): unknown[] {
  if (raw.startsWith('[')) return JSON.parse(raw);
  if (raw.startsWith('{') && raw.endsWith('}')) return parseList(`(${raw.slice(1, -1)})`);
  throw pgErrors.parse(`"failed to parse filter (cs.${raw})"`);
}

function comparison(row: Row, f: Filter): boolean {
  if (!(f.column in row)) throw pgErrors.parse(`column "${f.column}" does not exist in the function result`);
  const value = row[f.column];
  let ok: boolean;
  if (f.op === 'is') {
    const v = f.value.toLowerCase();
    ok = v === 'null' || v === 'unknown' ? value == null : value === (v === 'true');
  } else if (value == null) {
    ok = false; // NULL compares as unknown
  } else switch (f.op) {
    case 'eq': ok = compare(value, f.value) === 0; break;
    case 'neq': ok = compare(value, f.value) !== 0; break;
    case 'gt': ok = compare(value, f.value) > 0; break;
    case 'gte': ok = compare(value, f.value) >= 0; break;
    case 'lt': ok = compare(value, f.value) < 0; break;
    case 'lte': ok = compare(value, f.value) <= 0; break;
    case 'like': ok = likeMatch(String(value), f.value, false); break;
    case 'ilike': ok = likeMatch(String(value), f.value, true); break;
    case 'in': ok = parseList(f.value).some(v => compare(value, v) === 0); break;
    case 'cs': ok = contains(value, arrayValue(f.value)); break;
    default: ok = contains(arrayValue(f.value), value); break; // cd
  }
  return f.negate ? !ok : ok;
}

export function rowMatches(row: Row, node: FilterNode): boolean {
  if (!isGroup(node)) return comparison(row, node);
  const ok = node.logic === 'or' ? node.items.some(i => rowMatches(row, i)) : node.items.every(i => rowMatches(row, i));
  return node.negate ? !ok : ok;
}

/** Postgres ordering: ASC → NULLS LAST, DESC → NULLS FIRST. */
export function sortRows(rows: Row[], order: OrderTerm[]): Row[] {
  if (!order.length) return rows;
  return [...rows].sort((a, b) => {
    for (const o of order) {
      const x = a[o.column], y = b[o.column];
      if (x == null || y == null) {
        if (x == null && y == null) continue;
        const nullsFirst = o.nulls ? o.nulls === 'first' : o.desc;
        return (x == null) === nullsFirst ? -1 : 1;
      }
      const c = numeric(x) && numeric(y) ? (x as number) - (y as number) : String(x) < String(y) ? -1 : String(x) > String(y) ? 1 : 0;
      if (c !== 0) return o.desc ? -c : c;
    }
    return 0;
  });
}

export function selectColumns(rows: Row[], items: SelectItem[]): Row[] {
  if (items.some(i => i.type === 'star')) return rows;
  if (items.some(i => i.type === 'embed')) throw pgErrors.parse('Embedding is not available on function results');
  return rows.map(row => Object.fromEntries(items.map(i => {
    const item = i as Extract<SelectItem, { type: 'column' }>;
    if (!(item.name in row)) throw pgErrors.parse(`column "${item.name}" does not exist in the function result`);
    return [item.alias ?? item.name, row[item.name]];
  })));
}
