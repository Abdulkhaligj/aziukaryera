// The PostgREST query language, as far as the portal uses it:
// select=col,alias:col,rel!hint!inner(cols), col=op.value filters, order.
import { pgErrors } from './errors.ts';

export type SelectItem =
  | { type: 'star' }
  | { type: 'column'; name: string; alias: string | null }
  | { type: 'embed'; alias: string | null; relation: string; hint: string | null; inner: boolean; items: SelectItem[] };

export interface Filter { column: string; op: string; negate: boolean; value: string }
export interface OrderTerm { column: string; desc: boolean; nulls: 'first' | 'last' | null }

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns', 'apikey']);
export const FILTER_OPS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in', 'cs', 'cd']);

/** Split on commas that are not inside parentheses or double quotes. */
function splitTop(input: string): string[] {
  const parts: string[] = [];
  let depth = 0, quoted = false, current = '';
  for (const ch of input) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && ch === '(') depth++;
    if (!quoted && ch === ')') depth--;
    if (!quoted && depth === 0 && ch === ',') { parts.push(current); current = ''; continue; }
    current += ch;
  }
  if (depth !== 0 || quoted) throw pgErrors.parse('"failed to parse select parameter"', input);
  parts.push(current);
  return parts.map(p => p.trim()).filter(Boolean);
}

export function parseSelect(input: string | undefined): SelectItem[] {
  if (!input || input.trim() === '*') return [{ type: 'star' }];
  return splitTop(input.replace(/\s+/g, '')).map(parseItem);
}

function parseItem(raw: string): SelectItem {
  if (raw === '*') return { type: 'star' };
  const open = raw.indexOf('(');
  if (open >= 0) {
    if (!raw.endsWith(')')) throw pgErrors.parse('"failed to parse select parameter"', raw);
    let head = raw.slice(0, open);
    const items = parseSelect(raw.slice(open + 1, -1));
    let alias: string | null = null;
    const colon = head.indexOf(':');
    if (colon >= 0) { alias = head.slice(0, colon); head = head.slice(colon + 1); }
    const parts = head.split('!');
    const relation = parts.shift()!;
    let hint: string | null = null, inner = false;
    for (const part of parts) {
      if (part === 'inner') inner = true;
      else if (part === 'left') inner = false;
      else hint = part;
    }
    for (const name of [relation, alias, hint]) if (name !== null && !IDENT.test(name)) throw pgErrors.parse('"failed to parse select parameter"', raw);
    return { type: 'embed', alias, relation, hint, inner, items };
  }
  let alias: string | null = null, name = raw;
  const colon = raw.indexOf(':');
  if (colon >= 0 && raw[colon + 1] !== ':') { alias = raw.slice(0, colon); name = raw.slice(colon + 1); }
  name = name.replace(/::\w+$/, '');
  if (!IDENT.test(name) || (alias !== null && !IDENT.test(alias))) throw pgErrors.parse('"failed to parse select parameter"', raw);
  return { type: 'column', name, alias };
}

export function parseFilters(query: Record<string, unknown>): Filter[] {
  const filters: Filter[] = [];
  for (const [key, rawValue] of Object.entries(query)) {
    if (RESERVED.has(key)) continue;
    for (const raw of Array.isArray(rawValue) ? rawValue : [rawValue]) {
      if (typeof raw !== 'string') continue;
      if (key === 'or' || key === 'and' || key.includes('.')) {
        throw pgErrors.parse(`"${key}" filters are not supported by this API`, `${key}=${raw}`);
      }
      if (!IDENT.test(key)) throw pgErrors.parse(`"failed to parse filter (${key})"`);
      let rest = raw, negate = false;
      if (rest.startsWith('not.')) { negate = true; rest = rest.slice(4); }
      const dot = rest.indexOf('.');
      const op = dot < 0 ? rest : rest.slice(0, dot);
      if (!FILTER_OPS.has(op)) throw pgErrors.parse(`"failed to parse filter (${raw})"`, `unknown operator ${op}`);
      filters.push({ column: key, op, negate, value: dot < 0 ? '' : rest.slice(dot + 1) });
    }
  }
  return filters;
}

/** in.(a,b,"c,d") → ['a', 'b', 'c,d'] */
export function parseList(value: string): string[] {
  if (!value.startsWith('(') || !value.endsWith(')')) throw pgErrors.parse(`"failed to parse filter (in.${value})"`);
  const inner = value.slice(1, -1);
  if (inner === '') return [];
  const items: string[] = [];
  let current = '', quoted = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '"') { quoted = !quoted; continue; }
    if (ch === '\\' && quoted && i + 1 < inner.length) { current += inner[++i]; continue; }
    if (ch === ',' && !quoted) { items.push(current); current = ''; continue; }
    current += ch;
  }
  items.push(current);
  return items;
}

export function parseOrder(value: unknown): OrderTerm[] {
  if (typeof value !== 'string' || !value) return [];
  return value.split(',').map(term => {
    const [column, ...mods] = term.split('.');
    if (!IDENT.test(column)) throw pgErrors.parse(`"failed to parse order (${value})"`);
    const desc = mods.includes('desc');
    const nulls = mods.includes('nullsfirst') ? 'first' : mods.includes('nullslast') ? 'last' : null;
    return { column, desc, nulls };
  });
}
