// /rest/v1/rpc — the database functions the portal, the admin panel and the
// Edge Functions call, through supabase-js. Tests run in order; the platform
// reset is last.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { exec, one, rows } from '../src/db.ts';
import { matchScore } from '../src/rpc/profiles.ts';
import { startHarness, type Harness } from './helpers.ts';

let h: Harness;
let student: SupabaseClient, company: SupabaseClient, admin: SupabaseClient, editor: SupabaseClient, service: SupabaseClient;
let studentId: string, companyUser: string, companyId: string, adminId: string;
let jobId: string, applicationId: string, requestId: string;

async function signedIn(email: string, data: Record<string, unknown>) {
  const client = h.anon();
  const { data: res, error } = await client.auth.signUp({ email, password: 'Sifre2026!', options: { data } });
  if (error) throw error;
  return { client, id: res.user!.id };
}

async function staff(email: string, role: string) {
  const created = await h.service().auth.admin.createUser({ email, password: 'Sifre2026!', email_confirm: true,
    user_metadata: { role: 'student', full_name: `Staff ${role}` }, app_metadata: { admin_role: role } });
  if (created.error) throw created.error;
  await exec(h.pool, `UPDATE profiles SET role = 'admin', admin_role = ? WHERE id = ?`, [role, created.data.user!.id]);
  const client = h.anon();
  await client.auth.signInWithPassword({ email, password: 'Sifre2026!' });
  return { client, id: created.data.user!.id };
}

const notes = (profileId: string, kind: string) =>
  rows<{ title: string; body: string }>(h.pool, 'SELECT title, body FROM notifications WHERE profile_id = ? AND kind = ? ORDER BY created_at, id', [profileId, kind]);
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

before(async () => {
  h = await startHarness();
  service = h.service();
  await exec(h.pool, `INSERT INTO faculties (id, name, sort_order) VALUES ('neft', 'Neft-mexanika', 1), ('it', 'İnformasiya texnologiyaları', 2)`);
  await exec(h.pool, `INSERT INTO majors (id, faculty_id, name, field) VALUES ('neft-muh', 'neft', 'Neft mühəndisliyi', 'texnika')`);
  ({ client: student, id: studentId } = await signedIn('leyla@asoiu.edu.az', { role: 'student', full_name: 'Leyla Həsənova' }));
  await exec(h.pool, `UPDATE profiles SET faculty_id = 'neft', major_id = 'neft-muh', skills = JSON_ARRAY('Python', 'AutoCAD') WHERE id = ?`, [studentId]);
  ({ client: company, id: companyUser } = await signedIn('hr@bp.az', { role: 'company', company_name: 'bp Azərbaycan', full_name: 'HR bp' }));
  companyId = (await one<{ id: string }>(h.pool, 'SELECT id FROM companies WHERE owner_id = ?', [companyUser]))!.id;
  ({ client: admin, id: adminId } = await staff('admin3@asoiu.edu.az', 'super_admin'));
  ({ client: editor } = await staff('editor3@asoiu.edu.az', 'editor'));
  assert.equal((await admin.from('companies').update({ status: 'active' }).eq('id', companyId)).error, null);
  const job = await service.from('jobs').insert({ company_id: companyId, title: 'Qazma mühəndisi', type: 'is', status: 'approved',
    deadline: day(30), location: 'Bakı', faculty_ids: ['neft'], major_ids: ['neft-muh'], skills: ['python', 'Excel'] }).select('id').single();
  if (job.error) throw job.error;
  jobId = job.data!.id;
  const applied = await student.from('applications').insert({ job_id: jobId, student_id: studentId }).select('id').single();
  if (applied.error) throw applied.error;
  applicationId = applied.data!.id;
});
after(async () => { await h?.close(); });

test('grants, unknown functions and argument types follow PostgREST', async () => {
  const anon = await h.anon().rpc('career_bootstrap_v1');
  assert.equal(anon.status, 401);
  assert.equal(anon.error?.message, 'permission denied for function career_bootstrap_v1');
  assert.equal((await h.anon().rpc('active_ads', { p_placement: null })).error, null, 'active_ads is granted to anon');
  const missing = await student.rpc('no_such_function');
  assert.equal(missing.status, 404);
  assert.equal(missing.error?.code, 'PGRST202');
  assert.equal((await student.rpc('claim_benefit', { p_nope: 1 })).error?.code, 'PGRST202', 'unknown argument names do not match');
  const serviceOnly = await student.rpc('ai_reserve_request', { p_profile_id: studentId, p_task: 'cv_analyze' });
  assert.equal(serviceOnly.status, 403);
  const badUuid = await student.rpc('claim_benefit', { p_benefit: 'abc' });
  assert.equal(badUuid.error?.code, '22P02');
  assert.equal(badUuid.error?.message, 'invalid input syntax for type uuid: "abc"');
});

