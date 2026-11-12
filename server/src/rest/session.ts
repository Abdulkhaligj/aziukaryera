// Per-request session variables read by the policy fragments and the
// stored functions of migration 0003 — the counterpart of request.jwt.claims.
import type { Context } from '../context.ts';
import { exec, one, type Tx } from '../db.ts';
import { currentAdminRole } from '../write/rules/core.ts';

export async function applySession(tx: Tx, ctx: Context): Promise<void> {
  const adminRole = await currentAdminRole(tx, ctx);
  const jwtAdminRole = ctx.claims?.app_metadata?.admin_role;
  let staff = false;
  if (ctx.uid) {
    const profile = await one<{ role: string }>(tx, 'SELECT role FROM profiles WHERE id = ?', [ctx.uid]);
    staff = profile?.role === 'admin' || (typeof jwtAdminRole === 'string' && jwtAdminRole !== '');
  }
  await exec(tx, `SET @auth_uid = CAST(? AS CHAR CHARACTER SET ascii) COLLATE ascii_bin, @auth_role = ?, @is_admin = ?,
      @admin_role = ?, @actor_is_staff = ?, @jwt_admin_role = ?`,
    [ctx.uid, ctx.role, adminRole ? 1 : 0, adminRole, staff ? 1 : 0, typeof jwtAdminRole === 'string' ? jwtAdminRole : null]);
}
