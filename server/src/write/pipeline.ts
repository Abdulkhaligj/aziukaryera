// Every row write goes through here, inside a transaction, so the rules the
// Postgres triggers enforced run in the same place for all callers (data
// API, signup, admin functions, scheduled jobs) — as triggers did.
//
// Trigger semantics kept from Postgres:
// - NEW holds every column: defaults are filled in before BEFORE triggers.
// - Triggers of one table and event fire in name order ("000_…" first).
// - UPDATE OF col fires when col is a target of the UPDATE (not when a
//   BEFORE trigger changed it); INSERT always fires.
// - Constraints the schema cannot express run after the write and before
//   the row-level WITH CHECK and the AFTER triggers.
// - SECURITY DEFINER trigger functions (most of them) run with the owner as
//   current_user: writes they make count as trusted (env.definer).
// - FK actions run through the pipeline: ON DELETE CASCADE / SET NULL delete
//   or update the child rows with their own triggers, as Postgres RI triggers do.
import { randomUUID } from 'node:crypto';
import type { Context } from '../context.ts';
import { exec, one, rows as selectRows, type Row, type Tx } from '../db.ts';
import { table, type Column, type Schema, type Table } from '../schema.ts';
import { canonical, distinct, timestampText, toParam } from '../values.ts';

export { toParam };

export interface WriteEnv {
  tx: Tx;
  ctx: Context;
  schema: Schema;
  /** transaction_timestamp(): one clock for the whole operation. */
  now: Date;
  /** Inside SECURITY DEFINER code: current_user is the owner, not anon/authenticated. */
  definer?: boolean;
}

export type Op = 'insert' | 'update' | 'delete';
export interface TriggerEvent {
  op: Op;
  /** UPDATE target columns (the SET list); empty for INSERT and DELETE. */
  columns: ReadonlySet<string>;
}

type Before = (env: WriteEnv, row: Row, old: Row | null, event: TriggerEvent) => Promise<void> | void;
type After = (env: WriteEnv, row: Row | null, old: Row | null, event: TriggerEvent) => Promise<void> | void;
type Constraint = (env: WriteEnv, row: Row, old: Row | null) => Promise<void> | void;
interface Trigger<F> { name: string; of: string[] | null; invoker: boolean; fn: F }
export type Security = 'definer' | 'invoker';
interface Hooks { before: Trigger<Before>[]; after: Trigger<After>[]; constraints: Trigger<Constraint>[] }

const registry = new Map<string, Record<Op, Hooks>>();
const columnDefaults = new Map<string, Map<string, (env: WriteEnv) => unknown>>();

function hooksFor(tableName: string): Record<Op, Hooks> {
  if (!registry.has(tableName)) {
    const empty = (): Hooks => ({ before: [], after: [], constraints: [] });
    registry.set(tableName, { insert: empty(), update: empty(), delete: empty() });
  }
  return registry.get(tableName)!;
}

