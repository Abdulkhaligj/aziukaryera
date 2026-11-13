// Security audit of 2026-11-13 (audit v2): the behaviour each fix promises.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import mysql from 'mysql2/promise';
import type { ApiClient } from './helpers.ts';
import { exec, one, rows } from '../src/db.ts';
import { runJob } from '../src/jobs/scheduler.ts';
import { loadSchema } from '../src/schema.ts';
import { startHarness, type Harness } from './helpers.ts';

let h: Harness;
let student: ApiClient, company: ApiClient, admin: ApiClient, editor: ApiClient, manager: ApiClient;
let studentId: string, companyUser: string, companyId: string;
const openJob = '55555555-5555-4555-8555-555555555555';

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
  return client;
}

const raw = (path: string, init: RequestInit & { token?: string } = {}) => fetch(`${h.url}${path}`, {
  ...init, headers: { apikey: h.config.anonKey, ...(init.token ? { authorization: `Bearer ${init.token}` } : {}), ...(init.headers as Record<string, string> ?? {}) }
});
const tokenOf = async (client: ApiClient) => (await client.auth.getSession()).data.session!.access_token;

before(async () => {
  h = await startHarness();
  ({ client: student, id: studentId } = await signedIn('audit.telebe@asoiu.edu.az', { role: 'student', full_name: 'Aynur Həsənli' }));
  ({ client: company, id: companyUser } = await signedIn('hr@audit.az', { role: 'company', company_name: 'Audit MMC', full_name: 'HR Audit' }));
  companyId = (await one<{ id: string }>(h.pool, 'SELECT id FROM companies WHERE owner_id = ?', [companyUser]))!.id;
  await exec(h.pool, `UPDATE companies SET status = 'active', email = 'hr@audit.az', phone = '+994501112233' WHERE id = ?`, [companyId]);
  await exec(h.pool, `UPDATE profiles SET status = 'active' WHERE id = ?`, [companyUser]);
  const later = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const jobs = await h.service().from('jobs').insert([{ id: openJob, company_id: companyId, title: 'Analitik', type: 'is', status: 'approved', deadline: later, location: 'Bakı' }]);
  if (jobs.error) throw jobs.error;
  admin = await staff('audit.admin@asoiu.edu.az', 'super_admin');
  editor = await staff('audit.editor@asoiu.edu.az', 'editor');
  manager = await staff('audit.manager@asoiu.edu.az', 'manager');
});
after(async () => { await h?.close(); });

test('#33: an update or delete without a filter is refused', async () => {
  const update = await raw('/rest/v1/notifications', { method: 'PATCH', token: await tokenOf(student),
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'x' }) });
  assert.equal(update.status, 400);
  assert.deepEqual(await update.json(), { code: '21000', details: null, hint: null, message: 'UPDATE requires a WHERE clause' });
  const remove = await raw('/rest/v1/notifications', { method: 'DELETE', token: await tokenOf(student) });
  assert.equal(remove.status, 400);
  assert.equal((await remove.json()).message, 'DELETE requires a WHERE clause');
});

test('#45: reads are bounded in rows, offset and embedding depth', async () => {
  const far = await raw('/rest/v1/jobs?select=id&offset=100001');
  assert.equal(far.status, 400);
  const deep = await raw('/rest/v1/jobs?select=id,companies(id,jobs(id,companies(id,jobs(id))))');
  assert.equal(deep.status, 400);
  assert.match((await deep.json()).message, /limited to 3 levels/);
  const ok = await raw('/rest/v1/jobs?select=id,companies(id,jobs(id))&limit=5000');
  assert.equal(ok.status, 200, 'a large limit is lowered to 1000, not refused');
});

test('#62: visitors without an account do not read company contacts, nor filter by them', async () => {
  const { data } = await h.anon().from('companies').select('id,name,email,phone,owner_id').eq('id', companyId);
  assert.deepEqual(data, [{ id: companyId, name: 'Audit MMC', email: null, phone: null, owner_id: null }]);
  const probe = await h.anon().from('companies').select('id').eq('email', 'hr@audit.az');
  assert.deepEqual(probe.data, [], 'a hidden column cannot be probed with a filter');
  const embedded = await h.anon().from('jobs').select('id,companies(email)').eq('id', openJob);
  assert.deepEqual(embedded.data, [{ id: openJob, companies: { email: null } }]);
  const signed = await student.from('companies').select('email').eq('id', companyId);
  assert.deepEqual(signed.data, [{ email: 'hr@audit.az' }], 'students still see the contact details');
});

