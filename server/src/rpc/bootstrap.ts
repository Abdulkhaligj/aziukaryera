// public.career_bootstrap_v1: everything the portal needs after sign-in in one
// call. SECURITY INVOKER, so every table is read under the caller's policies.
import type { Row } from '../db.ts';
import { DbRuleError } from '../errors.ts';
import { parseSelect, type OrderTerm } from '../rest/parse.ts';
import { readRows, type Where } from '../rest/select.ts';
import type { WriteEnv } from '../write/pipeline.ts';
import { candidateProfiles } from './profiles.ts';
import { rpc } from './registry.ts';

const ALL = parseSelect('*');
const asc = (column: string): OrderTerm => ({ column, desc: false, nulls: null });
const desc = (column: string): OrderTerm => ({ column, desc: true, nulls: null });

async function visible(env: WriteEnv, table: string, options: { order?: OrderTerm[]; limit?: number; where?: Where } = {}): Promise<Row[]> {
  return (await readRows(env.tx, env.schema, env.ctx, table, ALL, options)).rows;
}

const time = (v: unknown) => (v == null ? null : new Date(v as string).getTime());

rpc({
  name: 'career_bootstrap_v1', readOnly: true, args: {}, roles: ['authenticated'], security: 'invoker', returns: 'value',
  async run(env) {
    const me = env.ctx.uid;
    if (!me) throw new DbRuleError('Hesaba daxil olmaq tələb olunur.', '28000');
    const byId = (id: string): Where => ({ sql: ['`id` = ?'], params: [id] });
    const now = env.now.getTime();

    // (status = 'active') DESC, starts_at DESC (NULLS FIRST), LIMIT 1
    const subscriptions = (await visible(env, 'subscriptions')).sort((a, b) =>
      Number(b.status === 'active') - Number(a.status === 'active')
      || (time(a.starts_at) === null ? -1 : time(b.starts_at) === null ? 1 : time(b.starts_at)! - time(a.starts_at)!));
    let subscription: Row | null = null;
    if (subscriptions.length) {
      const s = subscriptions[0];
      const plan = s.plan_id == null ? null : (await visible(env, 'plans', { where: byId(s.plan_id as string) }))[0] ?? null;
      const expired = s.plan_id !== 'free' && (s.ends_at == null || time(s.ends_at)! <= now || (s.starts_at != null && time(s.starts_at)! > now));
      subscription = { ...s, status: expired ? 'expired' : s.status, plans: plan };
    }

    const candidates = (await candidateProfiles(env)).map(c => ({
      id: c.id, full_name: c.full_name, role: c.role, status: c.status, faculty_id: c.faculty_id, major_id: c.major_id,
      course: c.course, gpa: c.gpa, skills: c.skills, summary: c.summary, account_status: c.account_status
    }));

    return {
      uid: me,
      email: typeof env.ctx.claims?.email === 'string' ? env.ctx.claims.email : '',
      faculties: await visible(env, 'faculties', { order: [asc('sort_order')] }),
      majors: await visible(env, 'majors'),
      profile: (await visible(env, 'profiles', { where: byId(me), limit: 1 }))[0] ?? null,
      education: await visible(env, 'education', { where: { sql: ['`profile_id` = ?'], params: [me] }, order: [asc('start_year')] }),
      candidates,
      companies: await visible(env, 'companies'),
      jobs: await visible(env, 'jobs'),
      applications: await visible(env, 'applications'),
      saved: (await visible(env, 'saved_jobs')).map(s => s.job_id),
      invites: await visible(env, 'invites'),
      events: await visible(env, 'events', { order: [asc('starts_at')] }),
      eventRegistrations: (await visible(env, 'event_registrations')).map(r => r.event_id),
      subscription,
      notifications: await visible(env, 'notifications', { order: [desc('created_at')], limit: 100 }),
      broadcasts: await visible(env, 'broadcast_notifications', { order: [desc('created_at')], limit: 100 }),
      broadcastReads: (await visible(env, 'broadcast_notification_reads')).map(r => ({ broadcast_id: r.broadcast_id, read_at: r.read_at }))
    };
  }
});
