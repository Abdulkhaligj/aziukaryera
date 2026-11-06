// Triggers on applications, jobs, reports and mentor_requests: limited staff
// roles, status guards, application history and the workflow notifications
// (public.notify_core_workflow).
import { one } from '../../db.ts';
import { DbRuleError } from '../../errors.ts';
import { table } from '../../schema.ts';
import { distinct } from '../../values.ts';
import { after, before, insertRow, nowText } from '../pipeline.ts';
import { audited, changed, currentAdminRole, notify, privileged } from './core.ts';

// "000_security_limited_admin_fields" → private.limited_admin_fields_guard:
// reviewers and editors may only change the moderation columns.
const LIMITED_FIELDS: Record<string, string[]> = {
  applications: ['status', 'note'],
  posts: ['moderation_status'],
  reports: ['status', 'reviewed_by', 'reviewed_at'],
  mentor_requests: ['status', 'mentor_name', 'admin_note', 'updated_at']
};
for (const [tableName, allowed] of Object.entries(LIMITED_FIELDS)) {
  before(tableName, '000_security_limited_admin_fields', ['update'], async (env, row, old) => {
    const role = await currentAdminRole(env.tx, env.ctx);
    if (role !== 'reviewer' && role !== 'editor') return;
    const columns = [...table(env.schema, tableName).columns.keys()].filter(c => !allowed.includes(c));
    if (columns.some(c => distinct(row[c], old![c]))) {
      throw new DbRuleError('Limited administrators may only change moderation fields', '42501');
    }
    if (tableName === 'reports') {
      if (changed(row, old, 'reviewed_by') && row.reviewed_by !== env.ctx.uid) {
        throw new DbRuleError('Review attribution must match the current administrator', '42501');
      }
      row.reviewed_by = env.ctx.uid;
      row.reviewed_at = nowText(env);
    } else if (tableName === 'mentor_requests') {
      row.updated_at = nowText(env);
    }
  });
}

// applications_update_guard → public.guard_application_update
before('applications', 'applications_update_guard', ['update'], async (env, row, old) => {
  if (!await privileged(env)) {
    if (changed(row, old, 'job_id', 'student_id', 'note', 'created_at')) {
      throw new DbRuleError('Müraciətin bu sahələrini dəyişmək icazəsi yoxdur', '42501');
    }
    if (changed(row, old, 'status') && row.status === 'geri_goturuldu') {
      throw new DbRuleError('Müraciəti yalnız tələbə geri götürə bilər', '42501');
    }
  }
  row.updated_at = nowText(env);
});

// applications_status_history → public.record_application_status_history
after('applications', 'applications_status_history', ['insert', 'update'], async (env, row, old) => {
  if (!row || (old && !changed(row, old, 'status'))) return;
  await insertRow(env, 'application_status_history', {
    application_id: row.id, old_status: old ? old.status : null, new_status: row.status,
    changed_by: env.ctx.uid, note: row.company_note ?? ''
  });
}, ['status']);

// applications_workflow_notification → public.notify_core_workflow (applications)
after('applications', 'applications_workflow_notification', ['insert', 'update'], async (env, row, old) => {
  if (!row) return;
  if (!old) {
    const owner = await one<{ owner_id: string | null }>(env.tx,
      'SELECT c.owner_id FROM jobs j JOIN companies c ON c.id = j.company_id WHERE j.id = ?', [row.job_id]);
    if (owner?.owner_id) await notify(env, owner.owner_id, 'new_application', 'Yeni müraciət', 'Vakansiyanıza yeni müraciət daxil olub.', 'applications');
  } else if (changed(row, old, 'status')) {
    await notify(env, row.student_id, 'application_status', 'Müraciət statusu dəyişdi', row.status as string, 'applications');
  }
}, ['status']);

audited('applications');

// jobs_guard_status → public.guard_job_status
const STAFF_JOB_STATUSES = ['approved', 'published', 'rejected', 'changes_requested', 'expired', 'archived'];
before('jobs', 'jobs_guard_status', ['update'], async (env, row, old) => {
  if (await privileged(env)) return;
  if (changed(row, old, 'status') && STAFF_JOB_STATUSES.includes(row.status as string)) {
    throw new DbRuleError('Elanın statusunu yalnız Karyera Mərkəzi dəyişə bilər', '42501');
  }
});

// jobs_workflow_notification → public.notify_core_workflow (jobs), AFTER UPDATE OF status
after('jobs', 'jobs_workflow_notification', ['update'], async (env, row, old) => {
  if (!row || !changed(row, old, 'status')) return;
  const approved = row.status === 'approved' || row.status === 'published';
  const reviewed = row.status === 'rejected' || row.status === 'changes_requested';
  if (!approved && !reviewed) return;
  const company = await one<{ owner_id: string | null }>(env.tx, 'SELECT owner_id FROM companies WHERE id = ?', [row.company_id]);
  if (!company?.owner_id) return;
  if (approved) await notify(env, company.owner_id, 'vacancy_approved', 'Vakansiya təsdiqləndi', row.title as string, 'vacancies');
  else await notify(env, company.owner_id, 'vacancy_review', 'Vakansiyaya admin rəyi var', row.title as string, 'vacancies');
}, ['status']);

audited('jobs');

// companies_workflow_notification → public.notify_core_workflow (companies), AFTER UPDATE OF status
after('companies', 'companies_workflow_notification', ['update'], async (env, row, old) => {
  if (!row || !changed(row, old, 'status') || row.owner_id == null) return;
  await notify(env, row.owner_id, 'company_status', 'Şirkət hesabının statusu dəyişdi', row.status as string, 'company-profile');
}, ['status']);

audited('reports');
audited('mentor_requests');