test('#61: database errors do not repeat MySQL texts', async () => {
  const bad = await student.from('profiles').update({ gpa: 'çox yaxşı' }).eq('id', studentId);
  assert.ok(bad.error);
  assert.doesNotMatch(bad.error!.message + JSON.stringify(bad.error!.details ?? ''), /Incorrect|at row|Data truncated|for column '/);
});

test('#60: only the platform sites may call the API from a browser', async () => {
  const evil = await raw('/rest/v1/jobs?select=id', { headers: { origin: 'https://evil.example' } });
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
  const site = await raw('/rest/v1/jobs?select=id', { headers: { origin: 'https://asoiu-career.vercel.app' } });
  assert.equal(site.headers.get('access-control-allow-origin'), 'https://asoiu-career.vercel.app');
  const panel = await raw('/rest/v1/jobs?select=id', { headers: { origin: 'https://asoiu-career-admin.vercel.app' } });
  assert.equal(panel.headers.get('access-control-allow-origin'), 'https://asoiu-career-admin.vercel.app');
});

test('#29: among the staff only super admins and managers read billing', async () => {
  assert.equal((await company.rpc('select_company_plan', { p_plan_id: 'pro' })).error, null);
  assert.equal((await editor.from('payments').select('id')).data?.length, 0);
  assert.equal((await editor.from('subscriptions').select('id')).data?.length, 0);
  assert.equal((await manager.from('payments').select('id')).data?.length, 1);
  assert.equal((await admin.from('subscriptions').select('id')).data?.length, 1);
  assert.equal((await company.from('payments').select('id')).data?.length, 1, 'the company sees its own invoice');
});

test('#42: at most three new invoices a day per company', async () => {
  // The invoice of the previous test is the first; asking for the same plan again reuses it.
  assert.equal((await company.rpc('select_company_plan', { p_plan_id: 'pro' })).error, null);
  for (let i = 0; i < 2; i++) {
    assert.equal((await company.rpc('select_company_plan', { p_plan_id: 'free' })).error, null);
    assert.equal((await company.rpc('select_company_plan', { p_plan_id: 'pro' })).error, null);
  }
  assert.equal((await company.rpc('select_company_plan', { p_plan_id: 'free' })).error, null);
  assert.equal((await company.rpc('select_company_plan', { p_plan_id: 'pro' })).error?.message,
    'Bir gündə ən çox 3 paket sorğusu göndərmək olar. Sabah yenidən cəhd edin.');
});

test('H-11: ad views count once per visitor and ad', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const ad = await h.service().from('ads').insert({ title: 'Reklam', advertiser: 'Audit MMC', placement: 'landing_strip', status: 'active',
    starts_on: today, ends_on: new Date(Date.now() + 86_400_000 * 5).toISOString().slice(0, 10) }).select('id').single();
  assert.equal(ad.error, null);
  for (let i = 0; i < 5; i++) assert.equal((await h.anon().rpc('ad_track', { p_id: ad.data!.id, p_kind: 'view' })).error, null);
  const counted = await one<{ impressions: number }>(h.pool, 'SELECT impressions FROM ads WHERE id = ?', [ad.data!.id]);
  assert.equal(counted!.impressions, 1);
  const logs = await one<{ n: number }>(h.pool, `SELECT COUNT(*) AS n FROM admin_audit_logs WHERE resource = 'ads' AND action = 'db_update'`);
  assert.equal(logs!.n, 0, 'a view is a counter, not an audited edit');
});

