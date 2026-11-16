// Table grants and row-level policies, from policies.generated.json.
// Semantics follow Postgres: a row is allowed when any permissive policy
// allows it AND every restrictive policy does; no permissive policy → none.
import { readFileSync } from 'node:fs';
import type { Context } from '../context.ts';

export type Cmd = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
interface Policy { name: string; cmd: Cmd | 'ALL'; permissive: boolean; roles: string[]; using: string | null; check: string | null }
interface TableRules { rls: boolean; grants: { anon: string[]; authenticated: string[] }; policies: Policy[] }

const { tables } = JSON.parse(readFileSync(new URL('./policies.generated.json', import.meta.url), 'utf8')) as { tables: Record<string, TableRules> };

// Security audit of 2026-11-13: rules on top of the translated policies.
{
  const restrict = (table: string, cmd: Cmd, name: string, using: string) =>
    tables[table]?.policies.push({ name, cmd, permissive: false, roles: ['anon', 'authenticated'], using, check: null });
  // H-06: a suspended or pending company, or one whose owner is suspended,
  // changes nothing through its policies (reading its own data still works).
  const active = (e: string | null) => e?.split('owns_company(').join('owns_active_company(') ?? null;
  for (const rules of Object.values(tables)) {
    const split: Policy[] = [];
    for (const p of rules.policies) {
      if (p.cmd === 'SELECT') continue;
      if (p.cmd === 'ALL') {
        // An ALL policy covers writes too (invites_write): its write part gets the
        // same rule, its read part stays (audit 2026-11-16, M1).
        if (!/owns_company\(/.test(`${p.using} ${p.check}`)) continue;
        split.push({ ...p, cmd: 'SELECT' });
        for (const cmd of ['INSERT', 'UPDATE', 'DELETE'] as const) split.push({ ...p, cmd, using: active(p.using), check: active(p.check) });
        p.cmd = 'SELECT'; p.name = `${p.name}__replaced`; p.roles = [];
        continue;
      }
      p.using = active(p.using);
      p.check = active(p.check);
    }
    rules.policies.push(...split);
  }
  // M2: a rejected company, or one whose owner is blocked, does not edit its row;
  // a pending one may (it completes its profile before the review).
  const ownerMayEdit = "((owner_id = @auth_uid) AND (status IN ('pending', 'active')) AND EXISTS (SELECT 1 FROM profiles op WHERE op.id = @auth_uid AND op.status IN ('pending', 'active')))";
  for (const p of tables.companies?.policies ?? []) {
    if (p.name !== 'companies_update') continue;
    p.using = p.using?.split('(owner_id = @auth_uid)').join(ownerMayEdit) ?? null;
    p.check = p.check?.split('(owner_id = @auth_uid)').join(ownerMayEdit) ?? null;
  }
  // L2: a company that is not active no longer reads its applications, their
  // history or slots, as it no longer reads the applicants' profiles.
  for (const t of ['applications', 'application_status_history', 'company_interview_slots']) {
    for (const p of tables[t]?.policies ?? []) {
      if (p.cmd === 'SELECT' && p.permissive) p.using = active(p.using);
    }
  }
  // M3: an account that is not active sends no message, request or follow.
  for (const t of ['messages', 'connections', 'follows']) {
    tables[t]?.policies.push({ name: 'audit_sender_active', cmd: 'INSERT', permissive: false, roles: ['anon', 'authenticated'], using: null, check: 'app_account_active()' });
  }
  // M5: in Postgres the posts subquery of post_media_read ran under the posts
  // policies; here the same condition is written out.
  restrict('post_media', 'SELECT', 'audit_post_media_visible',
    "EXISTS (SELECT 1 FROM posts p WHERE p.id = post_media.post_id AND ((p.moderation_status = 'visible') OR ((p.author_id = @auth_uid) AND (p.moderation_status = 'pending')) OR (@is_admin = 1)))");
  // The same for applying: the vacancy's company must be active (it is hidden otherwise).
  tables.applications?.policies.push({ name: 'audit_apply_company_active', cmd: 'INSERT', permissive: false, roles: ['anon', 'authenticated'], using: null,
    check: "EXISTS (SELECT 1 FROM jobs j JOIN companies c ON c.id = j.company_id WHERE j.id = applications.job_id AND c.status = 'active')" });
  // H-06: the vacancies of a company that is not active are not public.
  restrict('jobs', 'SELECT', 'audit_jobs_active_company',
    "(@is_admin = 1) OR owns_company(company_id) OR EXISTS (SELECT 1 FROM companies c WHERE c.id = jobs.company_id AND c.status = 'active')");
  // #29: among the staff, only super admins and managers see payments and plans.
  for (const t of ['payments', 'subscriptions', 'subscription_usage']) {
    restrict(t, 'SELECT', 'audit_billing_senior_staff', "(NOT (@actor_is_staff = 1)) OR (COALESCE(@admin_role, '') IN ('super_admin', 'manager'))");
  }
}

/** Columns a visitor without an account does not read (#62): the contact
 *  details of a company are for signed-in students and staff. */
export const ANON_HIDDEN: Record<string, string[]> = {
  companies: ['owner_id', 'email', 'phone', 'contact', 'contact_position', 'contact_email', 'contact_phone']
};
export const hiddenFor = (ctx: Context, table: string): string[] => (ctx.role === 'anon' ? ANON_HIDDEN[table] ?? [] : []);

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
