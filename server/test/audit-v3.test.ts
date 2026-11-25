// Security audit of 2026-11-16 (audit v3): the behaviour each fix promises (I4).
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exec, one, createPool } from '../src/db.ts';
import { canonical } from '../src/values.ts';
import type { Column } from '../src/schema.ts';
import { loadConfig } from '../src/config.ts';
import { clientKey } from '../src/auth/rate-limit.ts';
import { parseCron, parseField } from '../src/jobs/scheduler.ts';
import { FileStore } from '../src/storage/files.ts';
import { meetingUrlAllowed } from '../src/write/rules/interviews.ts';
import { linkSession, startHarness, type ApiClient, type Harness } from './helpers.ts';

let h: Harness;
let student: ApiClient, company: ApiClient;
let studentId: string, companyUser: string, companyId: string;
const openJob = '66666666-6666-4666-8666-666666666666';

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
}
const raw = (path: string, init: RequestInit & { token?: string; key?: string } = {}) => fetch(`${h.url}${path}`, {
  ...init, headers: { apikey: init.key ?? h.config.anonKey, ...(init.token ? { authorization: `Bearer ${init.token}` } : {}), ...(init.headers as Record<string, string> ?? {}) }
});
const tokenOf = async (client: ApiClient) => (await client.auth.getSession()).data.session!.access_token;

// An email link opens a page with one button; pressing it posts the form.
async function openLink(link: string) {
  const html = await (await fetch(link)).text();
  const unescape = (v: string) => v.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  const fields = Object.fromEntries([...html.matchAll(/name="(\w+)" value="([^"]*)"/g)].map(m => [m[1], unescape(m[2])]));
  return fetch(`${h.url}/auth/v1/verify`, { method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields) });
}

before(async () => {
  h = await startHarness();
  ({ client: student, id: studentId } = await signedIn('v3.telebe@asoiu.edu.az', { role: 'student', full_name: 'Nigar Əliyeva' }));
  ({ client: company, id: companyUser } = await signedIn('hr@v3audit.az', { role: 'company', company_name: 'V3 Audit MMC', full_name: 'HR V3' }));
  companyId = (await one<{ id: string }>(h.pool, 'SELECT id FROM companies WHERE owner_id = ?', [companyUser]))!.id;
  await exec(h.pool, `UPDATE companies SET status = 'active' WHERE id = ?`, [companyId]);
  await exec(h.pool, `UPDATE profiles SET status = 'active' WHERE id = ?`, [companyUser]);
  const later = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const jobs = await h.service().from('jobs').insert([{ id: openJob, company_id: companyId, title: 'Mühəndis', type: 'is', status: 'approved', deadline: later, location: 'Bakı' }]);
  if (jobs.error) throw jobs.error;
});
after(async () => { await h?.close(); });

test('C1/H1/M18/L1: an enum or IN-list column takes only its exact values', async () => {
  const column = { name: 'status', enumValues: ['approved', 'pending'] } as unknown as Column;
  assert.equal(canonical(column, 'approved'), 'approved');
  for (const value of [1, 'approved ', 'APPROVED', 'ａｐｐｒｏｖｅｄ', ['approved'], true]) {
    assert.throws(() => canonical(column, value), (error: { sqlState?: string }) => error.sqlState === '22P02', `refused: ${JSON.stringify(value)}`);
  }
  // Through the API as well, even with the server's own key.
  for (const status of ['approved ', 'APPROVED', 'ａｐｐｒｏｖｅｄ']) {
    const { error } = await h.service().from('jobs').update({ status }).eq('id', openJob);
    assert.equal(error?.code, '22P02', status);
  }
  assert.equal((await one<{ status: string }>(h.pool, 'SELECT status FROM jobs WHERE id = ?', [openJob]))!.status, 'approved');
});

