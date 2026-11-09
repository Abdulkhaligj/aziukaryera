// The PostgREST query language, as far as the portal uses it:
// select=col,alias:col,rel!hint!inner(cols), col=op.value filters, order.
import { pgErrors } from './errors.ts';

export type SelectItem =
  | { type: 'star' }
  | { type: 'column'; name: string; alias: string | null }
  | { type: 'embed'; alias: string | null; relation: string; hint: string | null; inner: boolean; items: SelectItem[] };

export interface Filter { column: string; op: string; negate: boolean; value: string }
/** A comparison, or an or/and group of nodes (PostgREST logic trees). */
export type FilterNode = Filter | { logic: 'or' | 'and'; negate: boolean; items: FilterNode[] };
/** A filter and the embedded resource it applies to ([] = the main table). */
export interface ScopedFilter { path: string[]; node: FilterNode }
export const isGroup = (n: FilterNode): n is Extract<FilterNode, { logic: string }> => 'logic' in n;
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

/** op.value or not.op.value → a comparison on `column`. */
function comparison(column: string, raw: string): Filter {
  if (!IDENT.test(column)) throw pgErrors.parse(`"failed to parse filter (${column})"`);
  let rest = raw, negate = false;
  if (rest.startsWith('not.')) { negate = true; rest = rest.slice(4); }
  const dot = rest.indexOf('.');
  const op = dot < 0 ? rest : rest.slice(0, dot);
  if (!FILTER_OPS.has(op)) throw pgErrors.parse(`"failed to parse filter (${raw})"`, `unknown operator ${op}`);
  let value = dot < 0 ? '' : rest.slice(dot + 1);
  // Inside logic trees, values may be double-quoted to protect commas and parentheses.
  if (op !== 'in' && /^".*"$/s.test(value)) value = value.slice(1, -1).replace(/\\(.)/g, '$1');
  return { column, op, negate, value };
}

/** (a.eq.1,b.gt.2,and(c.lt.3,d.is.null)) → nodes. */
function logicTree(logic: 'or' | 'and', negate: boolean, raw: string): FilterNode {
  if (!raw.startsWith('(') || !raw.endsWith(')')) throw pgErrors.parse(`"failed to parse logic tree (${raw})"`);
  const items: FilterNode[] = [];
  for (const part of splitTerms(raw.slice(1, -1))) {
    const term = part.trim();
    const group = term.match(/^(not\.)?(and|or)(\(.*\))$/s);
    if (group) { items.push(logicTree(group[2] as 'or' | 'and', !!group[1], group[3])); continue; }
    const dot = term.indexOf('.');
    if (dot <= 0) throw pgErrors.parse(`"failed to parse logic tree (${raw})"`);
    items.push(comparison(term.slice(0, dot), term.slice(dot + 1)));
  }
  return { logic, negate, items };
}

/** Logic-tree terms: commas outside parentheses and double quotes (with \\ escapes). */
function splitTerms(input: string): string[] {
  const parts: string[] = [];
  let depth = 0, quoted = false, current = '';
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '\\' && quoted && i + 1 < input.length) { current += ch + input[++i]; continue; }
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === '(') depth++;
    else if (!quoted && ch === ')') depth--;
    if (ch === ',' && depth === 0 && !quoted) { parts.push(current); current = ''; continue; }
    current += ch;
  }
  if (current !== '') parts.push(current);
  return parts;
}

/** col=op.value, or=(…), and=(…), not.or=(…), and the same behind an
 *  embedded resource path (profiles.full_name=eq.X, profiles.or=(…)). */
export function parseFilters(query: Record<string, unknown>): ScopedFilter[] {
  const filters: ScopedFilter[] = [];
  for (const [key, rawValue] of Object.entries(query)) {
    if (RESERVED.has(key)) continue;
    for (const raw of Array.isArray(rawValue) ? rawValue : [rawValue]) {
      if (typeof raw !== 'string') continue;
      const segments = key.split('.');
      // rel.order / rel.limit / rel.offset shape an embedded resource (see embedOptions).
      if (segments.length > 1 && ['order', 'limit', 'offset'].includes(segments.at(-1)!)) continue;
      const negatedLogic = segments.length >= 2 && segments.at(-2) === 'not' && ['or', 'and'].includes(segments.at(-1)!);
      const path = segments.slice(0, negatedLogic ? -2 : -1);
      const last = segments.at(-1)!;
      if (path.some(p => !IDENT.test(p))) throw pgErrors.parse(`"failed to parse filter (${key})"`);
      const node = last === 'or' || last === 'and' ? logicTree(last, negatedLogic, raw) : comparison(last, raw);
      filters.push({ path, node });
    }
  }
  return filters;
}

/** The filters of one resource level. */
export const nodesAt = (filters: ScopedFilter[], path: string[] = []) =>
  filters.filter(f => f.path.length === path.length && f.path.every((p, i) => p === path[i])).map(f => f.node);

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

/** Ordering and paging of embedded resources: rel.order=col.desc, rel.limit=5,
 *  rel.offset=10, and the older order=rel(col.desc). Keyed by the path "a.b". */
export interface EmbedOptions { order?: OrderTerm[]; limit?: number; offset?: number }
export function embedOptions(query: Record<string, unknown>): Map<string, EmbedOptions> {
  const out = new Map<string, EmbedOptions>();
  const at = (path: string) => { if (!out.has(path)) out.set(path, {}); return out.get(path)!; };
  for (const [key, raw] of Object.entries(query)) {
    const segments = key.split('.');
    const last = segments.at(-1)!;
    if (segments.length < 2 || !['order', 'limit', 'offset'].includes(last) || typeof raw !== 'string') continue;
    const path = segments.slice(0, -1);
    if (path.some(p => !IDENT.test(p))) throw pgErrors.parse(`"failed to parse ${last} (${key})"`);
    if (last === 'order') at(path.join('.')).order = parseOrder(raw);
    else {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0) throw pgErrors.parse(`"failed to parse ${last} (${raw})"`);
      at(path.join('.'))[last as 'limit' | 'offset'] = n;
    }
  }
  return out;
}

/** order=a.desc,rel(col.asc) → the top-level terms, with rel(...) moved to embedOptions. */
export function splitOrder(value: unknown, embeds: Map<string, EmbedOptions>): OrderTerm[] {
  if (typeof value !== 'string' || !value) return [];
  const top: string[] = [];
  for (const term of splitTerms(value)) {
    const nested = term.match(/^([A-Za-z_][A-Za-z0-9_]*)\((.*)\)$/s);
    if (nested) {
      const options = embeds.get(nested[1]) ?? {};
      options.order = [...(options.order ?? []), ...parseOrder(nested[2])];
      embeds.set(nested[1], options);
    } else top.push(term);
  }
  return parseOrder(top.join(','));
}
