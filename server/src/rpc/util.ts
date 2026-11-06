// Helpers shared by the RPC ports.
import { DbRuleError } from '../errors.ts';
import type { WriteEnv } from '../write/pipeline.ts';

const BAKU = 4 * 3_600_000; // Asia/Baku: UTC+4, no DST since 2016

/** (now() at time zone 'Asia/Baku')::date */
export const bakuDate = (at: Date) => new Date(at.getTime() + BAKU).toISOString().slice(0, 10);

/** date_trunc(unit, at at time zone 'Asia/Baku') at time zone 'Asia/Baku' */
export function bakuStart(at: Date, unit: 'day' | 'month'): Date {
  const local = new Date(at.getTime() + BAKU);
  const start = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), unit === 'day' ? local.getUTCDate() : 1);
  return new Date(start - BAKU);
}

/** current_date (the session time zone is UTC). */
export const utcDate = (at: Date) => at.toISOString().slice(0, 10);

/** Signed in, or the given error (auth.uid() is null). */
export function requireUid(env: WriteEnv, message: string, sqlState = '42501'): string {
  if (!env.ctx.uid) throw new DbRuleError(message, sqlState);
  return env.ctx.uid;
}

/** jsonb equality: objects compare without regard to key order. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === (b as unknown[]).length && a.every((v, i) => jsonEqual(v, (b as unknown[])[i]));
  const ka = Object.keys(a as object), kb = Object.keys(b as object);
  return ka.length === kb.length && ka.every(k => Object.hasOwn(b as object, k) && jsonEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** `IN (?, ?, …)` for a non-empty list. */
export const inList = (values: unknown[]) => values.map(() => '?').join(', ');