test('H4: promotions at the same time never pass five active admins', async () => {
  await staff('v3.admin@asoiu.edu.az', 'super_admin');
  await staff('v3.editor@asoiu.edu.az', 'editor');
  await staff('v3.manager@asoiu.edu.az', 'manager');
  const ids: string[] = [];
  for (let i = 0; i < 4; i++) {
    const created = await h.service().auth.admin.createUser({ email: `v3.namized${i}@asoiu.edu.az`, password: 'Sifre2026!', email_confirm: true,
      user_metadata: { role: 'student', full_name: `Namizəd ${i}` } });
    ids.push(created.data.user!.id);
  }
  const results = await Promise.all(ids.map(id => h.service().from('profiles').update({ role: 'admin', admin_role: 'editor' }).eq('id', id).select('id')));
  const promoted = results.filter(r => !r.error && r.data?.length).length;
  const active = await one<{ n: number }>(h.pool, `SELECT COUNT(*) AS n FROM profiles WHERE role = 'admin' AND status = 'active'`);
  assert.equal(Number(active!.n), 5, 'never more than five');
  assert.equal(promoted, 2, 'two seats were free');
});

test('H3: two claims of one benefit at the same time give one code', async () => {
  const partner = await h.service().from('benefit_partners').insert({ name: 'Kitab Evi', status: 'active' }).select('id').single();
  const benefit = await h.service().from('benefits').insert({ partner_id: partner.data!.id, title: '10% endirim', active: true }).select('id').single();
  assert.equal(benefit.error, null);
  const [a, b] = await Promise.all([student.rpc('claim_benefit', { p_benefit: benefit.data!.id }), student.rpc('claim_benefit', { p_benefit: benefit.data!.id })]);
  assert.equal(a.error, null);
  assert.equal(b.error, null);
  assert.equal(a.data.code, b.data.code, 'the second claim returns the first code');
  const count = await one<{ n: number }>(h.pool, 'SELECT COUNT(*) AS n FROM benefit_claims WHERE benefit_id = ? AND profile_id = ?', [benefit.data!.id, studentId]);
  assert.equal(Number(count!.n), 1);
});

test('L4: an approved partner or benefit goes back to review when what students see changes', async () => {
  const partner = await h.service().from('benefit_partners').insert({ name: 'Qəhvə Evi', status: 'active', owner_id: companyUser }).select('id').single();
  const benefit = await h.service().from('benefits').insert({ partner_id: partner.data!.id, title: 'Pulsuz çay', active: true }).select('id').single();
  await company.from('benefit_partners').update({ about: 'Yeni mətn' }).eq('id', partner.data!.id);
  assert.equal((await one<{ status: string }>(h.pool, 'SELECT status FROM benefit_partners WHERE id = ?', [partner.data!.id]))!.status, 'pending');
  await exec(h.pool, `UPDATE benefit_partners SET status = 'active' WHERE id = ?`, [partner.data!.id]);
  await company.from('benefits').update({ title: '50% endirim' }).eq('id', benefit.data!.id);
  assert.equal((await one<{ active: boolean }>(h.pool, 'SELECT active FROM benefits WHERE id = ?', [benefit.data!.id]))!.active, false);
});

test('L3: a company does not write the review fields or the creation time of its vacancy', async () => {
  const future = new Date(Date.now() + 365 * 86_400_000).toISOString();
  const later = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
  const created = await company.from('jobs').insert({ company_id: companyId, title: 'Analitik', type: 'is', status: 'pending', deadline: later, location: 'Bakı',
    approved_by: companyUser, approved_at: future, rejection_reason: 'yox', changes_requested: 'yox', created_at: future }).select('id').single();
  assert.equal(created.error, null);
  const row = (await one<Record<string, unknown>>(h.pool, 'SELECT approved_by, approved_at, rejection_reason, changes_requested, created_at FROM jobs WHERE id = ?', [created.data!.id]))!;
  assert.equal(row.approved_by, null);
  assert.equal(row.approved_at, null);
  assert.equal(row.rejection_reason, null);
  assert.equal(row.changes_requested, null);
  assert.ok(new Date(row.created_at as string).getTime() <= Date.now() + 1000, 'created now, not in the future');
});

