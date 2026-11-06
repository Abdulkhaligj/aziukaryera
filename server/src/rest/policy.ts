// Table grants and row-level policies, from policies.generated.json.
// Semantics follow Postgres: a row is allowed when any permissive policy
// allows it AND every restrictive policy does; no permissive policy → none.
import { readFileSync } from 'node:fs';
import type { Context } from '../context.ts';

export type Cmd = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
interface Policy { name: string; cmd: Cmd | 'ALL'; permissive: boolean; roles: string[]; using: string | null; check: string | null }
interface TableRules { rls: boolean; grants: { anon: string[]; authenticated: string[] }; policies: Policy[] }

const { tables } = JSON.parse(readFileSync(new URL('./policies.generated.json', import.meta.url), 'utf8')) as { tables: Record<string, TableRules> };

/** security_invoker views: rows are governed by their base table's policies. */
export const VIEW_BASE: Record<string, { base: string; key: string }> = {
  company_subscriptions: { base: 'subscriptions', key: 'id' }
};

const bypass = (ctx: Context) => ctx.role === 'service_role' || ctx.role === 'system';

/** Tables of the public schema that the data API serves. */
export const exposed = (table: string) => Object.hasOwn(tables, table);

export function granted(table: string, ctx: Context, cmd: Cmd): boolean {
  if (bypass(ctx)) return true;
  const rules = tables[table];
  if (!rules) return false;
  return (rules.grants[ctx.role as 'anon' | 'authenticated'] || []).includes(cmd);
}

function applicable(table: string, ctx: Context, cmd: Cmd): Policy[] {
  return (tables[table]?.policies || []).filter(p => (p.cmd === cmd || p.cmd === 'ALL')
    && (p.roles.includes(ctx.role) || p.roles.includes('public')));
}

function combine(permissive: string[], restrictive: string[]): string {
  if (!permissive.length) return 'FALSE';
  const allow = permissive.map(e => `(${e})`).join(' OR ');
  return restrictive.length ? `(${allow}) AND ${restrictive.map(e => `(${e})`).join(' AND ')}` : `(${allow})`;
}

/** USING: which existing rows the caller may see / update / delete. */
export function usingSql(table: string, ctx: Context, cmd: Exclude<Cmd, 'INSERT'>): string {
  const view = VIEW_BASE[table];
  if (view) return `\`${view.key}\` IN (SELECT \`${view.key}\` FROM \`${view.base}\` WHERE ${usingSql(view.base, ctx, cmd)})`;
  if (bypass(ctx) || !tables[table]?.rls) return 'TRUE';
  const policies = applicable(table, ctx, cmd);
  return combine(
    policies.filter(p => p.permissive).map(p => p.using ?? 'TRUE'),
    policies.filter(p => !p.permissive).map(p => p.using ?? 'TRUE'));
}

/** WITH CHECK: whether a new or updated row is acceptable. Without a CHECK
 *  expression an UPDATE/ALL policy uses its USING expression. */
export function checkSql(table: string, ctx: Context, cmd: 'INSERT' | 'UPDATE'): string {
  if (bypass(ctx) || !tables[table]?.rls) return 'TRUE';
  const policies = applicable(table, ctx, cmd);
  const expr = (p: Policy) => p.check ?? (cmd === 'UPDATE' || p.cmd === 'ALL' ? p.using : null) ?? 'TRUE';
  return combine(policies.filter(p => p.permissive).map(expr), policies.filter(p => !p.permissive).map(expr));
}