test('career_bootstrap_v1 returns the caller\'s data under their policies', async () => {
  const { data, error } = await student.rpc('career_bootstrap_v1');
  assert.equal(error, null);
  assert.equal(data.uid, studentId);
  assert.equal(data.email, 'leyla@asoiu.edu.az');
  assert.equal(data.profile.full_name, 'Leyla Həsənova');
  assert.deepEqual(data.faculties.map((f: { id: string }) => f.id), ['neft', 'it'], 'ordered by sort_order');
  assert.deepEqual(data.jobs.map((j: { id: string }) => j.id), [jobId]);
  assert.deepEqual(data.applications.map((a: { id: string }) => a.id), [applicationId]);
  assert.deepEqual(data.candidates.map((c: { id: string }) => c.id), [studentId], 'only themselves: can_read_profile includes the caller');
  assert.equal(data.subscription, null);
  assert.ok(Array.isArray(data.notifications) && Array.isArray(data.broadcasts) && Array.isArray(data.broadcastReads));

  const forCompany = (await company.rpc('career_bootstrap_v1')).data;
  assert.deepEqual(forCompany.candidates.map((c: { id: string }) => c.id), [studentId], 'an applicant is readable by the company');
  assert.equal(forCompany.subscription.plan_id, 'free');
  assert.equal(forCompany.subscription.plans.name, 'Free');
});

test('ranked_jobs_for and match_score', async () => {
  const { data } = await student.rpc('ranked_jobs_for');
  // faculty 40 + major 40 + 1 of 2 skills (case-insensitive) 10
  assert.deepEqual(data, [{ job_id: jobId, score: 90 }]);
  assert.equal(matchScore([], [], [], null, null, null), 100);
  assert.equal(matchScore(['a'], ['m'], ['x'], 'a', 'other', []), 55, 'same faculty, other major: 40 + 15 + 0');
  assert.equal(matchScore(['a'], [], ['x', 'y', 'z', 'w', 'v', 'u', 't', 's'], 'b', null, ['x']), 43, 'round(20 * 1/8) = 3');
  assert.equal(matchScore(['a'], ['m'], null, null, null, null), 100, 'least(100, NULL) is 100');
});

test('profile cards and photos: submit, moderate, read, remove', async () => {
  const path = `${studentId}/${'a'.repeat(32)}.webp`;
  const wrong = await student.rpc('avatar_submit', { p_path: 'other/x.webp' });
  assert.equal(wrong.error?.message, 'Yanlış fayl yolu');
  const noFile = await student.rpc('avatar_submit', { p_path: path });
  assert.equal(noFile.error?.message, 'Şəkil faylı tapılmadı. Yenidən yükləyin.');
  assert.equal(noFile.status, 500, 'no_data_found is a PL/pgSQL error code in PostgREST');
  await exec(h.pool, `INSERT INTO storage_objects (bucket_id, name, owner_id) VALUES ('avatars', ?, ?)`, [path, studentId]);
  const submitted = await student.rpc('avatar_submit', { p_path: path });
  assert.deepEqual(submitted.data, { status: 'pending', replaced: null });
  const pending = await one<{ avatar_pending_path: string; avatar_submit_count: number }>(h.pool,
    'SELECT avatar_pending_path, avatar_submit_count FROM profiles WHERE id = ?', [studentId]);
  assert.deepEqual(pending, { avatar_pending_path: path, avatar_submit_count: 1 }, 'SECURITY DEFINER passes the avatar guard');

  const claim = await service.rpc('moderation_claim', { p_table: 'profiles', p_id: studentId });
  assert.equal(claim.data.claimed, true);
  assert.equal(claim.data.row.avatar_pending_path, path);
  assert.equal((await service.rpc('moderation_claim', { p_table: 'profiles', p_id: studentId })).data.claimed, false, 'leased');
  const verdict = await service.rpc('moderation_finish', { p_claim_id: claim.data.claim_id, p_allow: true, p_reason: null, p_categories: [], p_content_version: null });
  assert.deepEqual(verdict.data, { status: 'visible', previous_path: null });

  assert.deepEqual((await student.rpc('profile_avatar_paths', { p_ids: [studentId] })).data, [{ id: studentId, avatar_path: path }]);
  assert.deepEqual((await company.rpc('profile_avatar_paths', { p_ids: [studentId] })).data, [{ id: studentId, avatar_path: path }], 'the applicant is a candidate');
  assert.deepEqual((await company.rpc('profile_cards', { p_ids: [studentId] })).data, [], 'cards need a visible post or comment');
  assert.deepEqual((await student.rpc('profile_cards', { p_ids: [studentId] })).data,
    [{ id: studentId, full_name: 'Leyla Həsənova', role: 'student', faculty_id: 'neft', major_id: 'neft-muh', avatar_path: path }]);
  assert.deepEqual((await student.rpc('avatar_remove')).data, { files: [path] });
});