test('M1/M2/M4: a rejected company changes nothing and requests no package', async () => {
  const invite = await h.service().from('invites').insert({ company_id: companyId, student_id: studentId, job_id: openJob }).select('id').single();
  assert.equal(invite.error, null);
  await exec(h.pool, `UPDATE companies SET status = 'rejected' WHERE id = ?`, [companyId]);
  try {
    await company.from('invites').delete().eq('id', invite.data!.id);
    assert.ok(await one(h.pool, 'SELECT id FROM invites WHERE id = ?', [invite.data!.id]), 'M1: the invite stays');
    await company.from('companies').update({ about: 'Dəyişdirildi' }).eq('id', companyId);
    assert.notEqual((await one<{ about: string | null }>(h.pool, 'SELECT about FROM companies WHERE id = ?', [companyId]))!.about, 'Dəyişdirildi', 'M2');
    const plan = await company.rpc('select_company_plan', { p_plan_id: 'pro' });
    assert.ok(plan.error, 'M4: no package for a rejected company');
    assert.equal((await one<{ n: number }>(h.pool, 'SELECT COUNT(*) AS n FROM payments WHERE company_id = ?', [companyId]))!.n, 0);
  } finally {
    await exec(h.pool, `UPDATE companies SET status = 'active' WHERE id = ?`, [companyId]);
  }
});

test('M3: a rejected account sends no follow', async () => {
  const { client, id } = await signedIn('v3.redd@asoiu.edu.az', { role: 'student', full_name: 'Rədd Hesab' });
  await exec(h.pool, `UPDATE profiles SET status = 'rejected' WHERE id = ?`, [id]);
  const { error } = await client.from('follows').insert({ follower_id: id, followed_company_id: companyId });
  assert.ok(error, 'refused');
  assert.equal(Number((await one<{ n: number }>(h.pool, 'SELECT COUNT(*) AS n FROM follows WHERE follower_id = ?', [id]))!.n), 0);
});

test('M44 and L7: a temporary password leaves the account read-only, functions included', async () => {
  const created = await h.service().auth.admin.createUser({ email: 'v3.muveqqeti@asoiu.edu.az', password: 'Muveqqeti2026!', email_confirm: true,
    user_metadata: { role: 'student', full_name: 'Müvəqqəti' }, app_metadata: { must_change_password: true } });
  const id = created.data.user!.id;
  const client = h.anon();
  await client.auth.signInWithPassword({ email: 'v3.muveqqeti@asoiu.edu.az', password: 'Muveqqeti2026!' });
  const token = await tokenOf(client);
  assert.equal((await raw(`/rest/v1/profiles?select=id&id=eq.${id}`, { token })).status, 200, 'reads still work');
  const write = await raw(`/rest/v1/profiles?id=eq.${id}`, { method: 'PATCH', token, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ city: 'Gəncə' }) });
  assert.equal(write.status, 403);
  const fn = await raw('/functions/v1/career-ai', { method: 'POST', token, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task: 'cv_review' }) });
  assert.equal(fn.status, 403);
  // After the new password the account writes again.
  assert.equal((await client.auth.updateUser({ password: 'Oz2026Sifrem!', current_password: 'Muveqqeti2026!' } as { password: string })).error, null);
  const again = await raw(`/rest/v1/profiles?id=eq.${id}`, { method: 'PATCH', token: await tokenOf(client), headers: { 'content-type': 'application/json' }, body: JSON.stringify({ city: 'Gəncə' }) });
  assert.equal(again.status, 204);
});

test('L7: a password-recovery session calls no function', async () => {
  const before = h.mailer.outbox!.length;
  assert.equal((await h.anon().auth.resetPasswordForEmail('v3.telebe@asoiu.edu.az', { redirectTo: 'https://asoiu-career.vercel.app/' })).error, null);
  const res = await openLink(h.mailer.outbox![before].link);
  const token = (await linkSession(h, res.headers.get('location')!)).access_token;
  assert.ok(token);
  const fn = await raw('/functions/v1/career-ai', { method: 'POST', token, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task: 'cv_review' }) });
  assert.equal(fn.status, 403);
});

