// Triggers on profiles, education and companies.
import { one } from '../../db.ts';
import { DbRuleError } from '../../errors.ts';
import { after, before, nowText, updateRow } from '../pipeline.ts';
import { audited, changed, currentAdminRole, isAdmin, isTrusted, privileged } from './core.ts';

const AVATAR_FIELDS = ['avatar_path', 'avatar_pending_path', 'avatar_requested_at', 'avatar_attempts',
  'avatar_reason', 'avatar_moderated_at', 'avatar_submit_day', 'avatar_submit_count'] as const;

// profiles_admin_seat_limit → public.enforce_admin_seat_limit: at most 5 active admin accounts.
before('profiles', 'profiles_admin_seat_limit', ['insert', 'update'], async (env, row, old) => {
  const consumesSeat = row.role === 'admin' && row.status === 'active'
    && (!old || old.role !== row.role || old.status !== row.status);
  if (!consumesSeat) return;
  const other = await one<{ n: number }>(env.tx,
    `SELECT COUNT(*) AS n FROM profiles WHERE role = 'admin' AND status = 'active' AND id <> ?`, [row.id]);
  if ((other?.n ?? 0) >= 5) throw new DbRuleError('Admin giriş limiti dolub (maksimum 5 aktiv hesab)', 'P0001');
}, ['role', 'status']);

// profiles_avatar_guard → private.profile_avatar_guard: avatar state is server-owned for ordinary users.
before('profiles', 'profiles_avatar_guard', ['insert', 'update'], async (env, row, old) => {
  if (isTrusted(env) || await isAdmin(env)) return;
  for (const field of AVATAR_FIELDS) {
    row[field] = old ? old[field] : (field === 'avatar_attempts' || field === 'avatar_submit_count' ? 0 : null);
  }
});

// profiles_guard_privileges → public.guard_profile_privileges
before('profiles', 'profiles_guard_privileges', ['update'], async (env, row, old) => {
  if (!await privileged(env)) {
    if (changed(row, old, 'role', 'status')) throw new DbRuleError('Rol və hesab statusunu dəyişmək icazəsi yoxdur', '42501');
    if (changed(row, old, 'alumni_verified')) throw new DbRuleError('Məzun təsdiqini yalnız Karyera Mərkəzi dəyişə bilər', '42501');
  }
  row.updated_at = nowText(env);
});

audited('profiles');

// security_education_verification → private.education_verification_guard:
// only super_admin/manager verify education.
before('education', 'security_education_verification', ['insert', 'update'], async (env, row, old) => {
  if (env.ctx.role !== 'anon' && env.ctx.role !== 'authenticated') return;
  const role = await currentAdminRole(env.tx, env.ctx);
  if (role === 'super_admin' || role === 'manager') return;
  if ((!old && row.verified === true) || (old && row.verified !== old.verified)) {
    throw new DbRuleError('Education verification requires an authorized staff account', '42501');
  }
});

audited('education');

// companies_guard_status → public.guard_company_status
before('companies', 'companies_guard_status', ['update'], async (env, row, old) => {
  if (await privileged(env)) return;
  if (changed(row, old, 'status')) throw new DbRuleError('Şirkət statusunu yalnız Karyera Mərkəzi dəyişə bilər', '42501');
});

// companies_sync_owner_profile_status → public.sync_company_owner_profile_status
// (WHEN old.status IS DISTINCT FROM new.status)
after('companies', 'companies_sync_owner_profile_status', ['update'], async (env, row, old) => {
  if (!row || !changed(row, old, 'status') || row.owner_id == null) return;
  const owner = await one<{ id: string }>(env.tx, `SELECT id FROM profiles WHERE id = ? AND role = 'company' AND status <> ?`,
    [row.owner_id, row.status]);
  if (owner) await updateRow(env, 'profiles', { id: owner.id }, { status: row.status });
}, ['status']);

audited('companies');