function register<F>(list: Trigger<F>[], trigger: Trigger<F>) {
  list.push(trigger);
  // Postgres fires same-event triggers in name order (byte order of the name).
  list.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** A BEFORE ROW trigger. `of` limits UPDATE to those target columns; `security`
 *  is that of the trigger function (most are SECURITY DEFINER). */
export function before(tableName: string, name: string, ops: Op[], fn: Before, of: string[] | null = null, security: Security = 'definer') {
  for (const op of ops) register(hooksFor(tableName)[op].before, { name, of, invoker: security === 'invoker', fn });
}

/** An AFTER ROW trigger. `of` limits UPDATE to those target columns. */
export function after(tableName: string, name: string, ops: Op[], fn: After, of: string[] | null = null, security: Security = 'definer') {
  for (const op of ops) register(hooksFor(tableName)[op].after, { name, of, invoker: security === 'invoker', fn });
}

/** A table constraint MySQL cannot declare (EXCLUDE, CHECK on FK columns). */
export function constraint(tableName: string, name: string, ops: ('insert' | 'update')[], fn: Constraint) {
  for (const op of ops) register(hooksFor(tableName)[op].constraints, { name, of: null, invoker: true, fn });
}

/** A column DEFAULT MySQL cannot declare, such as auth.uid(). */
export function columnDefault(tableName: string, column: string, value: (env: WriteEnv) => unknown) {
  if (!columnDefaults.has(tableName)) columnDefaults.set(tableName, new Map());
  columnDefaults.get(tableName)!.set(column, value);
}

const fires = (trigger: Trigger<unknown>, event: TriggerEvent) =>
  event.op !== 'update' || !trigger.of || trigger.of.some(c => event.columns.has(c));
/** The environment a trigger function body runs in. */
const asRun = (env: WriteEnv, trigger: Trigger<unknown>): WriteEnv => (trigger.invoker || env.definer ? env : { ...env, definer: true });

const rowsOf = (env: WriteEnv, sql: string, params: unknown[]) => selectRows(env.tx, sql, params);

export const q = (id: string) => '`' + id.replace(/`/g, '``') + '`';

function keyOf(t: Table, row: Row) {
  return { where: t.primaryKey.map(c => `${q(c)} = ?`).join(' AND '), params: t.primaryKey.map(c => toParam(t.columns.get(c)!, row[c])) };
}

export async function selectByKey(env: WriteEnv, tableName: string, row: Row, lock = false): Promise<Row | null> {
  const t = table(env.schema, tableName);
  const { where, params } = keyOf(t, row);
  return one(env.tx, `SELECT * FROM ${q(tableName)} WHERE ${where}${lock ? ' FOR UPDATE' : ''}`, params);
}

function normalise(t: Table, row: Row) {
  for (const [name, value] of Object.entries(row)) {
    const column = t.columns.get(name);
    if (column) row[name] = canonical(column, value);
  }
}

function defaultValue(env: WriteEnv, column: Column): unknown {
  const spec = column.defaultSpec;
  if (!spec) return column.nullable && !column.autoIncrement && !column.hasDefault ? null : undefined;
  switch (spec.kind) {
    case 'value': return structuredClone(spec.value);
    case 'uuid': return randomUUID();
    case 'now': return canonical(column, new Date(env.now.getTime() + spec.offsetMs));
    case 'today': return env.now.toISOString().slice(0, 10);
  }
}

async function runBefore(env: WriteEnv, t: Table, hooks: Hooks, row: Row, old: Row | null, event: TriggerEvent) {
  for (const trigger of hooks.before) {
    if (!fires(trigger, event)) continue;
    await trigger.fn(asRun(env, trigger), row, old, event);
    normalise(t, row);
  }
}

async function runAfter(env: WriteEnv, hooks: Hooks, row: Row | null, old: Row | null, event: TriggerEvent) {
  for (const trigger of hooks.after) if (fires(trigger, event)) await trigger.fn(asRun(env, trigger), row, old, event);
}

/** Row-level WITH CHECK: runs on the stored row (defaults applied) before the
 *  AFTER hooks; throwing rolls the whole statement back. */
export interface WriteOptions { check?: (env: WriteEnv, stored: Row) => Promise<void> }

const NO_COLUMNS: ReadonlySet<string> = new Set();

export async function insertRow(env: WriteEnv, tableName: string, values: Row, options: WriteOptions = {}): Promise<Row> {
  const t = table(env.schema, tableName);
  const row: Row = { ...values };
  normalise(t, row);
  const custom = columnDefaults.get(tableName);
  for (const column of t.columns.values()) {
    if (row[column.name] !== undefined) continue;
    row[column.name] = custom?.has(column.name) ? custom.get(column.name)!(env) : defaultValue(env, column);
  }
  normalise(t, row);
  const hooks = hooksFor(tableName).insert;
  const event: TriggerEvent = { op: 'insert', columns: NO_COLUMNS };
  await runBefore(env, t, hooks, row, null, event);
  const cols = Object.keys(row).filter(c => row[c] !== undefined && t.columns.has(c));
  const result = await exec(env.tx, `INSERT INTO ${q(tableName)} (${cols.map(q).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    cols.map(c => toParam(t.columns.get(c)!, row[c])));
  if (t.primaryKey.length === 1 && row[t.primaryKey[0]] === undefined) row[t.primaryKey[0]] = result.insertId;
  const stored = (await selectByKey(env, tableName, row))!;
  for (const check of hooks.constraints) await check.fn(env, stored, null);
  if (options.check) await options.check(env, stored);
  await runAfter(env, hooks, stored, null, event);
  return stored;
}

export async function updateRow(env: WriteEnv, tableName: string, key: Row, changes: Row, options: WriteOptions = {}): Promise<Row | null> {
  const t = table(env.schema, tableName);
  const old = await selectByKey(env, tableName, key, true);
  if (!old) return null;
  const set: Row = { ...changes };
  normalise(t, set);
  const row: Row = { ...old, ...set };
  const hooks = hooksFor(tableName).update;
  const event: TriggerEvent = { op: 'update', columns: new Set(Object.keys(changes).filter(c => t.columns.has(c))) };
  await runBefore(env, t, hooks, row, old, event);
  const cols = [...t.columns.keys()].filter(c => distinct(row[c], old[c]));
  if (cols.length) {
    const { where, params } = keyOf(t, old);
    await exec(env.tx, `UPDATE ${q(tableName)} SET ${cols.map(c => `${q(c)} = ?`).join(', ')} WHERE ${where}`,
      [...cols.map(c => toParam(t.columns.get(c)!, row[c])), ...params]);
  }
  const stored = await selectByKey(env, tableName, row);
  if (!stored) return null;
  for (const check of hooks.constraints) await check.fn(env, stored, old);
  if (options.check) await options.check(env, stored);
  await runAfter(env, hooks, stored, old, event);
  return stored;
}

export async function deleteRow(env: WriteEnv, tableName: string, key: Row): Promise<Row | null> {
  const t = table(env.schema, tableName);
  const old = await selectByKey(env, tableName, key, true);
  if (!old) return null;
  const hooks = hooksFor(tableName).delete;
  const event: TriggerEvent = { op: 'delete', columns: NO_COLUMNS };
  // BEFORE DELETE sees OLD only; it is passed as both arguments.
  for (const trigger of hooks.before) await trigger.fn(asRun(env, trigger), old, old, event);
  await referentialActions(env, t, old);
  const { where, params } = keyOf(t, old);
  await exec(env.tx, `DELETE FROM ${q(tableName)} WHERE ${where}`, params);
  await runAfter(env, hooks, null, old, event);
  return old;
}

/** ON DELETE CASCADE / SET NULL for the rows referencing `parent`, through the
 *  pipeline so their triggers fire (MySQL's own cascade would skip them). The
 *  referential actions run with RI-trigger privileges, i.e. as owner. */
async function referentialActions(env: WriteEnv, parentTable: Table, parent: Row) {
  const ri: WriteEnv = env.definer ? env : { ...env, definer: true };
  for (const fk of parentTable.referencedBy) {
    if (fk.onDelete !== 'CASCADE' && fk.onDelete !== 'SET NULL') continue;
    const child = table(env.schema, fk.table);
    const children = await rowsOf(env, `SELECT ${child.primaryKey.map(q).join(', ')} FROM ${q(fk.table)}
       WHERE ${fk.columns.map(c => `${q(c)} = ?`).join(' AND ')} FOR UPDATE`,
      fk.refColumns.map((c, i) => toParam(child.columns.get(fk.columns[i])!, parent[c])));
    for (const key of children) {
      if (fk.onDelete === 'CASCADE') await deleteRow(ri, fk.table, key);
      else await updateRow(ri, fk.table, key, Object.fromEntries(fk.columns.map(c => [c, null])));
    }
  }
}

/** Delete every row matching a condition, one by one through the pipeline. */
export async function deleteWhere(env: WriteEnv, tableName: string, whereSql = 'TRUE', params: unknown[] = []): Promise<number> {
  const t = table(env.schema, tableName);
  const keys = await rowsOf(env, `SELECT ${t.primaryKey.map(q).join(', ')} FROM ${q(tableName)} WHERE ${whereSql} ORDER BY ${t.primaryKey.map(q).join(', ')}`, params);
  let deleted = 0;
  for (const key of keys) if (await deleteRow(env, tableName, key)) deleted++;
  return deleted;
}

/** now() as the canonical text stored in a DATETIME(6) column. */
export const nowText = (env: WriteEnv) => timestampText(env.now);

/** Every registered trigger, for the test that compares them with Postgres. */
export function registeredTriggers() {
  const list: { table: string; name: string; timing: 'BEFORE' | 'AFTER'; op: Op; of: string[] | null; security: Security }[] = [];
  for (const [tableName, ops] of registry) {
    for (const op of ['insert', 'update', 'delete'] as Op[]) {
      for (const t of ops[op].before) list.push({ table: tableName, name: t.name, timing: 'BEFORE', op, of: t.of, security: t.invoker ? 'invoker' : 'definer' });
      for (const t of ops[op].after) list.push({ table: tableName, name: t.name, timing: 'AFTER', op, of: t.of, security: t.invoker ? 'invoker' : 'definer' });
    }
  }
  return list;
}