test('#38, #50: the candidate search skips private profiles and is recorded', async () => {
  await exec(h.pool, `INSERT INTO plan_features (plan_id, feature_key, label, enabled, limit_value) VALUES ('free', 'candidate_search', 'Namizəd axtarışı', 1, NULL)
    ON DUPLICATE KEY UPDATE enabled = 1`);
  const hidden = await signedIn('gizli@asoiu.edu.az', { role: 'student', full_name: 'Gizli Tələbə' });
  await exec(h.pool, `UPDATE profiles SET profile_visibility = 'private' WHERE id = ?`, [hidden.id]);
  await exec(h.pool, `UPDATE subscriptions SET plan_id = 'free', requested_plan_id = NULL WHERE company_id = ?`, [companyId]);
  const { data, error } = await company.rpc('candidate_profiles');
  assert.equal(error, null);
  const ids = (data as { id: string }[]).map(r => r.id);
  assert.ok(ids.includes(studentId));
  assert.ok(!ids.includes(hidden.id), 'a private profile is not in the search');
  const log = await one<{ results: number }>(h.pool, 'SELECT results FROM private_candidate_search_log WHERE profile_id = ? ORDER BY id DESC LIMIT 1', [companyUser]);
  assert.equal(log!.results, ids.length);
});

test('H-06: a company that is not active is hidden and cannot change its vacancies', async () => {
  await exec(h.pool, `UPDATE companies SET status = 'pending' WHERE id = ?`, [companyId]);
  try {
    assert.deepEqual((await h.anon().from('jobs').select('id').eq('id', openJob)).data, []);
    assert.deepEqual((await student.from('jobs').select('id').eq('id', openJob)).data, []);
    assert.equal((await company.from('jobs').select('id').eq('id', openJob)).data?.length, 1, 'the owner still reads it');
    const changed = await company.from('jobs').update({ location: 'Sumqayıt' }).eq('id', openJob).select('id');
    assert.deepEqual(changed.data, [], 'and changes nothing');
  } finally {
    await exec(h.pool, `UPDATE companies SET status = 'active' WHERE id = ?`, [companyId]);
  }
});

test('#54: deleting the owner keeps the company, without an owner and pending', async () => {
  const { id } = await signedIn('hr2@audit.az', { role: 'company', company_name: 'İkinci MMC', full_name: 'HR İkinci' });
  const second = (await one<{ id: string }>(h.pool, 'SELECT id FROM companies WHERE owner_id = ?', [id]))!.id;
  await exec(h.pool, `UPDATE companies SET status = 'active' WHERE id = ?`, [second]);
  assert.equal((await h.service().auth.admin.deleteUser(id)).error, null);
  assert.deepEqual(await one(h.pool, 'SELECT owner_id, status FROM companies WHERE id = ?', [second]), { owner_id: null, status: 'pending' });
});

test('#52: the AI consent time is set by the server', async () => {
  assert.equal((await student.from('profiles').update({ ai_consent_at: '2001-01-01T00:00:00Z' }).eq('id', studentId)).error, null);
  const at = (await one<{ ai_consent_at: string }>(h.pool, 'SELECT ai_consent_at FROM profiles WHERE id = ?', [studentId]))!.ai_consent_at;
  assert.ok(new Date(at).getTime() > Date.now() - 60_000);
  const ctx = await h.service().rpc('ai_request_context', { p_profile_id: studentId, p_task: 'cv_analyze', p_job_id: null });
  assert.equal(ctx.data.ai_consent, true);
});

test('#66: ranking candidates is for the owner and company admins, not viewers', async () => {
  const viewer = await signedIn('baxan@audit.az', { role: 'company', company_name: 'Baxan', full_name: 'Baxan İşçi' });
  await exec(h.pool, `UPDATE profiles SET status = 'active' WHERE id = ?`, [viewer.id]);
  await exec(h.pool, `INSERT INTO company_members (company_id, profile_id, member_role, status) VALUES (?, ?, 'viewer', 'active')`, [companyId, viewer.id]);
  const ctx = await h.service().rpc('ai_request_context', { p_profile_id: viewer.id, p_task: 'candidate_rank', p_job_id: openJob });
  assert.deepEqual(ctx.data, { allowed: false, reason: 'not_member' });
});

