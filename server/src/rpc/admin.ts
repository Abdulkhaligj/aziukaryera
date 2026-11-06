// public.admin_reset_platform_data → private.reset_career_platform: a super
// admin empties the platform but keeps every administrator account.
import { one, rows } from '../db.ts';
import { DbRuleError } from '../errors.ts';
import { deleteWhere, insertRow } from '../write/pipeline.ts';
import { currentAdminRole } from '../write/rules/core.ts';
import { rpc } from './registry.ts';

// Children first, as in Postgres, so the operation stays foreign-key safe.
const TABLES = ['broadcast_notification_reads', 'moderation_logs', 'notifications', 'ai_usage', 'post_saves', 'post_media',
  'post_comments', 'post_likes', 'messages', 'connections', 'follows', 'reports', 'benefit_claims', 'event_registrations',
  'invites', 'saved_jobs', 'application_status_history', 'applications', 'payments', 'subscription_usage',
  'interview_sessions', 'cv_documents', 'education', 'company_members', 'subscriptions', 'jobs', 'events', 'benefits',
  'benefit_partners', 'posts', 'broadcast_notifications', 'companies', 'site_content', 'content', 'audit_logs', 'admin_audit_logs'];

rpc({
  name: 'admin_reset_platform_data', args: { p_confirmation: 'text' }, roles: ['authenticated'], security: 'invoker', returns: 'value',
  async run(invoker, a) {
    // The private function is SECURITY DEFINER.
    const env = { ...invoker, definer: true };
    // `p_confirmation <> 'SIFIRLA'` is NULL (not true) for a NULL argument.
    if (a.p_confirmation != null && a.p_confirmation !== 'SIFIRLA') throw new DbRuleError('Sıfırlama təsdiqi yanlışdır', 'P0001');
    if (await currentAdminRole(env.tx, env.ctx) !== 'super_admin') {
      throw new DbRuleError('Bu əməliyyatı yalnız aktiv Super Admin icra edə bilər', 'P0001');
    }
    // Every row goes through the write pipeline, so triggers (and FK actions) run as in Postgres.
    for (const table of TABLES) await deleteWhere(env, table);
    // Deleting auth users removes their profiles; administrator seats are kept.
    const removed = await deleteWhere(env, 'auth_users',
      `NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth_users.id AND p.role = 'admin')`);
    const kept = Number((await one<{ n: number }>(env.tx, `SELECT COUNT(*) AS n FROM profiles WHERE role = 'admin'`))!.n);
    for (const actor of await rows<{ id: string; full_name: string }>(env.tx, 'SELECT id, full_name FROM profiles WHERE id = ?', [env.ctx.uid])) {
      await insertRow(env, 'admin_audit_logs', { title: 'Platforma məlumatları sıfırlandı', resource: 'system', resource_id: null,
        action: 'reset', actor_id: actor.id, actor_name: actor.full_name });
    }
    return { ok: true, removed_users: removed, kept_admins: kept };
  }
});
