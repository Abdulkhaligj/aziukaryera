// /rest/v1/rpc functions: the database functions the site, the admin panel and
// the Edge Functions call. Each declares its parameters (Postgres types), the
// roles granted EXECUTE (service_role may run every function, as before the move),
// its security (DEFINER code writes as owner: env.definer) and its result shape.
import { DbRuleError } from '../errors.ts';
import type { WriteEnv } from '../write/pipeline.ts';

export type ArgType = 'uuid' | 'text' | 'int' | 'bool' | 'uuid[]' | 'text[]';
/** value: scalar or jsonb · void: 204 · row: one composite · rows: SETOF / TABLE */
export type Returns = 'value' | 'void' | 'row' | 'rows';
export type Args = Record<string, any>;

export interface RpcFunction {
  name: string;
  args: Record<string, ArgType>;
  roles: ('anon' | 'authenticated')[];
  security: 'definer' | 'invoker';
  /** STABLE / IMMUTABLE functions may also be called with GET. */
  readOnly?: boolean;
  returns: Returns;
  /** Calls per client (IP and account) in a window; over it the call is
   *  refused, or skipped without an error when silent (audit 2026-11-13, H-11). */
  limits?: { name: string; count: number; windowMs: number; key?: (args: Args) => string; silent?: boolean }[];
  run(env: WriteEnv, args: Args): Promise<unknown>;
}

const functions = new Map<string, RpcFunction>();
export function rpc(def: RpcFunction) { functions.set(def.name, def); }
export const findRpc = (name: string) => functions.get(name);

const UUID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
const invalid = (type: string, value: unknown) =>
  new DbRuleError(`invalid input syntax for type ${type}: "${typeof value === 'string' ? value : JSON.stringify(value)}"`, '22P02');

function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value.trim())) throw invalid('uuid', value);
  const hex = value.trim().replace(/-/g, '').toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** A JSON array, or a Postgres array literal such as {a,b}. */
function list(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && /^\{.*\}$/s.test(value.trim())) {
    const inner = value.trim().slice(1, -1);
    return inner === '' ? [] : inner.split(',').map(s => s.trim().replace(/^"(.*)"$/s, '$1')).map(s => (s === 'NULL' ? null : s));
  }
  throw new DbRuleError(`malformed array literal: "${String(value)}"`, '22P02');
}

function coerce(type: ArgType, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  switch (type) {
    case 'uuid': return uuid(value);
    case 'text': return typeof value === 'object' ? JSON.stringify(value) : String(value);
    case 'int': {
      const n = typeof value === 'number' ? value : typeof value === 'string' && /^\s*[+-]?\d+\s*$/.test(value) ? Number(value) : NaN;
      if (!Number.isInteger(n)) throw invalid('integer', value);
      return n;
    }
    case 'bool': {
      const key = typeof value === 'string' ? value.trim().toLowerCase() : value;
      if ([true, 't', 'true', 'y', 'yes', 'on', '1'].includes(key as never)) return true;
      if ([false, 'f', 'false', 'n', 'no', 'off', '0'].includes(key as never)) return false;
      throw invalid('boolean', value);
    }
    case 'uuid[]': return list(value).map(v => (v == null ? null : uuid(v)));
    case 'text[]': return list(value).map(v => (v == null ? null : typeof v === 'object' ? JSON.stringify(v) : String(v)));
  }
}

/** Named arguments → typed values; omitted parameters are NULL (their default). */
export function coerceArgs(def: RpcFunction, body: Record<string, unknown>): Args {
  return Object.fromEntries(Object.entries(def.args).map(([name, type]) => [name, coerce(type, body[name])]));
}
