// Inserts, upserts, updates and deletes with Postgres RLS semantics: grants,
// WITH CHECK on the resulting row, USING (and SELECT USING, as for any
// UPDATE/DELETE with a WHERE clause) on the rows being changed.
import type { Context } from '../context.ts';
import { one, rows as queryRows, type Row, type Tx } from '../db.ts';
import { table as tableOf, type Schema, type Table } from '../schema.ts';
import { deleteRow, insertRow, q, toParam, updateRow, type WriteEnv } from '../write/pipeline.ts';
import { pgErrors } from './errors.ts';
import { checkSql, granted, usingSql } from './policy.ts';
import type { Where } from './select.ts';

const keyOf = (t: Table, row: Row) => Object.fromEntries(t.primaryKey.map(c => [c, row[c]]));

async function rowPasses(tx: Tx, t: Table, stored: Row, expr: string): Promise<boolean> {
  if (expr === 'TRUE') return true;
  const result = await one<{ ok: number | null }>(tx, `SELECT (${expr}) AS ok FROM ${q(t.name)} WHERE ${t.primaryKey.map(c => `${q(c)} = ?`).join(' AND ')}`,
    t.primaryKey.map(c => toParam(t.columns.get(c)!, stored[c])));
  return !!result && Number(result.ok) === 1;
}

function validateColumns(t: Table, row: Row) {
  for (const key of Object.keys(row)) if (!t.columns.has(key)) throw pgErrors.writeColumn(t.name, key);
}

export interface InsertOptions {
  onConflict: string[] | null;
  resolution: 'merge' | 'ignore' | null;
  columns: string[] | null;
  missingDefault: boolean;
}

/** Returns the primary keys of the inserted or merged rows, in input order. */
export async function insertRows(tx: Tx, schema: Schema, ctx: Context, tableName: string, input: Row[], options: InsertOptions): Promise<Row[]> {
  const t = tableOf(schema, tableName);
  if (!granted(tableName, ctx, 'INSERT')) throw pgErrors.permission(ctx, tableName);
  if (options.resolution === 'merge' && !granted(tableName, ctx, 'UPDATE')) throw pgErrors.permission(ctx, tableName);
  const env: WriteEnv = { tx, ctx, schema, now: new Date() };
  const insertCheck = checkSql(tableName, ctx, 'INSERT');
  const updateCheck = checkSql(tableName, ctx, 'UPDATE');
  // No permissive policy at all: Postgres refuses before any constraint runs.
  if (insertCheck === 'FALSE' && !options.resolution) throw pgErrors.rls(ctx, tableName);
  const keys: Row[] = [];
  for (const raw of input) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw pgErrors.parse('Empty or invalid json');
    const values: Row = options.columns
      ? Object.fromEntries(options.columns.map(c => [c, c in raw ? raw[c] : options.missingDefault ? undefined : null]).filter(([, v]) => v !== undefined))
      : { ...raw };
    validateColumns(t, values);
    if (options.resolution) {
      const conflict = options.onConflict ?? t.primaryKey;
      if (conflict.some(c => !t.columns.has(c))) throw pgErrors.column(tableName, conflict.find(c => !t.columns.has(c))!);
      const existing = conflict.every(c => values[c] !== undefined && values[c] !== null)
        ? await one(tx, `SELECT * FROM ${q(tableName)} WHERE ${conflict.map(c => `${q(c)} = ?`).join(' AND ')} FOR UPDATE`,
          conflict.map(c => toParam(t.columns.get(c)!, values[c])))
        : null;
      if (existing) {
        if (options.resolution === 'ignore') continue;
        if (!await rowPasses(tx, t, existing, usingSql(tableName, ctx, 'UPDATE'))) throw pgErrors.rlsUsing(ctx, tableName);
        const changes = Object.fromEntries(Object.entries(values).filter(([c]) => !conflict.includes(c)));
        const stored = await updateRow(env, tableName, keyOf(t, existing), changes, {
          check: async (_env, row) => { if (!await rowPasses(tx, t, row, updateCheck)) throw pgErrors.rls(ctx, tableName); }
        });
        keys.push(keyOf(t, stored!));
        continue;
      }
    }
    const stored = await insertRow(env, tableName, values, {
      check: async (_env, row) => { if (!await rowPasses(tx, t, row, insertCheck)) throw pgErrors.rls(ctx, tableName); }
    });
    keys.push(keyOf(t, stored));
  }
  return keys;
}

async function targets(tx: Tx, t: Table, ctx: Context, cmd: 'UPDATE' | 'DELETE', where: Where): Promise<Row[]> {
  const clause = [usingSql(t.name, ctx, cmd), usingSql(t.name, ctx, 'SELECT'), ...where.sql].map(s => `(${s})`).join(' AND ');
  return queryRows(tx, `SELECT * FROM ${q(t.name)} WHERE ${clause} ORDER BY ${t.primaryKey.map(q).join(', ')} FOR UPDATE`, where.params);
}

export async function updateRows(tx: Tx, schema: Schema, ctx: Context, tableName: string, changes: Row, where: Where): Promise<Row[]> {
  const t = tableOf(schema, tableName);
  if (!granted(tableName, ctx, 'UPDATE')) throw pgErrors.permission(ctx, tableName);
  if (typeof changes !== 'object' || changes === null || Array.isArray(changes)) throw pgErrors.parse('Empty or invalid json');
  validateColumns(t, changes);
  const env: WriteEnv = { tx, ctx, schema, now: new Date() };
  const check = checkSql(tableName, ctx, 'UPDATE');
  const keys: Row[] = [];
  for (const row of await targets(tx, t, ctx, 'UPDATE', where)) {
    const stored = await updateRow(env, tableName, keyOf(t, row), changes, {
      check: async (_env, updated) => { if (!await rowPasses(tx, t, updated, check)) throw pgErrors.rls(ctx, tableName); }
    });
    if (stored) keys.push(keyOf(t, stored));
  }
  return keys;
}

/** Deletes and returns the deleted rows' keys (read them before calling to return them). */
export async function deleteRows(tx: Tx, schema: Schema, ctx: Context, tableName: string, where: Where): Promise<Row[]> {
  const t = tableOf(schema, tableName);
  if (!granted(tableName, ctx, 'DELETE')) throw pgErrors.permission(ctx, tableName);
  const env: WriteEnv = { tx, ctx, schema, now: new Date() };
  const keys: Row[] = [];
  for (const row of await targets(tx, t, ctx, 'DELETE', where)) {
    await deleteRow(env, tableName, keyOf(t, row));
    keys.push(keyOf(t, row));
  }
  return keys;
}

export function keysWhere(t: Table, keys: Row[]): Where {
  if (!keys.length) return { sql: ['FALSE'], params: [] };
  const cols = t.primaryKey;
  return {
    sql: [cols.length === 1
      ? `${q(cols[0])} IN (${keys.map(() => '?').join(', ')})`
      : `(${cols.map(q).join(', ')}) IN (${keys.map(() => `(${cols.map(() => '?').join(', ')})`).join(', ')})`],
    params: keys.flatMap(k => cols.map(c => toParam(t.columns.get(c)!, k[c])))
  };
}
