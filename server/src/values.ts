// One representation per column type for values inside the write pipeline:
// the same shape the database read returns (db.ts typeCast). Request values
// ("true", "2026-11-06T10:00:00Z", "5") are normalised to it, so the trigger
// ports compare old and new rows the way Postgres compares typed values.
import { toMysqlDatetime } from './db.ts';
import { DbRuleError } from './errors.ts';
import type { Column } from './schema.ts';

const NUMERIC = new Set(['int', 'bigint', 'smallint', 'mediumint', 'tinyint', 'decimal', 'double', 'float']);
const TRUE = new Set([true, 1, '1', 't', 'true', 'y', 'yes', 'on']);
const FALSE = new Set([false, 0, '0', 'f', 'false', 'n', 'no', 'off']);

const isBoolean = (column: Column) => column.dataType === 'tinyint' && column.columnType === 'tinyint(1)';
const fraction = (column: Column) => Number(column.columnType.match(/\((\d)\)/)?.[1] ?? 0);

/** DATETIME text as db.ts returns it: 2026-11-06T10:00:00.000000+00:00 (UTC). */
export function timestampText(value: string | Date, digits = 6): string {
  const text = toMysqlDatetime(value);
  return `${text.slice(0, 10)}T${text.slice(11, 19)}${digits ? '.' + text.slice(20, 20 + digits) : ''}+00:00`;
}

export function canonical(column: Column, value: unknown): unknown {
  if (value === null || value === undefined) return value;
  switch (column.dataType) {
    case 'datetime': case 'timestamp':
      if (typeof value !== 'string' && !(value instanceof Date)) return value;
      try { return timestampText(value, fraction(column)); } catch { return value; }
    case 'date':
      if (value instanceof Date) return value.toISOString().slice(0, 10);
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : value;
    case 'json':
      return value;
  }
  if (isBoolean(column)) {
    const key = typeof value === 'string' ? value.trim().toLowerCase() : value;
    return TRUE.has(key as never) ? true : FALSE.has(key as never) ? false : value;
  }
  if (NUMERIC.has(column.dataType)) {
    return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : value;
  }
  return typeof value === 'number' || typeof value === 'boolean' ? String(value) : value;
}

/** JSON value → MySQL parameter for a column. */
export function toParam(column: Column, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  switch (column.dataType) {
    case 'json': return JSON.stringify(value);
    case 'datetime': case 'timestamp':
      try { return toMysqlDatetime(value as string | Date); } catch {
        throw new DbRuleError(`invalid input syntax for type timestamp with time zone: "${String(value)}"`, '22007');
      }
  }
  if (isBoolean(column)) { const v = canonical(column, value); return v === true ? 1 : v === false ? 0 : value; }
  return typeof value === 'object' ? JSON.stringify(value) : value;
}

/** Postgres "IS DISTINCT FROM" on two canonical values. */
export const distinct = (a: unknown, b: unknown) => JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);
