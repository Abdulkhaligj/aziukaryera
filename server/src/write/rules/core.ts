// Shared database functions: public.current_admin_role / is_admin,
// private.audit_security_change and private.notify_admins.
import { one, rows, type Row, type Tx } from '../../db.ts';
import type { Context } from '../../context.ts';
import { insertRow, on, type WriteEnv } from '../pipeline.ts';

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

/** current_user not in ('authenticated','anon'): definer code and service role. */
export const isTrusted = (env: WriteEnv) => env.ctx.role === 'system' || env.ctx.role === 'service_role';

async function audit(env: WriteEnv, tableName: string, op: string, row: Row) {
  const id = typeof row.id === 'string' && UUID.test(row.id) ? row.id : null;
  const actor = env.ctx.uid ? await one<{ full_name: string }>(env.tx, 'SELECT full_name FROM profiles WHERE id = ?', [env.ctx.uid]) : null;
  await insertRow(env, 'admin_audit_logs', {
    title: `Database ${op}: ${tableName}`, resource: tableName, resource_id: id,
    action: `db_${op}`, actor_id: env.ctx.uid, actor_name: actor?.full_name || 'System'
  });
}

/** Attach private.audit_security_change to a table for the given operations. */
export function audited(tableName: string, ops: ('insert' | 'update' | 'delete')[] = ['insert', 'update', 'delete']) {
  for (const op of ops) on(tableName, [op], 'after', (env, row, old) => audit(env, tableName, op, (row || old)!));
}

/** private.notify_admins: one notification per active admin. */
export async function notifyAdmins(env: WriteEnv, kind: string, title: string, body: string | null, link: string | null = null) {
  const admins = await rows<{ id: string }>(env.tx, `SELECT id FROM profiles WHERE role = 'admin' AND status = 'active'`);
  for (const admin of admins) await insertRow(env, 'notifications', { profile_id: admin.id, kind, title, body: body ?? '', link });
}