test('posts: the moderation verdict hides the post and tells the author', async () => {
  const post = await student.from('posts').insert({ author_id: studentId, body: 'Pulsuz kurs, linkə keçin' }).select('id').single();
  const claim = await service.rpc('moderation_claim', { p_table: 'posts', p_id: post.data!.id });
  assert.equal(claim.data.row.content_version, 2);
  const old = await service.rpc('moderation_finish', { p_claim_id: claim.data.claim_id, p_allow: true, p_reason: null, p_categories: [], p_content_version: 1 });
  assert.deepEqual(old.data, { status: 'retry', code: 'content_version_required' });
  const again = await service.rpc('moderation_claim', { p_table: 'posts', p_id: post.data!.id });
  assert.equal(again.data.claimed, true, 'a released lease can be claimed again');
  const hidden = await service.rpc('moderation_finish', { p_claim_id: again.data.claim_id, p_allow: false, p_reason: ' Spam ', p_categories: ['spam'], p_content_version: 2 });
  assert.deepEqual(hidden.data, { status: 'hidden' });
  assert.equal((await one<{ moderation_status: string }>(h.pool, 'SELECT moderation_status FROM posts WHERE id = ?', [post.data!.id]))!.moderation_status, 'hidden');
  assert.deepEqual(await notes(studentId, 'content_hidden'),
    [{ title: 'Paylaşımınız dərc olunmadı', body: 'Spam Səhv olduğunu düşünürsünüzsə, Karyera Mərkəzinə yazın.' }]);
  assert.equal((await one<{ reason: string }>(h.pool, `SELECT reason FROM moderation_logs WHERE target_id = ?`, [post.data!.id]))!.reason, 'AI: Spam [spam]');
  assert.deepEqual((await service.rpc('moderation_claim', { p_table: 'posts', p_id: post.data!.id })).data, { claimed: false });
});

test('interview requests: create, duplicate, accept, cancel, reopen', async () => {
  const created = await student.rpc('create_interview_request', { p_application_id: applicationId, p_message: '  Görüşmək istərdim  ' });
  assert.equal(created.error, null);
  requestId = created.data;
  assert.equal((await one<{ message: string }>(h.pool, 'SELECT message FROM interview_requests WHERE id = ?', [requestId]))!.message, 'Görüşmək istərdim');
  assert.deepEqual(await notes(companyUser, 'interview_request'), [{ title: 'Yeni müsahibə sorğusu', body: 'Qazma mühəndisi üzrə namizəd müsahibə istəyir.' }]);
  const duplicate = await student.rpc('create_interview_request', { p_application_id: applicationId, p_message: '' });
  assert.equal(duplicate.error?.message, 'Bu müraciət üçün artıq aktiv müsahibə sorğusu var');

  assert.equal((await student.rpc('respond_interview_request', { p_request_id: requestId, p_decision: 'accepted', p_reply_note: '' })).error?.code, '42501',
    'only the company answers');
  assert.equal((await company.rpc('respond_interview_request', { p_request_id: requestId, p_decision: 'maybe', p_reply_note: '' })).error?.message, 'Etibarsız müsahibə qərarı');
  assert.equal((await company.rpc('respond_interview_request', { p_request_id: requestId, p_decision: 'accepted', p_reply_note: 'Bazar ertəsi' })).data, requestId);
  assert.equal((await notes(studentId, 'interview_request'))[0].title, 'Müsahibə sorğunuz qəbul edildi');

  assert.equal((await student.rpc('cancel_interview_request', { p_request_id: requestId })).data, requestId);
  assert.equal((await notes(companyUser, 'interview_request')).at(-1)!.title, 'Müsahibə sorğusu ləğv olundu');
  assert.equal((await student.rpc('cancel_interview_request', { p_request_id: requestId })).error?.message, 'Yalnız aktiv sorğunuzu ləğv edə bilərsiniz');
  assert.equal((await student.rpc('create_interview_request', { p_application_id: applicationId, p_message: 'Yenidən' })).data, requestId, 'reopened');
  assert.equal((await one<{ status: string }>(h.pool, 'SELECT status FROM interview_requests WHERE id = ?', [requestId]))!.status, 'pending');
});

