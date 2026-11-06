// Triggers on company_interview_slots, interview_requests and
// company_partnership_requests, plus the slots' no-overlap EXCLUDE constraint.
import { one, toMysqlDatetime, type Row } from '../../db.ts';
import { DbRuleError } from '../../errors.ts';
import { after, before, columnDefault, constraint, insertRow, nowText, updateRow, type WriteEnv } from '../pipeline.ts';
import { audited, bakuText, changed, left, notify, notifyAdmins, pgTrim } from './core.ts';

const MINUTE = 60_000;
const end = (start: unknown, minutes: number) => new Date(new Date(start as string).getTime() + minutes * MINUTE);

/** Overlapping scheduled slots of the same application. `lengthSql` is how
 *  long a stored slot lasts (the validator and the constraint differ). */
async function overlapping(env: WriteEnv, row: Row, lengthSql: string, minutes: number) {
  // Serialises concurrent writers for one application, as the GiST EXCLUDE did.
  await one(env.tx, 'SELECT id FROM applications WHERE id = ? FOR UPDATE', [row.application_id]);
  return one(env.tx, `SELECT id FROM company_interview_slots s
     WHERE s.application_id = ? AND s.id <> ? AND s.status = 'scheduled'
       AND ? < DATE_ADD(s.starts_at, INTERVAL ${lengthSql} MINUTE) AND s.starts_at < ?`,
    [row.application_id, row.id, toMysqlDatetime(row.starts_at as string), toMysqlDatetime(end(row.starts_at, minutes))]);
}

// company_interview_slots_guard → public.company_employer_record_guard (slots)
before('company_interview_slots', 'company_interview_slots_guard', ['update'], (env, row, old) => {
  if (changed(row, old, 'application_id', 'created_by', 'created_at')) {
    throw new DbRuleError('Müsahibənin namizəd və müəllif məlumatı dəyişdirilə bilməz', 'P0001');
  }
  row.updated_at = nowText(env);
});

// company_interview_slots_validate → public.validate_company_interview_slot
before('company_interview_slots', 'company_interview_slots_validate', ['insert', 'update'], async (env, row, old) => {
  if (row.status !== 'scheduled') return;
  // Legacy rows stay editable when none of the scheduling fields changed.
  if (old && !changed(row, old, 'application_id', 'starts_at', 'duration_minutes', 'meeting_mode', 'location', 'status')) return;
  if (row.meeting_mode === 'on_site' && !pgTrim(row.location ?? '')) {
    throw new DbRuleError('Əyani müsahibə üçün görüş məkanı daxil edilməlidir', '23514');
  }
  const minutes = Math.max(Number(row.duration_minutes ?? 45), 1);
  if (await overlapping(env, row, 'GREATEST(COALESCE(s.duration_minutes, 45), 1)', minutes)) {
    throw new DbRuleError('Bu namizəd üçün seçilən vaxtda artıq aktiv müsahibə var', '23505');
  }
}, ['application_id', 'starts_at', 'duration_minutes', 'meeting_mode', 'location', 'status']);

// EXCLUDE company_interview_slots_no_overlap: (application_id =, [starts_at, interview_end) &&) WHERE status = 'scheduled'
constraint('company_interview_slots', 'company_interview_slots_no_overlap', ['insert', 'update'], async (env, row) => {
  if (row.status !== 'scheduled') return;
  if (await overlapping(env, row, 's.duration_minutes', Number(row.duration_minutes))) {
    throw new DbRuleError('conflicting key value violates exclusion constraint "company_interview_slots_no_overlap"', '23P01');
  }
});

// company_interview_slots_advance_application → public.advance_interview_application_on_slot
const EARLY_STAGES = ['gonderildi', 'baxilir', 'applied', 'under_review', 'shortlisted'];
after('company_interview_slots', 'company_interview_slots_advance_application', ['insert', 'update'], async (env, row, old) => {
  if (!row || row.status !== 'scheduled' || (old && !changed(row, old, 'status'))) return;
  const application = await one<{ id: string; status: string }>(env.tx, 'SELECT id, status FROM applications WHERE id = ?', [row.application_id]);
  if (application && EARLY_STAGES.includes(application.status)) await updateRow(env, 'applications', { id: application.id }, { status: 'interview' });
}, ['status']);

// company_interview_slots_notify → public.notify_company_interview_slot
after('company_interview_slots', 'company_interview_slots_notify', ['insert', 'update'], async (env, row, old) => {
  if (!row) return;
  const target = await one<{ student_id: string; title: string | null }>(env.tx,
    'SELECT a.student_id, j.title FROM applications a JOIN jobs j ON j.id = a.job_id WHERE a.id = ?', [row.application_id]);
  if (!target?.student_id) return;
  if (old && !changed(row, old, 'starts_at', 'status')) return;
  const subject = row.status === 'cancelled' ? 'Müsahibə ləğv edildi'
    : row.status === 'completed' ? 'Müsahibə tamamlandı' : 'Müsahibə vaxtınız təyin olundu';
  await notify(env, target.student_id, 'interview', subject,
    `${target.title ?? 'Vakansiya'} · ${bakuText(row.starts_at)} (Bakı vaxtı)`, 'applications');
}, ['starts_at', 'status']);