test('#40: a declined interview request waits 30 days', async () => {
  const app = await student.from('applications').insert({ job_id: openJob, student_id: studentId }).select('id').single();
  assert.equal(app.error, null);
  const created = await student.rpc('create_interview_request', { p_application_id: app.data!.id, p_message: 'Salam' });
  assert.equal(created.error, null);
  assert.equal((await company.rpc('respond_interview_request', { p_request_id: created.data, p_decision: 'declined', p_reply_note: '' })).error, null);
  assert.equal((await student.rpc('create_interview_request', { p_application_id: app.data!.id, p_message: 'Yenə' })).error?.message,
    'Şirkət sorğunu rədd edib; yeni sorğunu 30 gündən sonra göndərə bilərsiniz');
});

test('#43, #71: expired vacancies close; old sessions, links and reservations are removed', async () => {
  const schema = await loadSchema(h.pool);
  await exec(h.pool, `UPDATE jobs SET deadline = '2020-01-01' WHERE id = ?`, [openJob]);
  const expired = await runJob(h.pool, schema, 'job-deadlines') as { expired: number };
  assert.equal(expired.expired, 1);
  assert.equal((await one<{ status: string }>(h.pool, 'SELECT status FROM jobs WHERE id = ?', [openJob]))!.status, 'expired');

  await exec(h.pool, `UPDATE auth_sessions SET revoked_at = '2020-01-01', refreshed_at = '2020-01-01' WHERE user_id = ?`, [studentId]);
  await exec(h.pool, `INSERT INTO private_ai_reservations (task, budget, created_at) VALUES ('aida_chat', 'old', '2020-01-01')`);
  const result = await runJob(h.pool, schema, 'data-retention') as { removed: Record<string, number> };
  assert.ok(result.removed.auth_sessions >= 1);
  assert.equal(result.removed.private_ai_reservations, 1);
  assert.equal((await one<{ n: number }>(h.pool, 'SELECT COUNT(*) AS n FROM auth_sessions WHERE user_id = ?', [studentId]))!.n, 0);
});

test('#32: a temporary password is replaced at the next change', async () => {
  const created = await h.service().auth.admin.createUser({ email: 'muveqqeti@asoiu.edu.az', password: 'Muveqqeti2026!', email_confirm: true,
    user_metadata: { role: 'student', full_name: 'Müvəqqəti' }, app_metadata: { must_change_password: true } });
  assert.equal(created.error, null);
  const client = h.anon();
  await client.auth.signInWithPassword({ email: 'muveqqeti@asoiu.edu.az', password: 'Muveqqeti2026!' });
  const changed = await client.auth.updateUser({ password: 'Oz2026Sifrem!', current_password: 'Muveqqeti2026!' } as { password: string });
  assert.equal(changed.error, null);
  const meta = await one<{ m: { must_change_password: boolean } }>(h.pool, 'SELECT raw_app_meta_data AS m FROM auth_users WHERE id = ?', [created.data.user!.id]);
  assert.equal(meta!.m.must_change_password, false);
});

test('#72: the audit migrations can run again', async () => {
  const connection = await mysql.createConnection({ uri: process.env.MYSQL_TEST_URL || 'mysql://root@127.0.0.1:3307', multipleStatements: true });
  try {
    const [[{ db }]] = await h.pool.query('SELECT DATABASE() AS db') as unknown as [[{ db: string }]];
    await connection.query(`USE \`${db}\``);
    for (const file of ['0005_storage_and_functions.sql', '0006_email_change.sql', '0007_security_audit.sql']) {
      await connection.query(readFileSync(new URL(`../db/migrations/${file}`, import.meta.url), 'utf8'));
    }
    const fk = await rows<{ rule: string }>(h.pool, `SELECT delete_rule AS rule FROM information_schema.referential_constraints
      WHERE constraint_schema = DATABASE() AND constraint_name = 'companies_owner_id_fkey'`);
    assert.deepEqual(fk, [{ rule: 'SET NULL' }]);
    const check = await rows(h.pool, `SELECT constraint_name FROM information_schema.check_constraints
      WHERE constraint_schema = DATABASE() AND constraint_name = 'moderation_webhook_config_endpoint_check'`);
    assert.equal(check.length, 1);
  } finally {
    await connection.end();
  }
});
