// Reads with PostgREST semantics: row-level policies on every table touched
// (embedded ones included), filters, Postgres NULL ordering, exact counts and
// resource embedding over foreign keys (batched, no N+1).
import type { Context } from '../context.ts';
import { rows as queryRows, toMysqlDatetime, type Row, type Tx } from '../db.ts';
import { table as tableOf, type Column, type ForeignKey, type Schema, type Table } from '../schema.ts';
import { q } from '../write/pipeline.ts';
import { pgErrors } from './errors.ts';
import { parseList, type Filter, type OrderTerm, type SelectItem } from './parse.ts';
import { exposed, granted, usingSql } from './policy.ts';

export interface Where { sql: string[]; params: unknown[] }
export const noWhere = (): Where => ({ sql: [], params: [] });

function filterValue(column: Column, raw: string): unknown {
  if (column.columnType === 'tinyint(1)') return raw === 'true' ? 1 : raw === 'false' ? 0 : raw;
  if (column.dataType === 'datetime') {
    try { return toMysqlDatetime(raw); } catch { throw pgErrors.parse(`invalid input syntax for type timestamp with time zone: "${raw}"`); }
  }
  return raw;
}

/** {a,b} (Postgres array literal) or JSON → JSON text for JSON_CONTAINS. */
function containsValue(raw: string): string {
  if (raw.startsWith('[') || raw.startsWith('{"') || raw === '{}') {
    if (raw === '{}') return '[]';
    try { return JSON.stringify(JSON.parse(raw)); } catch { /* array literal below */ }
  }
  if (raw.startsWith('{') && raw.endsWith('}')) return JSON.stringify(parseList(`(${raw.slice(1, -1)})`));
  throw pgErrors.parse(`"failed to parse filter (cs.${raw})"`);
}

export function filterSql(t: Table, filters: Filter[]): Where {
  const where = noWhere();
  for (const f of filters) {
    const column = t.columns.get(f.column);
    if (!column) throw pgErrors.column(t.name, f.column);
    const c = q(f.column);
    let expr: string;
    switch (f.op) {
      case 'eq': case 'neq': case 'gt': case 'gte': case 'lt': case 'lte':
        expr = `${c} ${{ eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }[f.op]} ?`;
        where.params.push(filterValue(column, f.value));
        break;
      case 'like':
        expr = `${c} LIKE ? COLLATE utf8mb4_0900_as_cs`;
        where.params.push(f.value.replace(/\*/g, '%'));
        break;
      case 'ilike': // the column collation is case-insensitive already
        expr = `${c} LIKE ?`;
        where.params.push(f.value.replace(/\*/g, '%'));
        break;
      case 'is': {
        const v = f.value.toLowerCase();
        if (v !== 'null' && v !== 'true' && v !== 'false' && v !== 'unknown') throw pgErrors.parse(`"failed to parse filter (is.${f.value})"`);
        expr = v === 'null' || v === 'unknown' ? `${c} IS NULL` : `${c} IS ${v.toUpperCase()}`;
        break;
      }
      case 'in': {
        const list = parseList(f.value);
        expr = list.length ? `${c} IN (${list.map(() => '?').join(', ')})` : 'FALSE';
        where.params.push(...list.map(v => filterValue(column, v)));
        break;
      }
      default: // cs / cd on JSON (array) columns
        expr = f.op === 'cs' ? `JSON_CONTAINS(${c}, CAST(? AS JSON))` : `JSON_CONTAINS(CAST(? AS JSON), ${c})`;
        where.params.push(containsValue(f.value));
    }
    where.sql.push(f.negate ? `NOT (${expr})` : expr);
  }
  return where;
}

/** Postgres defaults: ASC → NULLS LAST, DESC → NULLS FIRST. */
export function orderSql(t: Table, order: OrderTerm[]): string {
  if (!order.length) return t.primaryKey.length ? ` ORDER BY ${t.primaryKey.map(q).join(', ')}` : '';
  return ' ORDER BY ' + order.map(o => {
    if (!t.columns.has(o.column)) throw pgErrors.column(t.name, o.column);
    const nullsFirst = o.nulls ? o.nulls === 'first' : o.desc;
    return `(${q(o.column)} IS NULL) ${nullsFirst ? 'DESC' : 'ASC'}, ${q(o.column)} ${o.desc ? 'DESC' : 'ASC'}`;
  }).join(', ');
}

interface Relation { kind: 'one' | 'many'; fk: ForeignKey; target: string }

function resolve(schema: Schema, from: Table, item: Extract<SelectItem, { type: 'embed' }>): Relation {
  const target = item.relation;
  if (!schema.has(target) || !exposed(target)) throw pgErrors.relationship(from.name, target);
  const candidates: Relation[] = [
    ...from.foreignKeys.filter(fk => fk.refTable === target).map(fk => ({ kind: 'one' as const, fk, target })),
    ...tableOf(schema, target).foreignKeys.filter(fk => fk.refTable === from.name && target !== from.name)
      .map(fk => ({ kind: 'many' as const, fk, target }))
  ].filter(c => !item.hint || c.fk.name === item.hint || c.fk.columns.join(',') === item.hint);
  if (!candidates.length) throw pgErrors.relationship(from.name, target);
  if (candidates.length > 1) throw pgErrors.ambiguous(from.name, target);
  return candidates[0];
}