// interview_request_slot_sync → public.sync_interview_request_on_slot (AFTER INSERT)
after('company_interview_slots', 'interview_request_slot_sync', ['insert'], async (env, row) => {
  if (!row || row.status !== 'scheduled') return;
  const target = await one<{ student_id: string; company_id: string }>(env.tx,
    'SELECT a.student_id, j.company_id FROM applications a JOIN jobs j ON j.id = a.job_id WHERE a.id = ?', [row.application_id]);
  if (!target?.student_id || !target.company_id) return;
  const existing = await one<{ id: string; status: string }>(env.tx,
    'SELECT id, status FROM interview_requests WHERE application_id = ? FOR UPDATE', [row.application_id]);
  if (!existing) {
    await insertRow(env, 'interview_requests', { application_id: row.application_id, student_id: target.student_id,
      company_id: target.company_id, status: 'scheduled', scheduled_slot_id: row.id });
  } else if (['pending', 'accepted', 'scheduled'].includes(existing.status)) {
    await updateRow(env, 'interview_requests', { id: existing.id }, { status: 'scheduled', scheduled_slot_id: row.id, updated_at: nowText(env) });
  }
});

columnDefault('company_interview_slots', 'created_by', env => env.ctx.uid ?? null);
audited('company_interview_slots');

// interview_requests_notify → public.notify_interview_request
after('interview_requests', 'interview_requests_notify', ['insert', 'update'], async (env, row, old) => {
  if (!row) return;
  const ctx = await one<{ owner_id: string; title: string | null }>(env.tx,
    `SELECT c.owner_id, j.title FROM companies c JOIN jobs j ON j.company_id = c.id JOIN applications a ON a.job_id = j.id
      WHERE a.id = ? AND c.id = ?`, [row.application_id, row.company_id]);
  const job = ctx?.title ?? 'Vakansiya';
  const owner = ctx?.owner_id ?? null;
  if (row.status === 'pending' && (!old || changed(row, old, 'status'))) {
    if (owner) await notify(env, owner, 'interview_request', 'Yeni müsahibə sorğusu', `${job} üzrə namizəd müsahibə istəyir.`, 'interview-inbox');
  } else if (old && changed(row, old, 'status')) {
    if (row.status === 'accepted') {
      await notify(env, row.student_id, 'interview_request', 'Müsahibə sorğunuz qəbul edildi', `${job} üzrə şirkət görüş təyin edə bilər.`, 'interview-requests');
    } else if (row.status === 'declined') {
      await notify(env, row.student_id, 'interview_request', 'Müsahibə sorğunuza cavab verildi', `${job} üzrə sorğu qəbul edilmədi.`, 'interview-requests');
    } else if (row.status === 'cancelled' && owner) {
      await notify(env, owner, 'interview_request', 'Müsahibə sorğusu ləğv olundu', `${job} üzrə namizəd sorğunu geri götürdü.`, 'interview-inbox');
    }
    // Scheduled interviews are announced by company_interview_slots_notify.
  }
}, ['status']);

// company_partnership_requests_guard → public.company_employer_record_guard (partnerships)
before('company_partnership_requests', 'company_partnership_requests_guard', ['update'], (env, row, old) => {
  if (changed(row, old, 'company_id', 'created_by', 'created_at', 'category', 'title', 'details', 'preferred_date', 'contact_email')) {
    throw new DbRuleError('Əməkdaşlıq müraciətinin ilkin məlumatı dəyişdirilə bilməz', 'P0001');
  }
  row.updated_at = nowText(env);
});

// company_partnership_requests_notify → public.notify_company_partnership_event
after('company_partnership_requests', 'company_partnership_requests_notify', ['insert', 'update'], async (env, row, old) => {
  if (!row) return;
  const company = await one<{ name: string | null; owner_id: string | null }>(env.tx, 'SELECT name, owner_id FROM companies WHERE id = ?', [row.company_id]);
  if (!old) {
    await notifyAdmins(env, 'partnership', 'Yeni əməkdaşlıq müraciəti', left(`${company?.name ?? 'Şirkət'}: ${row.title}`, 500), 'partnerships-admin');
  } else if (changed(row, old, 'status', 'admin_note') && company?.owner_id) {
    await notify(env, company.owner_id, 'partnership', 'Əməkdaşlıq sorğunuz yeniləndi', left(`${row.title} · Status: ${row.status}`, 500), 'partnerships');
  }
}, ['status', 'admin_note']);

columnDefault('company_partnership_requests', 'created_by', env => env.ctx.uid ?? null);
audited('company_partnership_requests');

