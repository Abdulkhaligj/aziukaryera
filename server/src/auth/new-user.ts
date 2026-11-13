// public.handle_new_user: runs right after an auth user is created, as
// SECURITY DEFINER code did. Decides the role from the email domain (the
// requested role in user metadata is only a wish) and creates the profile,
// education, company, free subscription and owner membership.
import { one, type Row } from '../db.ts';
import { DbRuleError } from '../errors.ts';
import { insertRow, type WriteEnv } from '../write/pipeline.ts';

const DEFAULT_UNIVERSITY = 'Azərbaycan Dövlət Neft və Sənaye Universiteti';
const text = (meta: Row, key: string) => (meta[key] == null ? null : String(meta[key]));
const nonEmpty = (meta: Row, key: string) => { const v = text(meta, key); return v === null || v === '' ? null : v; };
const int = (meta: Row, key: string) => { const v = nonEmpty(meta, key); return v === null ? null : Number.parseInt(v, 10); };

export async function handleNewUser(env: WriteEnv, user: { id: string; email: string; raw_app_meta_data: Row; raw_user_meta_data: Row }, universityDomain: string) {
  const meta = user.raw_user_meta_data || {};
  const requested = (text(meta, 'role') ?? 'student').toLowerCase();
  let requestedStatus = (text(meta, 'account_status') ?? 'student').toLowerCase();
  const provider = String(user.raw_app_meta_data?.provider ?? 'email');
  const isUni = user.email.toLowerCase().endsWith('@' + universityDomain);
  let role: 'company' | 'graduate' | 'student';
  if (requested === 'company') role = 'company';
  else if (requested === 'graduate' || requested === 'alumni') { role = 'graduate'; requestedStatus = 'alumni'; }
  else { role = 'student'; if (!['student', 'master_student'].includes(requestedStatus)) requestedStatus = 'student'; }

  if (provider !== 'email' && !isUni && role !== 'graduate') {
    throw new DbRuleError(`Universitet girişi üçün @${universityDomain} hesabı tələb olunur`);
  }
  if (role === 'student' && !isUni) throw new DbRuleError(`Tələbə qeydiyyatı üçün @${universityDomain} e-poçtu tələb olunur`);

  const status = role === 'company' || (role === 'graduate' && !isUni) ? 'pending' : 'active';
  const display = text(meta, 'full_name')?.trim() || user.email.split('@')[0];
  const university = nonEmpty(meta, 'university') ?? DEFAULT_UNIVERSITY;

  await insertRow(env, 'profiles', {
    id: user.id, role, status, email: user.email, full_name: display,
    phone: text(meta, 'phone') ?? '', university, group_name: text(meta, 'group_name') ?? '',
    // A photo URL from sign-up metadata could point anywhere (#53); photos go through the avatar flow.
    avatar_url: null, account_status: requestedStatus,
    // H-01 (audit 2026-11-12): staff verify alumni; sign-up never does.
    alumni_verified: false
  });

  if (role === 'student' || role === 'graduate') {
    if (nonEmpty(meta, 'major_name') !== null) {
      await insertRow(env, 'education', {
        profile_id: user.id, degree_type: 'bachelor', university,
        faculty: text(meta, 'faculty_name') ?? '', specialty: text(meta, 'major_name'),
        group_name: text(meta, 'group_name') ?? '', start_year: int(meta, 'bachelor_start_year'),
        graduation_year: int(meta, 'bachelor_end_year'), is_current: requestedStatus === 'student'
      });
    }
    if (requestedStatus === 'master_student' && nonEmpty(meta, 'master_specialty') !== null) {
      await insertRow(env, 'education', {
        profile_id: user.id, degree_type: 'master', university: text(meta, 'master_university'),
        faculty: text(meta, 'master_faculty') ?? '', specialty: text(meta, 'master_specialty'),
        specialization: text(meta, 'master_specialization') ?? '', group_name: text(meta, 'master_group') ?? '',
        start_year: int(meta, 'master_start_year'), graduation_year: int(meta, 'master_end_year'), is_current: true
      });
    }
  }

  if (role === 'company') {
    const company = await insertRow(env, 'companies', {
      owner_id: user.id, name: nonEmpty(meta, 'company_name') ?? display, email: user.email,
      phone: text(meta, 'phone') ?? '', website: nonEmpty(meta, 'website'), sector: text(meta, 'sector') ?? '',
      company_size: text(meta, 'company_size') ?? '', address: text(meta, 'address') ?? '', logo_url: nonEmpty(meta, 'logo_url'),
      about: text(meta, 'description') ?? '', contact: text(meta, 'contact_name') ?? '',
      contact_position: text(meta, 'contact_position') ?? '', contact_email: text(meta, 'contact_email') ?? '',
      contact_phone: text(meta, 'contact_phone') ?? '', status: 'pending'
    });
    let plan = text(meta, 'plan_id') ?? 'free';
    if (!await one(env.tx, 'SELECT 1 AS ok FROM plans WHERE id = ? AND active', [plan])) plan = 'free';
    await insertRow(env, 'subscriptions', { company_id: company.id, plan_id: plan, status: plan === 'free' ? 'active' : 'pending' });
    await insertRow(env, 'company_members', { company_id: company.id, profile_id: user.id, member_role: 'owner', status: 'active' });
  }
}
