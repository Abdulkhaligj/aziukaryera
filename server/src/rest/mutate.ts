// Inserts, upserts, updates and deletes with Postgres RLS semantics: grants,
// WITH CHECK on the resulting row, USING (and SELECT USING, as for any
// UPDATE/DELETE with a WHERE clause) on the rows being changed.
import type { Context } from '../context.ts';
import { one, rows as queryRows, type Row, type Tx } from '../db.ts';
import { table as tableOf, type Schema, type Table } from '../schema.ts';
import { deleteRow, insertPrepared, prepareInsert, q, toParam, updateRow, type WriteEnv, type WriteOptions } from '../write/pipeline.ts';
import { PgError, pgErrors } from './errors.ts';
import { checkSql, granted, usingSql } from './policy.ts';
import type { Where } from './select.ts';

const keyOf = (t: Table, row: Row) => Object.fromEntries(t.primaryKey.map(c => [c, row[c]]));

async function rowPasses(tx: Tx, t: Table, stored: Row, expr: string): Promise<boolean> {
  if (expr === 'TRUE') return true;
  const result = await one<{ ok: number | null }>(tx, `SELECT (${expr}) AS ok FROM ${q(t.name)} WHERE ${t.primaryKey.map(c => `${q(c)} = ?`).join(' AND ')}`,
    t.primaryKey.map(c => toParam(t.columns.get(c)!, stored[c])));
  return !!result && Number(result.ok) === 1;
}

/** WITH CHECK on a row that is not (or not yet) stored: the policy reads it
 *  from a one-row derived table named like the table. */
async function proposedPasses(tx: Tx, t: Table, row: Row, expr: string): Promise<boolean> {
  if (expr === 'TRUE') return true;
  if (expr === 'FALSE') return false;
  const columns = [...t.columns.values()];
  const select = columns.map(c => `${c.dataType === 'json' ? 'CAST(? AS JSON)' : '?'} AS ${q(c.name)}`).join(', ');
  const result = await one<{ ok: number | null }>(tx, `SELECT (${expr}) AS ok FROM (SELECT ${select}) AS ${q(t.name)}`,
    columns.map(c => toParam(c, row[c.name])));
  return !!result && Number(result.ok) === 1;
}

/** The WITH CHECK callbacks for one statement (stored row, and the proposed row
 *  when the write fails on a constraint first). */
function withCheck(tx: Tx, t: Table, ctx: Context, expr: string, queue: (() => Promise<void>)[]): WriteOptions {
  return {
    afterQueue: queue,
    check: async (_env, stored) => { if (!await rowPasses(tx, t, stored, expr)) throw pgErrors.rls(ctx, t.name); },
    checkProposed: async (_env, row) => {
      // A failure to evaluate keeps the original constraint error.
      const passes = await proposedPasses(tx, t, row, expr).catch(() => true);
      if (!passes) throw pgErrors.rls(ctx, t.name);
    }
  };
}

/** AFTER ROW triggers of a statement fire once every row is written. */
async function endStatement(queue: (() => Promise<void>)[]) {
  for (const fire of queue) await fire();
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
  // No permissive policy at all: refused before any row is looked at, also for
  // an upsert, so ON CONFLICT cannot probe rows the caller may not see (H-08).
  if (insertCheck === 'FALSE') throw pgErrors.rls(ctx, tableName);
  const queue: (() => Promise<void>)[] = [];
  const keys: Row[] = [];
  for (const raw of input) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw pgErrors.parse('Empty or invalid json');
    const values: Row = options.columns
      ? Object.fromEntries(options.columns.map(c => [c, c in raw ? raw[c] : options.missingDefault ? undefined : null]).filter(([, v]) => v !== undefined))
      : { ...raw };
    validateColumns(t, values);
    // NEW after defaults and BEFORE INSERT triggers; ON CONFLICT compares this row.
    const prepared = await prepareInsert(env, tableName, values);
    if (options.resolution) {
      const conflict = options.onConflict ?? t.primaryKey;
      if (conflict.some(c => !t.columns.has(c))) throw pgErrors.column(tableName, conflict.find(c => !t.columns.has(c))!);
      // As in Postgres, the conflict target must be a unique key: an arbitrary
      // column (an email, say) cannot be used to look rows up (H-08).
      if (!t.uniqueKeys.some(k => k.length === conflict.length && k.every(c => conflict.includes(c)))) {
        throw new PgError(400, '42P10', 'there is no unique or exclusion constraint matching the ON CONFLICT specification');
      }
      const proposed = prepared.row;
      const existing = conflict.every(c => proposed[c] !== undefined && proposed[c] !== null)
        ? await one(tx, `SELECT * FROM ${q(tableName)} WHERE ${conflict.map(c => `${q(c)} = ?`).join(' AND ')} FOR UPDATE`,
          conflict.map(c => toParam(t.columns.get(c)!, proposed[c])))
        : null;
      if (existing) {
        // A conflicting row the caller may not see answers like a refused
        // insert, not like "exists" (H-08).
        if (!await rowPasses(tx, t, existing, usingSql(tableName, ctx, 'SELECT'))) throw pgErrors.rls(ctx, tableName);
        if (options.resolution === 'ignore') continue;
        if (!await rowPasses(tx, t, existing, usingSql(tableName, ctx, 'UPDATE'))) throw pgErrors.rlsUsing(ctx, tableName);
        // PostgREST sets every payload column to EXCLUDED.col (the row after BEFORE INSERT triggers).
        const changes = Object.fromEntries(Object.keys(values).map(c => [c, proposed[c]]));
        const stored = await updateRow(env, tableName, keyOf(t, existing), changes, withCheck(tx, t, ctx, updateCheck, queue));
        keys.push(keyOf(t, stored!));
        continue;
      }
    }
    const stored = await insertPrepared(env, prepared, withCheck(tx, t, ctx, insertCheck, queue));
    keys.push(keyOf(t, stored));
  }
  await endStatement(queue);
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
  const queue: (() => Promise<void>)[] = [];
  const options = withCheck(tx, t, ctx, checkSql(tableName, ctx, 'UPDATE'), queue);
  const keys: Row[] = [];
  for (const row of await targets(tx, t, ctx, 'UPDATE', where)) {
    const stored = await updateRow(env, tableName, keyOf(t, row), changes, options);
    if (stored) keys.push(keyOf(t, stored));
  }
  await endStatement(queue);
  return keys;
}

/** Deletes and returns the deleted rows' keys (read them before calling to return them). */
export async function deleteRows(tx: Tx, schema: Schema, ctx: Context, tableName: string, where: Where): Promise<Row[]> {
  const t = tableOf(schema, tableName);
  if (!granted(tableName, ctx, 'DELETE')) throw pgErrors.permission(ctx, tableName);
  const env: WriteEnv = { tx, ctx, schema, now: new Date() };
  const queue: (() => Promise<void>)[] = [];
  const keys: Row[] = [];
  for (const row of await targets(tx, t, ctx, 'DELETE', where)) {
    await deleteRow(env, tableName, keyOf(t, row), { afterQueue: queue });
    keys.push(keyOf(t, row));
  }
  await endStatement(queue);
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
