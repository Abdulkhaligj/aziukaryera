// Triggers on profiles and education.
import { one } from '../../db.ts';
import { DbRuleError } from '../../errors.ts';
import { on } from '../pipeline.ts';
import { audited, currentAdminRole, isAdmin, isTrusted } from './core.ts';

const AVATAR_FIELDS = ['avatar_path', 'avatar_pending_path', 'avatar_requested_at', 'avatar_attempts',
  'avatar_reason', 'avatar_moderated_at', 'avatar_submit_day', 'avatar_submit_count'] as const;

// public.enforce_admin_seat_limit: at most 5 active admin accounts.
on('profiles', ['insert', 'update'], 'before', async (env, row, old) => {
  const consumesSeat = row.role === 'admin' && row.status === 'active'
    && (!old || old.role !== row.role || old.status !== row.status);
  if (!consumesSeat) return;
  const other = await one<{ n: number }>(env.tx,
    `SELECT COUNT(*) AS n FROM profiles WHERE role = 'admin' AND status = 'active' AND id <> ?`, [row.id]);
  if ((other?.n ?? 0) >= 5) throw new DbRuleError('Admin giriş limiti dolub (maksimum 5 aktiv hesab)', 'P0001');
});

// private.profile_avatar_guard: avatar state is server-owned for ordinary users.
on('profiles', ['insert', 'update'], 'before', async (env, row, old) => {
  if (isTrusted(env) || await isAdmin(env)) return;
  for (const field of AVATAR_FIELDS) {
    row[field] = old ? old[field] : (field === 'avatar_attempts' || field === 'avatar_submit_count' ? 0 : null);
  }
});

audited('profiles');

// private.education_verification_guard: only super_admin/manager verify education.
on('education', ['insert', 'update'], 'before', async (env, row, old) => {
  if (env.ctx.role !== 'anon' && env.ctx.role !== 'authenticated') return;
  const role = await currentAdminRole(env.tx, env.ctx);
  if (role === 'super_admin' || role === 'manager') return;
  if ((!old && row.verified === true) || (old && row.verified !== old.verified)) {
    throw new DbRuleError('Education verification requires an authorized staff account', '42501');
  }
});

audited('education');
audited('companies');
