// PostgREST error bodies ({ code, details, hint, message }) and the mapping
// from MySQL errors to the Postgres SQLSTATEs the clients expect.
import type { Context } from '../context.ts';
import { DbRuleError } from '../errors.ts';

export class PgError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: string | null;
  readonly hint: string | null;
  constructor(status: number, code: string, message: string, details: string | null = null, hint: string | null = null) {
    super(message);
    this.status = status; this.code = code; this.details = details; this.hint = hint;
  }
  body() { return { code: this.code, details: this.details, hint: this.hint, message: this.message }; }
}

/** 42501 is 401 for anonymous callers and 403 for signed-in ones, as in PostgREST. */
const deniedStatus = (ctx: Context) => (ctx.role === 'anon' ? 401 : 403);

export const pgErrors = {
  tableNotFound: (table: string) => new PgError(404, 'PGRST205', `Could not find the table 'public.${table}' in the schema cache`),
  permission: (ctx: Context, table: string) => new PgError(deniedStatus(ctx), '42501', `permission denied for table ${table}`),
  rls: (ctx: Context, table: string) => new PgError(deniedStatus(ctx), '42501', `new row violates row-level security policy for table "${table}"`),
  rlsUsing: (ctx: Context, table: string) => new PgError(deniedStatus(ctx), '42501', `new row violates row-level security policy (USING expression) for table "${table}"`),
  column: (table: string, column: string) => new PgError(400, '42703', `column ${table}.${column} does not exist`),
  writeColumn: (table: string, column: string) => new PgError(400, 'PGRST204', `Could not find the '${column}' column of '${table}' in the schema cache`),
  parse: (message: string, details: string | null = null) => new PgError(400, 'PGRST100', message, details),
  relationship: (from: string, to: string) => new PgError(400, 'PGRST200',
    `Could not find a relationship between '${from}' and '${to}' in the schema cache`),
  ambiguous: (from: string, to: string) => new PgError(300, 'PGRST201',
    `Could not embed because more than one relationship was found for '${from}' and '${to}'`),
  singular: (count: number) => new PgError(406, 'PGRST116', 'JSON object requested, multiple (or no) rows returned',
    `The result contains ${count} rows`),
  missingKey: () => new PgError(401, '', 'No API key found in request', null, 'No `apikey` request header or url param was found.'),
  badJwt: () => new PgError(401, 'PGRST301', 'JWT is invalid or expired'),
  functionNotFound: (name: string, args: string[] = []) => new PgError(404, 'PGRST202', args.length
    ? `Could not find the function public.${name}(${[...args].sort().join(', ')}) in the schema cache`
    : `Could not find the function public.${name} without parameters in the schema cache`),
  functionPermission: (ctx: Context, name: string) => new PgError(deniedStatus(ctx), '42501', `permission denied for function ${name}`)
};

interface MysqlError { errno?: number; code?: string; sqlMessage?: string; sqlState?: string }

/** PostgREST's HTTP status for a SQLSTATE raised by the database. */
function statusFor(sqlState: string, ctx: Context | null): number {
  if (sqlState === '42501') return ctx ? deniedStatus(ctx) : 403;
  if (sqlState === '23503' || sqlState === '23505') return 409;
  if (sqlState.startsWith('28')) return 403;
  if (sqlState === '42883' || sqlState === '42P01') return 404;
  // P0001 is a plain RAISE (400); other PL/pgSQL codes such as no_data_found are 500.
  if (sqlState.startsWith('P0') && sqlState !== 'P0001') return 500;
  return 400;
}

/** Translate a MySQL / rule error into the Postgres error a client expects. */
export function fromDatabase(error: unknown, table: string, ctx: Context | null = null): PgError | null {
  if (error instanceof PgError) return error;
  if (error instanceof DbRuleError) return new PgError(statusFor(error.sqlState, ctx), error.sqlState, error.message);
  const e = error as MysqlError;
  if (!e || typeof e.errno !== 'number') return null;
  const msg = e.sqlMessage || '';
  switch (e.errno) {
    case 1062: { // ER_DUP_ENTRY
      const key = msg.match(/for key '(?:[^.']+\.)?([^']+)'/)?.[1] ?? 'unknown';
      return new PgError(409, '23505', `duplicate key value violates unique constraint "${key === 'PRIMARY' ? `${table}_pkey` : key}"`, msg);
    }
    case 1451: case 1452: { // ER_ROW_IS_REFERENCED_2 / ER_NO_REFERENCED_ROW_2
      const fk = msg.match(/CONSTRAINT `([^`]+)`/)?.[1] ?? 'unknown';
      return new PgError(409, '23503', e.errno === 1452
        ? `insert or update on table "${table}" violates foreign key constraint "${fk}"`
        : `update or delete on table "${table}" violates foreign key constraint "${fk}"`, msg);
    }
    case 3819: { // ER_CHECK_CONSTRAINT_VIOLATED
      const check = msg.match(/Check constraint '([^']+)'/)?.[1] ?? 'unknown';
      return new PgError(400, '23514', `new row for relation "${table}" violates check constraint "${check}"`, msg);
    }
    case 1048: case 1364: { // ER_BAD_NULL_ERROR / ER_NO_DEFAULT_FOR_FIELD
      const column = msg.match(/(?:Column|Field) '([^']+)'/)?.[1] ?? 'unknown';
      return new PgError(400, '23502', `null value in column "${column}" of relation "${table}" violates not-null constraint`, msg);
    }
    case 1265: case 1366: case 1292: case 1406: case 3140: // truncated / incorrect value / data too long / invalid JSON
      return new PgError(400, '22P02', `invalid input value: ${msg}`);
    case 1054: return new PgError(400, '42703', msg);
    case 1644: return new PgError(400, e.sqlState || 'P0001', msg); // SIGNAL from a procedure
    default: return null;
  }
}