test('M6/M30: a setting that is not a whole number, or a missing production secret, stops the start', () => {
  const base = { JWT_SECRET: 'x'.repeat(40), API_EXTERNAL_URL: 'https://api.example.az', MYSQL_URL: 'mysql://u@127.0.0.1/db', ANON_KEY: 'a', SERVICE_ROLE_KEY: 's' };
  assert.doesNotThrow(() => loadConfig(base as NodeJS.ProcessEnv));
  for (const extra of [{ PORT: 'abc' }, { PORT: '70000' }, { PASSWORD_MIN_LENGTH: '7' }, { PASSWORD_MIN_LENGTH: '8.5' }, { JWT_EXPIRY: '' + 'NaN' }, { API_REQUESTS_PER_MINUTE_USER: '10' }]) {
    assert.throws(() => loadConfig({ ...base, ...extra } as NodeJS.ProcessEnv), Error, JSON.stringify(extra));
  }
  assert.throws(() => loadConfig({ ...base, NODE_ENV: 'production' } as NodeJS.ProcessEnv), /production needs/);
  assert.throws(() => createPool('mysql://u@127.0.0.1/db', { MYSQL_POOL_SIZE: 'many' } as NodeJS.ProcessEnv));
});

test('L12: an IPv6 client is counted per /64; IPv4 written as IPv6 is the IPv4 address', () => {
  assert.equal(clientKey('2001:db8:1:2:aaaa::1'), '2001:db8:1:2::/64');
  assert.equal(clientKey('2001:0db8:0001:0002:bbbb:cccc:dddd:eeee'), '2001:db8:1:2::/64');
  assert.notEqual(clientKey('2001:db8:1:3::1'), clientKey('2001:db8:1:2::1'));
  assert.equal(clientKey('::ffff:10.1.2.3'), '10.1.2.3');
  assert.equal(clientKey('10.1.2.3'), '10.1.2.3');
});

test('L31: the scheduler reads ranges and steps, and refuses what it cannot read', () => {
  assert.deepEqual([...parseField('*/20', 0)].sort((a, b) => a - b), [0, 20, 40]);
  assert.deepEqual([...parseField('1-5', 4)].sort((a, b) => a - b), [1, 2, 3, 4, 5]);
  assert.deepEqual([...parseField('0-10/5', 0)].sort((a, b) => a - b), [0, 5, 10]);
  assert.equal(parseCron('15 3 * * *').length, 5);
  for (const bad of ['61 * * * *', 'a * * * *', '* * *', '*/0 * * * *', '5-1 * * * *']) assert.throws(() => parseCron(bad), Error, bad);
});

test('L20/L21: a filter is checked against its column type and the embeds of the request', async () => {
  const uuid = await raw('/rest/v1/jobs?select=id&id=eq.not-a-uuid');
  assert.equal(uuid.status, 400);
  assert.equal((await uuid.json()).code, '22P02');
  assert.equal((await raw('/rest/v1/jobs?select=id&deadline=eq.2026-13-45x')).status, 400);
  assert.equal((await raw('/rest/v1/jobs?select=id&companies.name=eq.x')).status, 400, 'a filter on an embed that is not selected');
  assert.equal((await raw(`/rest/v1/jobs?select=id&id=eq.${openJob}`)).status, 200);
});

test('M20: a write that matches more than 1000 rows is refused', async () => {
  await exec(h.pool, `INSERT INTO notifications (profile_id, kind, title)
    WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 1000) SELECT ?, 'test', CONCAT('Bildiriş ', i) FROM n`, [studentId]);
  await exec(h.pool, `INSERT INTO notifications (profile_id, kind, title) VALUES (?, 'test', 'Bildiriş 1001')`, [studentId]);
  try {
    const { error } = await h.service().from('notifications').update({ read_at: new Date().toISOString() }).eq('profile_id', studentId).eq('kind', 'test');
    assert.equal(error?.code, '54000');
    assert.equal(Number((await one<{ n: number }>(h.pool, `SELECT COUNT(*) AS n FROM notifications WHERE profile_id = ? AND kind = 'test' AND read_at IS NOT NULL`, [studentId]))!.n), 0);
  } finally {
    await exec(h.pool, `DELETE FROM notifications WHERE profile_id = ? AND kind = 'test'`, [studentId]);
  }
});

