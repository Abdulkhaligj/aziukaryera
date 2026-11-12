// Interview requests: create_interview_request (student), respond_interview_request
// (company), cancel_interview_request (student). The notifications come from
// the interview_requests_notify trigger.
import { one } from '../db.ts';
import { DbRuleError } from '../errors.ts';
import { insertRow, nowText, updateRow } from '../write/pipeline.ts';
import { pgTrim } from '../write/rules/core.ts';
import { rpc } from './registry.ts';

const length = (s: unknown) => [...String(s ?? '')].length;

rpc({
  name: 'create_interview_request', args: { p_application_id: 'uuid', p_message: 'text' }, roles: ['authenticated'], security: 'definer', returns: 'value',
  async run(env, a) {
    const me = env.ctx.uid;
    if (!me || a.p_application_id == null) throw new DbRuleError('Giriş və müraciət tələb olunur', '42501');
    if (length(a.p_message) > 1000) throw new DbRuleError('Mesaj 1000 simvoldan çox ola bilməz', 'P0001');
    const target = await one<{ student_id: string; company_id: string }>(env.tx, `SELECT a.student_id, j.company_id
        FROM applications a JOIN jobs j ON j.id = a.job_id JOIN companies c ON c.id = j.company_id JOIN profiles p ON p.id = a.student_id
       WHERE a.id = ? AND a.student_id = ? AND p.role IN ('student', 'graduate') AND p.status = 'active' AND c.status = 'active'`,
      [a.p_application_id, me]);
    if (!target) throw new DbRuleError('Bu müraciət üzrə sorğu göndərməyə icazə yoxdur', '42501');
    const message = pgTrim(a.p_message ?? '');
    const existing = await one<{ id: string; status: string }>(env.tx, 'SELECT id, status FROM interview_requests WHERE application_id = ? FOR UPDATE', [a.p_application_id]);
    if (!existing) {
      return (await insertRow(env, 'interview_requests', { application_id: a.p_application_id, student_id: target.student_id, company_id: target.company_id, message })).id;
    }
    // ON CONFLICT DO UPDATE … WHERE status IN ('cancelled', 'declined')
    if (existing.status !== 'cancelled' && existing.status !== 'declined') throw new DbRuleError('Bu müraciət üçün artıq aktiv müsahibə sorğusu var', 'P0001');
    await updateRow(env, 'interview_requests', { id: existing.id }, {
      status: 'pending', message, reply_note: '', scheduled_slot_id: null, updated_at: nowText(env), created_at: nowText(env)
    });
    return existing.id;
  }
});

rpc({
  name: 'respond_interview_request', args: { p_request_id: 'uuid', p_decision: 'text', p_reply_note: 'text' }, roles: ['authenticated'], security: 'definer', returns: 'value',
  async run(env, a) {
    // `p_decision NOT IN (...)` is NULL for a NULL decision, so only a wrong value is refused here.
    if (!env.ctx.uid || (a.p_decision != null && a.p_decision !== 'accepted' && a.p_decision !== 'declined')) {
      throw new DbRuleError('Etibarsız müsahibə qərarı', '42501');
    }
    if (length(a.p_reply_note) > 1000) throw new DbRuleError('Cavab 1000 simvoldan çox ola bilməz', 'P0001');
    const request = await one<{ id: string }>(env.tx, `SELECT r.id FROM interview_requests r WHERE r.id = ? AND r.status = 'pending'
        AND EXISTS (SELECT 1 FROM companies c JOIN profiles p ON p.id = c.owner_id WHERE c.id = r.company_id AND c.owner_id = ?
          AND c.status = 'active' AND p.status = 'active' AND p.role = 'company') FOR UPDATE`, [a.p_request_id, env.ctx.uid]);
    if (!request) throw new DbRuleError('Sorğu tapılmadı, artıq cavablandırılıb və ya icazəniz yoxdur', '42501');
    await updateRow(env, 'interview_requests', { id: request.id }, { status: a.p_decision, reply_note: pgTrim(a.p_reply_note ?? ''), updated_at: nowText(env) });
    return request.id;
  }
});

rpc({
  name: 'cancel_interview_request', args: { p_request_id: 'uuid' }, roles: ['authenticated'], security: 'definer', returns: 'value',
  async run(env, a) {
    const request = env.ctx.uid ? await one<{ id: string }>(env.tx, `SELECT id FROM interview_requests
       WHERE id = ? AND student_id = ? AND status IN ('pending', 'accepted') FOR UPDATE`, [a.p_request_id, env.ctx.uid]) : null;
    if (!request) throw new DbRuleError('Yalnız aktiv sorğunuzu ləğv edə bilərsiniz', '42501');
    await updateRow(env, 'interview_requests', { id: request.id }, { status: 'cancelled', updated_at: nowText(env) });
    return request.id;
  }
});
