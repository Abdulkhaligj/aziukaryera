// Graduate verification (2026-11-28, migration 0011). A graduate with a
// personal address (Google or email sign-up) is 'pending' until the Career
// Center has checked their diploma details. The graduate writes the details;
// only staff decide, and an approval opens the account. These have no
// Postgres original, hence the 010_alumni_ prefix (trigger-coverage test).
import { one } from '../../db.ts';
import { DbRuleError } from '../../errors.ts';
import { after, before, nowText, updateRow } from '../pipeline.ts';
import { audited, changed, isTrusted, notify, notifyAdmins, privileged } from './core.ts';

const DETAILS = ['full_name', 'diploma_number', 'graduation_year', 'faculty', 'specialty'] as const;

before('alumni_verifications', '010_alumni_verification_guard', ['insert', 'update'], async (env, row, old) => {
  const staff = isTrusted(env) || await privileged(env);
  if (!staff) {
    const me = await one<{ role: string; alumni_verified: number | boolean }>(env.tx,
      'SELECT role, alumni_verified FROM profiles WHERE id = ?', [row.profile_id]);
    if (!me || me.role !== 'graduate') throw new DbRuleError('Məzun təsdiqi yalnız məzun hesabı üçündür', '42501');
    if (Number(me.alumni_verified) === 1 || old?.status === 'approved') throw new DbRuleError('Məzun statusunuz artıq təsdiqlənib', '42501');
    // A graduate only sends details; the decision and its note belong to staff.
    row.status = 'submitted';
    row.review_note = old ? old.review_note : null;
    row.reviewed_by = old ? old.reviewed_by : null;
    row.reviewed_at = old ? old.reviewed_at : null;
  } else if (!old || changed(row, old, 'status')) {
    row.reviewed_by = env.ctx.uid ?? null;
    row.reviewed_at = nowText(env);
  }
  const diploma = String(row.diploma_number ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
  if (!/^[A-Z0-9][A-Z0-9 /-]{3,39}$/.test(diploma)) throw new DbRuleError('Diplom nömrəsini düzgün yazın (4–40 hərf və rəqəm)', '23514');
  row.diploma_number = diploma;
  const year = Number(row.graduation_year);
  if (!Number.isInteger(year) || year < 1950 || year > new Date().getUTCFullYear()) throw new DbRuleError('Buraxılış ilini düzgün yazın', '23514');
  row.graduation_year = year;
  for (const field of ['full_name', 'faculty', 'specialty'] as const) {
    const value = String(row[field] ?? '').trim().replace(/\s+/g, ' ');
    if ([...value].length < 2 || [...value].length > 200) throw new DbRuleError('Ad və soyad, fakültə və ixtisas tələb olunur', '23514');
    row[field] = value;
  }
  if (row.review_note != null) row.review_note = String(row.review_note).trim().slice(0, 1000) || null;
  row.updated_at = nowText(env);
}, null, 'invoker');

after('alumni_verifications', '010_alumni_verification_flow', ['insert', 'update'], async (env, row, old) => {
  if (!row) return;
  // New or changed details: the Career Center sees them in its queue.
  if (row.status === 'submitted' && (!old || old.status !== 'submitted' || changed(row, old, ...DETAILS))) {
    await notifyAdmins(env, 'alumni_verification', 'Məzun təsdiqi gözləyir', `${row.full_name} · ${row.graduation_year} · ${row.specialty}`, 'alumni');
  }
  if (!changed(row, old, 'status') && old) return;
  if (row.status === 'approved') {
    const profile = await one<{ status: string; alumni_verified: number | boolean }>(env.tx,
      'SELECT status, alumni_verified FROM profiles WHERE id = ?', [row.profile_id]);
    if (profile && (profile.status !== 'active' || Number(profile.alumni_verified) !== 1)) {
      await updateRow(env, 'profiles', { id: row.profile_id }, { status: 'active', alumni_verified: true });
    }
    await notify(env, row.profile_id, 'alumni_verified', 'Məzun statusunuz təsdiqləndi',
      'Artıq vakansiyalara müraciət edə bilərsiniz.', 'jobs');
  } else if (row.status === 'rejected') {
    await notify(env, row.profile_id, 'alumni_rejected', 'Məzun təsdiqi alınmadı',
      row.review_note ? String(row.review_note) : 'Diplom məlumatlarını yoxlayıb yenidən göndərin.', 'dashboard');
  }
});

// A graduate approved from the profile form (the "Təsdiqlənmiş ADNSU məzunu"
// box) closes the open request too.
after('profiles', '010_alumni_profile_sync', ['update'], async (env, row, old) => {
  if (!row || !changed(row, old, 'alumni_verified') || Number(row.alumni_verified) !== 1) return;
  const request = await one<{ status: string }>(env.tx, 'SELECT status FROM alumni_verifications WHERE profile_id = ?', [row.id]);
  if (request && request.status !== 'approved') await updateRow(env, 'alumni_verifications', { profile_id: row.id }, { status: 'approved' });
}, ['alumni_verified']);

audited('alumni_verifications', ['update', 'delete']);