function tupleIn(columns: string[], tuples: unknown[][]): Where {
  if (columns.length === 1) return { sql: [`${q(columns[0])} IN (${tuples.map(() => '?').join(', ')})`], params: tuples.map(t => t[0]) };
  return {
    sql: [`(${columns.map(q).join(', ')}) IN (${tuples.map(t => `(${t.map(() => '?').join(', ')})`).join(', ')})`],
    params: tuples.flat()
  };
}
const tupleKey = (row: Row, columns: string[]) => JSON.stringify(columns.map(c => row[c]));

export interface ReadOptions { where?: Where; order?: OrderTerm[]; limit?: number | null; offset?: number; count?: boolean }

/** rows: shaped for the response; raw: the same rows with every fetched column. */
export async function readRows(tx: Tx, schema: Schema, ctx: Context, tableName: string, items: SelectItem[], options: ReadOptions = {})
  : Promise<{ rows: Row[]; raw: Row[]; total: number | null }> {
  const t = tableOf(schema, tableName);
  if (!granted(tableName, ctx, 'SELECT')) throw pgErrors.permission(ctx, tableName);
  const embeds = items.filter((i): i is Extract<SelectItem, { type: 'embed' }> => i.type === 'embed');
  const relations = embeds.map(e => resolve(schema, t, e));
  const wanted = new Set<string>();
  for (const item of items) {
    if (item.type === 'star') t.columns.forEach((_, name) => wanted.add(name));
    if (item.type === 'column') { if (!t.columns.has(item.name)) throw pgErrors.column(tableName, item.name); wanted.add(item.name); }
  }
  for (const r of relations) (r.kind === 'one' ? r.fk.columns : r.fk.refColumns).forEach(c => wanted.add(c));
  t.primaryKey.forEach(c => wanted.add(c));
  const where = options.where ?? noWhere();
  const clause = [usingSql(tableName, ctx, 'SELECT'), ...where.sql].map(s => `(${s})`).join(' AND ');
  const paging = options.limit != null ? ` LIMIT ${Number(options.limit)} OFFSET ${Number(options.offset || 0)}`
    : options.offset ? ` LIMIT 18446744073709551615 OFFSET ${Number(options.offset)}` : '';
  const raw = await queryRows(tx, `SELECT ${[...wanted].map(q).join(', ')} FROM ${q(tableName)} WHERE ${clause}${orderSql(t, options.order || [])}${paging}`, where.params);
  let total: number | null = null;
  if (options.count) total = Number((await queryRows<{ n: number }>(tx, `SELECT COUNT(*) AS n FROM ${q(tableName)} WHERE ${clause}`, where.params))[0].n);

  const attached = new Map<string, Map<string, Row | Row[] | null>>();
  for (const [i, embed] of embeds.entries()) {
    const rel = relations[i];
    const parentCols = rel.kind === 'one' ? rel.fk.columns : rel.fk.refColumns;
    const childCols = rel.kind === 'one' ? rel.fk.refColumns : rel.fk.columns;
    const tuples = [...new Map(raw.filter(r => parentCols.every(c => r[c] != null)).map(r => [tupleKey(r, parentCols), parentCols.map(c => r[c])])).values()];
    const children = tuples.length
      ? await readRows(tx, schema, ctx, rel.target, [...embed.items, ...childCols.map(name => ({ type: 'column' as const, name, alias: null }))], { where: tupleIn(childCols, tuples) })
      : { rows: [], raw: [] };
    const byKey = new Map<string, Row | Row[] | null>();
    children.raw.forEach((child, n) => {
      const key = tupleKey(child, childCols);
      const shaped = shape(tableOf(schema, rel.target), embed.items, children.rows[n]);
      if (rel.kind === 'one') byKey.set(key, shaped);
      else (byKey.get(key) as Row[] | undefined)?.push(shaped) ?? byKey.set(key, [shaped]);
    });
    attached.set(embed.alias ?? embed.relation, new Map(raw.map(r => {
      const key = tupleKey(r, parentCols);
      return [tupleKey(r, t.primaryKey.length ? t.primaryKey : [...wanted]), byKey.get(key) ?? (rel.kind === 'one' ? null : [])];
    })));
  }

  let keep = raw;
  for (const embed of embeds.filter(e => e.inner)) {
    const values = attached.get(embed.alias ?? embed.relation)!;
    keep = keep.filter(r => { const v = values.get(tupleKey(r, t.primaryKey.length ? t.primaryKey : [...wanted])); return Array.isArray(v) ? v.length > 0 : v != null; });
  }
  const rows = keep.map(r => {
    const out = shape(t, items, r);
    for (const [key, values] of attached) out[key] = values.get(tupleKey(r, t.primaryKey.length ? t.primaryKey : [...wanted])) ?? null;
    return out;
  });
  return { rows, raw: keep, total };
}

/** Response object: requested columns in select order (embeds filled by the caller). */
function shape(t: Table, items: SelectItem[], row: Row): Row {
  const out: Row = {};
  for (const item of items) {
    if (item.type === 'star') t.columns.forEach((_, name) => { out[name] = row[name]; });
    else if (item.type === 'column') out[item.alias ?? item.name] = row[item.name];
    else out[item.alias ?? item.relation] = row[item.alias ?? item.relation] ?? null;
  }
  return out;
}
