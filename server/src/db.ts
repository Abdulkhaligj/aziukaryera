// MySQL access. Values are converted to the JSON shapes PostgREST/GoTrue
// return, so clients see exactly what the old backend used to send them:
// booleans, numbers for DECIMAL, ISO-8601 UTC timestamps, parsed JSON.
import mysql from 'mysql2/promise';
import type { Pool, PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';

export type Row = Record<string, unknown>;
export type Tx = PoolConnection;

/** A whole number from the environment, within limits; anything else stops the start (M6, L33). */
export function intEnv(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!/^\s*\d+\s*$/.test(raw) || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be a whole number from ${min} to ${max} (got "${raw}")`);
  }
  return value;
}

/** Session settings of every connection: the same time zone, isolation and
 *  SQL mode as the code assumes, wherever the server's defaults differ. */
const SQL_MODE = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';
export const SESSION_VARIABLES = '@auth_uid, @auth_role, @is_admin, @admin_role, @actor_is_staff, @jwt_admin_role';

export function createPool(url: string, env: NodeJS.ProcessEnv = process.env): Pool {
  const lockWait = intEnv(env, 'MYSQL_LOCK_WAIT_SECONDS', 10, 1, 300);
  const maxExecution = intEnv(env, 'MYSQL_MAX_EXECUTION_MS', 15000, 100, 600000);
  const pool = mysql.createPool({
    uri: url,
    charset: 'UTF8MB4_0900_AI_CI',
    timezone: 'Z',
    // A full pool queues at most queueLimit requests; the rest fail fast (#49).
    connectionLimit: intEnv(env, 'MYSQL_POOL_SIZE', 20, 1, 500),
    queueLimit: intEnv(env, 'MYSQL_QUEUE_LIMIT', 200, 0, 100000),
    connectTimeout: 10_000,
    decimalNumbers: true,
    dateStrings: true,
    typeCast(field, next) {
      if (field.type === 'TINY' && field.length === 1) {
        const value = field.string();
        return value === null ? null : value === '1';
      }
      if (field.type === 'DATETIME') {
        const value = field.string();
        return value === null ? null : value.replace(' ', 'T') + '+00:00';
      }
      return next();
    }
  });
  // Same collation as the columns, so literals and session variables compare
  // without "Illegal mix of collations". (The handshake can only carry ids ≤ 255.)
  // Every statement runs before any other on the connection; a failure is logged (L33).
  // READ COMMITTED as in Postgres: a count after a lock sees what others committed (H3).
  // UTC session time zone, so CURRENT_TIMESTAMP defaults are UTC like the code (M22).
  // A fixed SQL mode: strict, and backslash escaping as the driver expects (L22).
  type Raw = { query(sql: string, cb: (error: Error | null) => void): void };
  (pool as unknown as { pool: { on(event: 'connection', cb: (c: Raw) => void): void } })
    .pool.on('connection', connection => {
      const report = (error: Error | null) => { if (error) console.error('MySQL session setup failed:', error.message); };
      connection.query('SET NAMES utf8mb4 COLLATE utf8mb4_0900_as_ci', report);
      connection.query(`SET SESSION transaction_isolation = 'READ-COMMITTED', time_zone = '+00:00', sql_mode = '${SQL_MODE}',
        innodb_lock_wait_timeout = ${lockWait}, max_execution_time = ${maxExecution}`, report);
    });
  return pool;
}

/** ISO-8601 (any offset) or Date → MySQL DATETIME(6) in UTC. */
export function toMysqlDatetime(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().replace('T', ' ').replace('Z', '');
  const m = value.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}(?::?\d{2})?)?$/);
  if (!m) throw new Error(`invalid timestamp: ${value}`);
  const fraction = (m[3] || '.0').slice(1).padEnd(6, '0').slice(0, 6);
  const offset = m[4] && m[4] !== 'Z' && !/^[+-]00(:?00)?$/.test(m[4]) ? m[4] : null;
  if (!offset) return `${m[1]} ${m[2]}.${fraction}`;
  const utc = new Date(`${m[1]}T${m[2]}${offset.length === 3 ? offset + ':00' : offset}`).toISOString();
  return `${utc.slice(0, 10)} ${utc.slice(11, 19)}.${fraction}`;
}

export async function rows<T extends Row = Row>(db: Pool | Tx, sql: string, params: unknown[] = []): Promise<T[]> {
  const [result] = await db.query<RowDataPacket[]>(sql, params);
  return result as T[];
}

export async function one<T extends Row = Row>(db: Pool | Tx, sql: string, params: unknown[] = []): Promise<T | null> {
  return (await rows<T>(db, sql, params))[0] ?? null;
}

export async function exec(db: Pool | Tx, sql: string, params: unknown[] = []): Promise<ResultSetHeader> {
  const [result] = await db.query<ResultSetHeader>(sql, params);
  return result;
}

/** INSERT … ON CONFLICT DO NOTHING: true when the row was inserted. (The pool
 *  uses FOUND_ROWS, so ON DUPLICATE KEY affectedRows cannot tell the cases apart.) */
export async function insertOnce(db: Pool | Tx, sql: string, params: unknown[]): Promise<boolean> {
  try {
    await db.query(sql, params);
    return true;
  } catch (error) {
    if ((error as { errno?: number }).errno === 1062) return false;
    throw error;
  }
}

type Task = () => Promise<unknown>;
const afterCommit = new WeakMap<Tx, Task[]>();

/** Settings a connection must have; checked at start-up (M22, H3). */
export async function checkSession(pool: Pool): Promise<void> {
  const [row] = await rows<{ tz: string; iso: string; mode: string }>(pool,
    'SELECT @@session.time_zone AS tz, @@session.transaction_isolation AS iso, @@session.sql_mode AS mode');
  if (row.tz !== '+00:00' || row.iso !== 'READ-COMMITTED' || !/STRICT_TRANS_TABLES/.test(row.mode)) {
    throw new Error(`MySQL session settings were not applied (time_zone=${row.tz}, isolation=${row.iso})`);
  }
}

/** After-commit work still running, so a shutdown can wait for it (M24). */
const pending = new Set<Promise<unknown>>();
export async function drainAfterCommit(timeoutMs: number): Promise<number> {
  const left = [...pending];
  await Promise.race([Promise.allSettled(left), new Promise(resolve => setTimeout(resolve, timeoutMs).unref())]);
  return pending.size;
}

/** Work that may only happen once the transaction is committed, such as
 *  the moderation webhook (pg_net sent its queued requests the same way). */
export function onCommit(tx: Tx, task: Task): void {
  if (!afterCommit.has(tx)) afterCommit.set(tx, []);
  afterCommit.get(tx)!.push(task);
}

/** A savepoint; rolling back to it also drops the after-commit work added since (L6). */
export interface Savepoint { name: string; tasks: number }
export async function savepoint(tx: Tx, name: string): Promise<Savepoint> {
  if (!/^\w+$/.test(name)) throw new Error('bad savepoint name');
  await tx.query(`SAVEPOINT ${name}`);
  return { name, tasks: afterCommit.get(tx)?.length ?? 0 };
}
export async function rollbackTo(tx: Tx, mark: Savepoint): Promise<void> {
  await tx.query(`ROLLBACK TO SAVEPOINT ${mark.name}`);
  afterCommit.get(tx)?.splice(mark.tasks);
}

/** A deadlock rolls the whole transaction back; it is tried again twice (#49). */
export async function transaction<T>(pool: Pool, work: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await transactionOnce(pool, work);
    } catch (error) {
      if ((error as { errno?: number }).errno !== 1213 || attempt >= 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 20 + Math.random() * 80 * (attempt + 1)));
    }
  }
}

async function transactionOnce<T>(pool: Pool, work: (tx: Tx) => Promise<T>): Promise<T> {
  const tx = await pool.getConnection();
  afterCommit.delete(tx);
  let broken = false;
  try {
    await tx.beginTransaction();
    const result = await work(tx);
    await tx.commit();
    const tasks = afterCommit.get(tx) ?? [];
    afterCommit.delete(tx);
    for (const [index, task] of tasks.entries()) {
      const running: Promise<unknown> = task()
        .catch(error => console.error(`after-commit task ${index + 1}/${tasks.length} failed:`, error instanceof Error ? error.stack ?? error.message : error))
        .finally(() => pending.delete(running));
      pending.add(running);
    }
    return result;
  } catch (error) {
    afterCommit.delete(tx);
    // A connection that cannot roll back is not given to the next request (L27).
    await tx.rollback().catch(() => { broken = true; });
    throw error;
  } finally {
    // The caller's identity does not stay on a pooled connection (L23).
    if (!broken) await tx.query(`SET ${SESSION_VARIABLES.split(', ').map(v => `${v} = NULL`).join(', ')}`).catch(() => { broken = true; });
    if (broken) tx.destroy(); else tx.release();
  }
}