test('L49: an interview link points only to a known video-call service', () => {
  for (const ok of ['', 'https://meet.google.com/abc-defg-hij', 'https://us02web.zoom.us/j/123', 'https://zoom.us/j/1', 'https://teams.microsoft.com/l/meetup-join/x']) assert.equal(meetingUrlAllowed(ok), true, ok);
  for (const bad of ['http://meet.google.com/x', 'https://meet.google.com.evil.az/x', 'https://evilzoom.us/j/1', 'https://user:pw@zoom.us/j/1',
    'https://zoom.us:8443/j/1', 'javascript:alert(1)', 'https://login.example.az/zoom.us']) assert.equal(meetingUrlAllowed(bad), false, bad);
});

test('I9: the API sets its own security headers', async () => {
  const res = await raw('/auth/v1/health');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
});

test('I10: each client has a request budget for data and files; the server key has none', async () => {
  const small = await startHarness({ API_REQUESTS_PER_MINUTE_ADDRESS: '60' });
  try {
    const get = (key: string) => fetch(`${small.url}/rest/v1/jobs?select=id&limit=1`, { headers: { apikey: key, authorization: `Bearer ${key}` } });
    for (let i = 0; i < 60; i++) assert.equal((await get(small.config.anonKey)).status, 200);
    const over = await get(small.config.anonKey);
    assert.equal(over.status, 429);
    assert.ok(Number(over.headers.get('retry-after')) >= 1);
    assert.equal((await get(small.config.serviceRoleKey)).status, 200);
    assert.equal((await fetch(`${small.url}/auth/v1/health`)).status, 200, 'sign-in routes keep their own limits');
  } finally {
    await small.close();
  }
});

test('M13/M14: a file moved aside comes back, and a placed file can be taken back', async () => {
  const root = mkdtempSync(join(tmpdir(), 'asoiu-files-'));
  try {
    const files = new FileStore(root);
    await files.place(await files.stage(new TextEncoder().encode('köhnə')), 'avatars', 'u/a.webp');
    const aside = await files.setAside('avatars', 'u/a.webp');
    assert.ok(aside);
    assert.equal(await files.exists('avatars', 'u/a.webp'), false);
    const temp = await files.stage(new TextEncoder().encode('yeni'));
    await files.place(temp, 'avatars', 'u/a.webp');
    // The database write failed: the new file goes back to staging, the old one returns.
    await files.unplace('avatars', 'u/a.webp', temp);
    await files.restore(aside!, 'avatars', 'u/a.webp');
    assert.equal(readFileSync(files.path('avatars', 'u/a.webp'), 'utf8'), 'köhnə');
    assert.equal(readFileSync(temp, 'utf8'), 'yeni');
    writeFileSync(temp, '');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('M41: a staff session is not refreshed 12 hours after sign-in; a student session is', async () => {
  await staff('v3.saat@asoiu.edu.az', 'editor');
  const editor = h.anon();
  assert.equal((await editor.auth.signInWithPassword({ email: 'v3.saat@asoiu.edu.az', password: 'Sifre2026!' })).error, null);
  const pupil = h.anon();
  assert.equal((await pupil.auth.signInWithPassword({ email: 'v3.telebe@asoiu.edu.az', password: 'Sifre2026!' })).error, null);
  await exec(h.pool, `UPDATE auth_sessions s JOIN auth_users u ON u.id = s.user_id SET s.created_at = DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 13 HOUR)
    WHERE u.email IN ('v3.saat@asoiu.edu.az', 'v3.telebe@asoiu.edu.az')`);
  assert.ok((await editor.auth.refreshSession()).error, 'the staff session ends');
  assert.equal((await pupil.auth.refreshSession()).error, null, 'a student stays signed in');
});