test('select_company_plan requests an invoice, and Free cancels it', async () => {
  const pro = await company.rpc('select_company_plan', { p_plan_id: 'pro' });
  assert.equal(pro.error, null);
  assert.equal(pro.data.requested_plan_id, 'pro');
  assert.equal(pro.data.plan_id, 'free', 'the paid plan starts when the invoice is paid');
  assert.match(pro.data.invoice.invoice_number, /^KM-\d{4}-00001$/);
  assert.equal(Number((await one<{ n: number }>(h.pool, `SELECT COUNT(*) AS n FROM payments WHERE company_id = ?`, [companyId]))!.n), 1, 'one invoice, not two');
  const free = await company.rpc('select_company_plan', { p_plan_id: 'free' });
  assert.equal(free.data.requested_plan_id, null);
  assert.equal(free.data.invoice, null);
  const invoice = await one<{ status: string; metadata: { cancelled_reason: string } }>(h.pool, 'SELECT status, metadata FROM payments WHERE company_id = ?', [companyId]);
  assert.equal(invoice!.status, 'cancelled');
  assert.equal(invoice!.metadata.cancelled_reason, 'company_selected_free');
  assert.equal((await student.rpc('select_company_plan', { p_plan_id: 'pro' })).error?.message, 'Şirkət hesabı tapılmadı');
});

test('benefits: claim once, redeem once, only by the partner or staff', async () => {
  const partner = await admin.from('benefit_partners').insert({ name: 'Kitab Evi', owner_id: companyUser }).select('id').single();
  assert.equal(partner.error, null);
  const benefit = await admin.from('benefits').insert({ partner_id: partner.data!.id, title: '20% endirim', active: true }).select('id').single();
  const claim = await student.rpc('claim_benefit', { p_benefit: benefit.data!.id });
  assert.match(claim.data.code, /^ASOIU-[0-9A-F]{10}$/);
  assert.equal((await student.rpc('claim_benefit', { p_benefit: benefit.data!.id })).data.code, claim.data.code, 'the open claim is reused');

  assert.equal((await student.rpc('redeem_benefit_code', { p_code: claim.data.code })).status, 403);
  const ok = await company.rpc('redeem_benefit_code', { p_code: ` ${claim.data.code.toLowerCase()} ` });
  assert.equal(ok.data[0].status, 'tesdiqlendi');
  assert.deepEqual({ ...ok.data[0], redeemed_at: undefined }, { status: 'tesdiqlendi', student_name: 'Leyla Həsənova', faculty: 'Neft-mexanika',
    benefit: '20% endirim', partner: 'Kitab Evi', redeemed_at: undefined });
  assert.equal((await admin.rpc('redeem_benefit_code', { p_code: claim.data.code })).data[0].status, 'istifade_olunub');
  assert.equal((await admin.rpc('redeem_benefit_code', { p_code: 'ASOIU-0000000000' })).data[0].status, 'tapilmadi');
});

test('ads: active_ads by placement and Baku date; ad_track counts views', async () => {
  const ad = await admin.from('ads').insert({ title: 'Karyera sərgisi', advertiser: 'ASOIU', placement: 'dashboard', status: 'active',
    starts_on: day(-1), ends_on: day(1) }).select('id').single();
  assert.equal(ad.error, null);
  const listed = await h.anon().rpc('active_ads', { p_placement: 'dashboard' });
  assert.deepEqual(listed.data.map((a: { id: string }) => a.id), [ad.data!.id]);
  assert.deepEqual((await h.anon().rpc('active_ads', { p_placement: 'landing_hero' })).data, []);
  const tracked = await h.anon().rpc('ad_track', { p_id: ad.data!.id, p_kind: 'view' });
  assert.equal(tracked.status, 204);
  assert.equal((await one<{ impressions: number }>(h.pool, 'SELECT impressions FROM ads WHERE id = ?', [ad.data!.id]))!.impressions, 1);
});

