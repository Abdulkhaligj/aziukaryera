// Every row write goes through here, inside a transaction, so the rules the
// Postgres triggers enforced run in the same place for all callers (data
// API, signup, admin functions, scheduled jobs) — as triggers did.
import { randomUUID } from 'node:crypto';
import type { Context } from '../context.ts';
import { exec, one, toMysqlDatetime, type Row, type Tx } from '../db.ts';
import { table, type Column, type Schema } from '../schema.ts';

export interface WriteEnv {
  tx: Tx;
  ctx: Context;
  schema: Schema;
  /** transaction_timestamp(): one clock for the whole operation. */
  now: Date;
}

type Before = (env: WriteEnv, row: Row, old: Row | null) => Promise<void> | void;
type After = (env: WriteEnv, row: Row | null, old: Row | null) => Promise<void> | void;
interface Hooks { before: Before[]; after: After[] }
type Op = 'insert' | 'update' | 'delete';

const registry = new Map<string, Record<Op, Hooks>>();
function hooksFor(tableName: string): Record<Op, Hooks> {
  if (!registry.has(tableName)) registry.set(tableName, {
    insert: { before: [], after: [] }, update: { before: [], after: [] }, delete: { before: [], after: [] }
  });
  return registry.get(tableName)!;
}

/** Register a Postgres-trigger equivalent. Hooks run in registration order. */
export function on(tableName: string, ops: Op[], when: 'before', hook: Before): void;
export function on(tableName: string, ops: Op[], when: 'after', hook: After): void;
export function on(tableName: string, ops: Op[], when: 'before' | 'after', hook: Before | After): void {
  for (const op of ops) (hooksFor(tableName)[op][when] as (Before | After)[]).push(hook);
}

export const q = (id: string) => '`' + id.replace(/`/g, '``') + '`';

/** JSON value → MySQL parameter for a column. */
export function toParam(column: Column, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  switch (column.dataType) {
    case 'json': return JSON.stringify(value);
    case 'datetime': case 'timestamp': return toMysqlDatetime(value as string | Date);
    case 'tinyint': return column.columnType === 'tinyint(1)' ? (value === true || value === 1 || value === 'true' ? 1 : 0) : value;
    default: return typeof value === 'object' ? JSON.stringify(value) : value;
  }
}

function keyOf(env: WriteEnv, tableName: string, row: Row) {
  const t = table(env.schema, tableName);
  return { where: t.primaryKey.map(c => `${q(c)} = ?`).join(' AND '), params: t.primaryKey.map(c => toParam(t.columns.get(c)!, row[c])) };
}

export async function selectByKey(env: WriteEnv, tableName: string, row: Row, lock = false): Promise<Row | null> {
  const { where, params } = keyOf(env, tableName, row);
  return one(env.tx, `SELECT * FROM ${q(tableName)} WHERE ${where}${lock ? ' FOR UPDATE' : ''}`, params);
}

export async function insertRow(env: WriteEnv, tableName: string, values: Row): Promise<Row> {
  const t = table(env.schema, tableName);
  const row: Row = { ...values };
  // UUID primary keys are generated here so the new row can be read back.
  for (const c of t.primaryKey) {
    const column = t.columns.get(c)!;
    if (row[c] === undefined && column.dataType === 'char' && column.columnType === 'char(36)') row[c] = randomUUID();
  }
  const hooks = hooksFor(tableName).insert;
  for (const hook of hooks.before) await hook(env, row, null);
  const cols = Object.keys(row).filter(c => row[c] !== undefined && t.columns.has(c));
  const result = await exec(env.tx, `INSERT INTO ${q(tableName)} (${cols.map(q).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    cols.map(c => toParam(t.columns.get(c)!, row[c])));
  if (t.primaryKey.length === 1 && row[t.primaryKey[0]] === undefined) row[t.primaryKey[0]] = result.insertId;
  const stored = await selectByKey(env, tableName, row);
  for (const hook of hooks.after) await hook(env, stored, null);
  return stored!;
}

export async function updateRow(env: WriteEnv, tableName: string, key: Row, changes: Row): Promise<Row | null> {
  const t = table(env.schema, tableName);
  const old = await selectByKey(env, tableName, key, true);
  if (!old) return null;
  const row: Row = { ...old, ...changes };
  const hooks = hooksFor(tableName).update;
  for (const hook of hooks.before) await hook(env, row, old);
  const cols = [...t.columns.keys()].filter(c => JSON.stringify(row[c]) !== JSON.stringify(old[c]));
  if (cols.length) {
    const { where, params } = keyOf(env, tableName, old);
    await exec(env.tx, `UPDATE ${q(tableName)} SET ${cols.map(c => `${q(c)} = ?`).join(', ')} WHERE ${where}`,
      [...cols.map(c => toParam(t.columns.get(c)!, row[c])), ...params]);
  }
  const stored = await selectByKey(env, tableName, row);
  for (const hook of hooks.after) await hook(env, stored, old);
  return stored;
}

export async function deleteRow(env: WriteEnv, tableName: string, key: Row): Promise<Row | null> {
  const old = await selectByKey(env, tableName, key, true);
  if (!old) return null;
  const hooks = hooksFor(tableName).delete;
  for (const hook of hooks.before) await hook(env, old, old);
  const { where, params } = keyOf(env, tableName, old);
  await exec(env.tx, `DELETE FROM ${q(tableName)} WHERE ${where}`, params);
  for (const hook of hooks.after) await hook(env, null, old);
  return old;
}
