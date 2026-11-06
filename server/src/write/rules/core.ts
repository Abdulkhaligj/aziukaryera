// Shared database functions: public.current_admin_role / is_admin,
// private.audit_security_change, private.notify_admins / notify_company,
// plus the Postgres text helpers the trigger bodies use.
import { one, rows, toMysqlDatetime, type Row, type Tx } from '../../db.ts';
import type { Context } from '../../context.ts';
import { after, insertRow, type Op, type WriteEnv } from '../pipeline.ts';
import { distinct } from '../../values.ts';

const ADMIN_ROLES = ['super_admin', 'manager', 'editor', 'reviewer'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** public.current_admin_role(): the caller's staff role, checked against the
 *  profile, the server-owned app_metadata and the JWT, or null. */
export async function currentAdminRole(tx: Tx, ctx: Context): Promise<string | null> {
  if (ctx.role !== 'authenticated' || !ctx.uid || !ctx.claims) return null;
  const jwtMeta = (ctx.claims.app_metadata || {}) as Record<string, unknown>;
  const row = await one<{ admin_role: string; meta_role: string | null; meta_must: string | null }>(tx,
    `SELECT p.admin_role,
            JSON_UNQUOTE(JSON_EXTRACT(u.raw_app_meta_data, '$.admin_role')) AS meta_role,
            JSON_UNQUOTE(JSON_EXTRACT(u.raw_app_meta_data, '$.must_change_password')) AS meta_must
       FROM profiles p JOIN auth_users u ON u.id = p.id
      WHERE p.id = ? AND p.role = 'admin' AND p.status = 'active'`, [ctx.uid]);
  if (!row || !ADMIN_ROLES.includes(row.admin_role)) return null;
  if (row.admin_role !== row.meta_role || row.admin_role !== jwtMeta.admin_role) return null;
  if ((row.meta_must ?? 'false') !== 'false' || String(jwtMeta.must_change_password ?? 'false') !== 'false') return null;
  return row.admin_role;
}

export async function isAdmin(env: WriteEnv): Promise<boolean> {
  return (await currentAdminRole(env.tx, env.ctx)) !== null;
}

/** `auth.uid() is null or public.is_admin()`: trusted callers and staff. */
export async function privileged(env: WriteEnv): Promise<boolean> {
  return !env.ctx.uid || await isAdmin(env);
}

/** current_user not in ('authenticated','anon'): SECURITY DEFINER code, the service role and server internals. */
export const isTrusted = (env: WriteEnv) => !!env.definer || env.ctx.role === 'system' || env.ctx.role === 'service_role';

/** NEW.col IS DISTINCT FROM OLD.col (false for INSERT, where OLD is null). */
export const changed = (row: Row, old: Row | null, ...columns: string[]) =>
  !!old && columns.some(c => distinct(row[c], old[c]));

/** Postgres trim(): spaces only, not every whitespace character. */
export const pgTrim = (s: unknown) => (s == null ? s : String(s).replace(/^ +| +$/g, ''));
/** Postgres left(): characters, not UTF-16 units. */
export const left = (s: unknown, n: number) => (s == null ? s : [...String(s)].slice(0, n).join('')) as string;
/** nullif(x, '') */
export const nonEmpty = (s: unknown) => (s == null || s === '' ? null : String(s));
/** concat_ws(sep, ...): skips nulls. */
export const concatWs = (sep: string, ...parts: unknown[]) => parts.filter(p => p != null).map(String).join(sep);

/** to_char(ts at time zone 'Asia/Baku', 'DD.MM.YYYY[ HH24:MI]'). Baku is UTC+4 without DST. */
export function bakuText(value: unknown, withTime = true): string | null {
  if (value == null) return null;
  const d = new Date(new Date(value as string).getTime() + 4 * 3_600_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
  return withTime ? `${date} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : date;
}

async function audit(env: WriteEnv, tableName: string, op: string, row: Row) {
  const id = typeof row.id === 'string' && UUID.test(row.id) ? row.id : null;
  const actor = env.ctx.uid ? await one<{ full_name: string }>(env.tx, 'SELECT full_name FROM profiles WHERE id = ?', [env.ctx.uid]) : null;
  await insertRow(env, 'admin_audit_logs', {
    title: `Database ${op}: ${tableName}`, resource: tableName, resource_id: id,
    action: `db_${op}`, actor_id: env.ctx.uid, actor_name: actor?.full_name || 'System'
  });
}

/** Attach private.audit_security_change to a table (trigger security_audit_changes,
 *  or security_audit_deletes when only deletes are audited). */
export function audited(tableName: string, ops: Op[] = ['insert', 'update', 'delete']) {
  const name = ops.length === 1 && ops[0] === 'delete' ? 'security_audit_deletes' : 'security_audit_changes';
  for (const op of ops) after(tableName, name, [op], (env, row, old) => audit(env, tableName, op, (row || old)!));
}

export async function notify(env: WriteEnv, profileId: unknown, kind: string, title: string, body: string | null, link: string | null) {
  await insertRow(env, 'notifications', { profile_id: profileId, kind, title, body: body ?? '', link });
}

/** private.notify_admins: one notification per active admin. */
export async function notifyAdmins(env: WriteEnv, kind: string, title: string, body: string | null, link: string | null = null) {
  const admins = await rows<{ id: string }>(env.tx, `SELECT id FROM profiles WHERE role = 'admin' AND status = 'active'`);
  for (const admin of admins) await notify(env, admin.id, kind, title, body, link);
}

/** private.notify_company: the owner and active owner/admin members. */
export async function notifyCompany(env: WriteEnv, companyId: unknown, kind: string, title: string, body: string | null, link = 'subscription') {
  const people = await rows<{ pid: string }>(env.tx,
    `SELECT owner_id AS pid FROM companies WHERE id = ? AND owner_id IS NOT NULL
      UNION SELECT profile_id FROM company_members WHERE company_id = ? AND status = 'active' AND member_role IN ('owner', 'admin')
            AND profile_id IS NOT NULL`, [companyId, companyId]);
  for (const p of people) await notify(env, p.pid, kind, title, body, link);
}

/** public.company_has_feature */
export async function companyHasFeature(env: WriteEnv, companyId: unknown, feature: string): Promise<boolean> {
  return !!await one(env.tx, `SELECT 1 AS ok FROM subscriptions s JOIN plan_features pf ON pf.plan_id = s.plan_id
     WHERE s.company_id = ? AND s.status = 'active' AND (s.starts_at IS NULL OR s.starts_at <= ?)
       AND (s.plan_id = 'free' OR s.ends_at > ?) AND pf.feature_key = ? AND pf.enabled LIMIT 1`,
    [companyId, toMysqlDatetime(env.now), toMysqlDatetime(env.now), feature]);
}