test('AI budgets and the candidate pack (service key)', async () => {
  const reserved = await service.rpc('ai_reserve_request', { p_profile_id: studentId, p_task: 'cv_analyze' });
  assert.equal(reserved.data.allowed, true);
  assert.equal(reserved.data.limit, 25);
  assert.equal(reserved.data.used, 1);
  assert.equal((await service.rpc('ai_consume_provider_attempt', { p_reservation_id: reserved.data.reservation_id })).data, true);
  const anonymous = await service.rpc('ai_reserve_request', { p_profile_id: null, p_task: 'aida_chat', p_client_hash: 'nope' });
  assert.equal(anonymous.error?.message, 'Invalid anonymous client');
  const ranking = await service.rpc('ai_request_context', { p_profile_id: companyUser, p_task: 'candidate_rank', p_job_id: jobId });
  assert.deepEqual(ranking.data, { allowed: false, reason: 'plan_required', company_id: companyId, plan_id: 'free' });
  const pack = await service.rpc('ai_candidate_pack', { p_job_id: jobId, p_limit: 10, p_offset: 0 });
  assert.equal(pack.data.total, 1);
  assert.deepEqual(pack.data.job.faculties, ['Neft-mexanika']);
  assert.equal(pack.data.candidates[0].student_id, studentId);
  assert.equal(pack.data.candidates[0].deterministic_score, 90);
  assert.equal(pack.data.candidates[0].faculty, 'Neft-mexanika');
});

test('RPC: GET for read-only functions, and select/filter/order on set results', async () => {
  const viaGet = await company.rpc('candidate_profiles', undefined, { get: true });
  assert.equal(viaGet.error, null);
  assert.deepEqual(viaGet.data.map((c: { id: string }) => c.id), [studentId]);
  const shaped = await company.rpc('candidate_profiles').eq('faculty_id', 'neft').select('id,full_name').order('full_name');
  assert.deepEqual(shaped.data, [{ id: studentId, full_name: 'Leyla Həsənova' }]);
  assert.deepEqual((await company.rpc('candidate_profiles').eq('faculty_id', 'it')).data, []);
  const counted = await company.rpc('candidate_profiles', undefined, { count: 'exact' }).limit(1);
  assert.equal(counted.count, 1);
  const volatile = await student.rpc('select_company_plan', { p_plan_id: 'pro' }, { get: true });
  assert.equal(volatile.status, 405, 'functions that write cannot be called with GET');
});

test('admin_reset_platform_data empties the platform but keeps the admins', async () => {
  assert.equal((await admin.rpc('admin_reset_platform_data', { p_confirmation: 'yox' })).error?.message, 'Sıfırlama təsdiqi yanlışdır');
  assert.equal((await editor.rpc('admin_reset_platform_data', { p_confirmation: 'SIFIRLA' })).error?.message,
    'Bu əməliyyatı yalnız aktiv Super Admin icra edə bilər');
  const reset = await admin.rpc('admin_reset_platform_data', { p_confirmation: 'SIFIRLA' });
  assert.equal(reset.error, null);
  assert.deepEqual(reset.data, { ok: true, removed_users: 2, kept_admins: 2 });
  for (const table of ['jobs', 'applications', 'companies', 'posts', 'interview_requests', 'benefits', 'ads']) {
    const left = table === 'ads' ? 1 : 0; // ads are not part of the reset
    assert.equal(Number((await one<{ n: number }>(h.pool, `SELECT COUNT(*) AS n FROM ${table}`))!.n), left, table);
  }
  assert.equal(Number((await one<{ n: number }>(h.pool, 'SELECT COUNT(*) AS n FROM auth_users'))!.n), 2);
  const audit = await rows<{ title: string }>(h.pool, 'SELECT title FROM admin_audit_logs ORDER BY created_at, title');
  assert.ok(audit.some(r => r.title === 'Database delete: profiles'), 'cascaded profile deletes are audited, as in Postgres');
  assert.equal(audit.at(-1)!.title, 'Platforma məlumatları sıfırlandı');
});
