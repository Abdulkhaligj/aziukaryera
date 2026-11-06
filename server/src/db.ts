// MySQL access. Values are converted to the JSON shapes PostgREST/GoTrue
// return, so clients see exactly what Supabase used to send them:
// booleans, numbers for DECIMAL, ISO-8601 UTC timestamps, parsed JSON.
import mysql from 'mysql2/promise';
import type { Pool, PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';

export type Row = Record<string, unknown>;
export type Tx = PoolConnection;

export function createPool(url: string): Pool {
  const pool = mysql.createPool({
    uri: url,
    charset: 'UTF8MB4_0900_AI_CI',
    timezone: 'Z',
    connectionLimit: 10,
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
  (pool as unknown as { pool: { on(event: 'connection', cb: (c: { query(sql: string): void }) => void): void } })
    .pool.on('connection', connection => connection.query('SET NAMES utf8mb4 COLLATE utf8mb4_0900_as_ci'));
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

export async function transaction<T>(pool: Pool, work: (tx: Tx) => Promise<T>): Promise<T> {
  const tx = await pool.getConnection();
  try {
    await tx.beginTransaction();
    const result = await work(tx);
    await tx.commit();
    return result;
  } catch (error) {
    await tx.rollback().catch(() => {});
    throw error;
  } finally {
    tx.release();
  }
}
