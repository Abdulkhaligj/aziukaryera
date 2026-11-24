// Security audit "Aziu-Karyer-3" (2026-11-23, audit v4): each finding replayed
// against the API, so a fix is checked by the attack the audit describes.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { exec, one } from '../src/db.ts';
import { canonical } from '../src/values.ts';
import type { Column } from '../src/schema.ts';
import { RateLimiter } from '../src/auth/rate-limit.ts';
import { fileBytes, startHarness, type ApiClient, type Harness } from './helpers.ts';

let h: Harness, strict: Harness;
let student: ApiClient, other: ApiClient, company: ApiClient;
let studentId: string, otherId: string, companyUser: string, companyId: string;
const openJob = '77777777-7777-4777-8777-777777777777';

async function signedIn(harness: Harness, email: string, data: Record<string, unknown>) {
  const client = harness.anon();
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
const post = (harness: Harness, path: string, body: unknown, ip?: string) => fetch(`${harness.url}${path}`, { method: 'POST',
  headers: { apikey: harness.config.anonKey, 'content-type': 'application/json', ...(ip ? { 'x-forwarded-for': ip } : {}) }, body: JSON.stringify(body) });
async function openLink(harness: Harness, link: string) {
  const html = await (await fetch(link)).text();
  const unescape = (v: string) => v.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  const fields = Object.fromEntries([...html.matchAll(/name="(\w+)" value="([^"]*)"/g)].map(m => [m[1], unescape(m[2])]));
  return fetch(`${harness.url}/auth/v1/verify`, { method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields) });
}
const lastMail = (harness: Harness, to: string) => [...harness.mailer.outbox!].reverse().find(m => m.to === to)!;

before(async () => {
  h = await startHarness();
  strict = await startHarness({ ENABLE_EMAIL_AUTOCONFIRM: 'false' });
  ({ client: student, id: studentId } = await signedIn(h, 'v4.telebe@asoiu.edu.az', { role: 'student', full_name: 'Leyla Həsənova' }));
  ({ client: other, id: otherId } = await signedIn(h, 'v4.diger@asoiu.edu.az', { role: 'student', full_name: 'Orxan Quliyev' }));
  ({ client: company, id: companyUser } = await signedIn(h, 'hr@v4audit.az', { role: 'company', company_name: 'V4 Audit MMC', full_name: 'HR V4' }));
  companyId = (await one<{ id: string }>(h.pool, 'SELECT id FROM companies WHERE owner_id = ?', [companyUser]))!.id;
  await exec(h.pool, `UPDATE companies SET status = 'active' WHERE id = ?`, [companyId]);
  await exec(h.pool, `UPDATE profiles SET status = 'active' WHERE id = ?`, [companyUser]);
  const later = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const jobs = await h.service().from('jobs').insert([{ id: openJob, company_id: companyId, title: 'Mühəndis', type: 'is', status: 'approved', deadline: later, location: 'Bakı' }]);
  if (jobs.error) throw jobs.error;
});
after(async () => { await h?.close(); await strict?.close(); });

test('H-01: a password set at a stranger\'s sign-up does not survive a resent confirmation or a magic link', async () => {
  for (const [via, email] of [['resend', 'v4.qurban1@asoiu.edu.az'], ['otp', 'v4.qurban2@asoiu.edu.az']] as const) {
    const attacker = strict.anon();
    assert.equal((await attacker.auth.signUp({ email, password: 'Hucumcu2026!', options: { data: { role: 'student', full_name: 'Qurban' } } })).error, null);
    const sent = via === 'resend'
      ? await post(strict, '/auth/v1/resend', { type: 'signup', email }, '198.51.100.7')
      : await post(strict, '/auth/v1/otp', { email, create_user: false }, '198.51.100.8');
    assert.equal(sent.status, 200, via);
    const res = await openLink(strict, lastMail(strict, email).link);   // the owner of the mailbox confirms
    assert.equal(res.status, 303);
    const login = await strict.anon().auth.signInWithPassword({ email, password: 'Hucumcu2026!' });
    assert.ok(login.error, `${via}: the attacker's password no longer works`);
    const meta = await one<{ m: { needs_password?: boolean } }>(strict.pool, 'SELECT raw_app_meta_data AS m FROM auth_users WHERE email = ?', [email]);
    assert.equal(meta!.m.needs_password, true, `${via}: the site asks the owner for a password`);
  }
});

test('M-01: status as an index, a number or with a trailing space does not approve a vacancy', async () => {
  const column = { name: 'status', enumValues: ['draft', 'pending', 'approved'] } as unknown as Column;
  for (const value of ['3', 3, 'approved ']) assert.throws(() => canonical(column, value), (e: { sqlState?: string }) => e.sqlState === '22P02');
  const later = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
  const job = await company.from('jobs').insert({ company_id: companyId, title: 'Analitik', type: 'is', status: 'pending', deadline: later, location: 'Bakı' }).select('id').single();
  assert.equal(job.error, null);
  for (const status of ['3', 3, 'approved ']) {
    const { error } = await company.from('jobs').update({ status }).eq('id', job.data!.id);
    assert.ok(error, JSON.stringify(status));
  }
  assert.equal((await one<{ status: string }>(h.pool, 'SELECT status FROM jobs WHERE id = ?', [job.data!.id]))!.status, 'pending');
});

test('M-02: a rate-limit key keeps a bounded size, whatever the request carries', async () => {
  const limiter = new RateLimiter(5, 60_000);
  limiter.take('x'.repeat(1_000_000));
  const keys = [...(limiter as unknown as { hits: Map<string, unknown> }).hits.keys()];
  assert.ok(keys.every(k => k.length <= 128), 'long keys are hashed');
  const res = await fetch(`${h.url}/rest/v1/rpc/ad_track`, { method: 'POST', headers: { apikey: h.config.anonKey, 'content-type': 'application/json' },
    body: JSON.stringify({ p_id: openJob, p_kind: 'v'.repeat(200_000) }) });
  assert.ok(res.status < 500, 'an oversized kind is refused or ignored, not stored');
});

test('M-05: parallel file listings cannot use up the database connections', async () => {
  const token = (await student.auth.getSession()).data.session!.access_token;
  const list = () => fetch(`${h.url}/storage/v1/object/list/avatars`, { method: 'POST',
    headers: { apikey: h.config.anonKey, authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ prefix: '' }) });
  const results = await Promise.all(Array.from({ length: 60 }, list));
  assert.ok(results.every(r => r.status !== 500), 'no 500');
  assert.ok(results.filter(r => r.status === 429).length > 0, 'parallel listings of one account wait their turn (429)');
  assert.equal((await fetch(`${h.url}/rest/v1/jobs?select=id&limit=1`, { headers: { apikey: h.config.anonKey } })).status, 200);
});

test('L-1: media of a post the reader may not see stays hidden', async () => {
  const created = await student.from('posts').insert({ author_id: studentId, body: 'Gözləyən paylaşım' }).select('id').single();
  await exec(h.pool, `UPDATE posts SET moderation_status = 'pending' WHERE id = ?`, [created.data!.id]);
  await h.service().from('post_media').insert({ post_id: created.data!.id, media_type: 'image', storage_path: `${studentId}/a.png`, title: 'Gizli' });
  const { data } = await other.from('post_media').select('id,storage_path').eq('post_id', created.data!.id);
  assert.deepEqual(data, []);
});

test('L-2: no application to a vacancy that is not public', async () => {
  const later = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
  const hidden = await h.service().from('jobs').insert({ company_id: companyId, title: 'Gizli', type: 'is', status: 'pending', deadline: later, location: 'Bakı' }).select('id').single();
  const pendingJob = await student.from('applications').insert({ job_id: hidden.data!.id, student_id: studentId }).select('id');
  assert.ok(pendingJob.error, 'a vacancy waiting for review');
  await exec(h.pool, `UPDATE companies SET status = 'pending' WHERE id = ?`, [companyId]);
  try {
    const inactive = await other.from('applications').insert({ job_id: openJob, student_id: otherId }).select('id');
    assert.ok(inactive.error, 'a company that is not active');
  } finally { await exec(h.pool, `UPDATE companies SET status = 'active' WHERE id = ?`, [companyId]); }
});

test('L-3: an editor does not take a company away from its owner', async () => {
  const editor = await staff('v4.editor@asoiu.edu.az', 'editor');
  await editor.from('companies').update({ owner_id: null }).eq('id', companyId);
  await editor.from('company_members').delete().eq('company_id', companyId).eq('profile_id', companyUser);
  assert.equal((await one<{ owner_id: string }>(h.pool, 'SELECT owner_id FROM companies WHERE id = ?', [companyId]))!.owner_id, companyUser);
  assert.ok(await one(h.pool, `SELECT 1 AS ok FROM company_members WHERE company_id = ? AND profile_id = ? AND member_role = 'owner'`, [companyId, companyUser]));
});

test('L-4: the daily comment limit holds against back-dating, delete-and-write and parallel writes', async () => {
  const target = await h.service().from('posts').insert({ author_id: otherId, body: 'Şərh üçün', moderation_status: 'approved' }).select('id').single();
  const postId = target.data!.id;
  const old = await student.from('post_comments').insert({ post_id: postId, author_id: studentId, body: 'Köhnə tarixli', created_at: '2020-01-01T00:00:00Z' });
  assert.equal(old.status, 403, 'a back-dated comment is refused, like a back-dated post');
  const first = await student.from('post_comments').insert({ post_id: postId, author_id: studentId, body: 'Bugünkü' }).select('id').single();
  const stored = await one<{ created_at: string }>(h.pool, 'SELECT created_at FROM post_comments WHERE id = ?', [first.data!.id]);
  assert.ok(Date.now() - new Date(stored!.created_at).getTime() < 60_000, 'the server sets the time');
  // 99 written today: one more is allowed, a deleted one does not free a place.
  await exec(h.pool, `UPDATE private_daily_counters SET n = 99 WHERE profile_id = ? AND kind = 'post_comments'`, [studentId]);
  const hundredth = await student.from('post_comments').insert({ post_id: postId, author_id: studentId, body: 'Yüzüncü' }).select('id').single();
  assert.equal(hundredth.error, null);
  await student.from('post_comments').delete().eq('id', hundredth.data!.id);
  assert.ok((await student.from('post_comments').insert({ post_id: postId, author_id: studentId, body: 'Yenidən' }).select('id')).error, 'delete-and-write');
  // Parallel: 95 used, ten at once, five pass.
  await exec(h.pool, `UPDATE private_daily_counters SET n = 95 WHERE profile_id = ? AND kind = 'post_comments'`, [studentId]);
  const burst = await Promise.all(Array.from({ length: 10 }, (_, i) => student.from('post_comments').insert({ post_id: postId, author_id: studentId, body: `Paralel ${i}` }).select('id')));
  assert.equal(burst.filter(r => !r.error).length, 5);
});

test('L-5: sign-up and email change answer the same for a taken and a free address', async () => {
  await signedIn(strict, 'v4.movcud@asoiu.edu.az', { role: 'student', full_name: 'Mövcud' });
  await exec(strict.pool, `UPDATE auth_users SET email_confirmed_at = CURRENT_TIMESTAMP(6) WHERE email = 'v4.movcud@asoiu.edu.az'`);
  const shape = async (res: Response) => ({ status: res.status, keys: Object.keys(await res.json()).sort().join(',') });
  const taken = await shape(await post(strict, '/auth/v1/signup', { email: 'v4.movcud@asoiu.edu.az', password: 'Sifre2026!', data: { role: 'student', full_name: 'X' } }, '198.51.100.21'));
  const free = await shape(await post(strict, '/auth/v1/signup', { email: 'v4.yeni@asoiu.edu.az', password: 'Sifre2026!', data: { role: 'student', full_name: 'Y' } }, '198.51.100.22'));
  assert.deepEqual(taken, free);
  const token = (await h.anon().auth.signInWithPassword({ email: 'v4.diger@asoiu.edu.az', password: 'Sifre2026!' })).data.session!.access_token;
  const change = (email: string, ip: string) => fetch(`${h.url}/auth/v1/user`, { method: 'PUT',
    headers: { apikey: h.config.anonKey, authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({ email }) });
  const a = await change('v4.telebe@asoiu.edu.az', '198.51.100.23'), b = await change('v4.bos@asoiu.edu.az', '198.51.100.24');
  assert.equal(a.status, b.status);
  const [ja, jb] = [await a.json(), await b.json()];
  assert.equal(Object.keys(ja).sort().join(','), Object.keys(jb).sort().join(','));
  assert.equal(ja.new_email, 'v4.telebe@asoiu.edu.az', 'a taken address looks like a pending change');
  assert.equal(jb.new_email, 'v4.bos@asoiu.edu.az');
});

test('L-6: a sign-up waits for its email confirmation before its profile is active', async () => {
  const { id } = await signedIn(strict, 'v4.tesdiqsiz@asoiu.edu.az', { role: 'student', full_name: 'Təsdiqsiz' });
  assert.equal((await one<{ status: string }>(strict.pool, 'SELECT status FROM profiles WHERE id = ?', [id]))!.status, 'pending');
  await openLink(strict, lastMail(strict, 'v4.tesdiqsiz@asoiu.edu.az').link);
  assert.equal((await one<{ status: string }>(strict.pool, 'SELECT status FROM profiles WHERE id = ?', [id]))!.status, 'active');
});

test('L-7: requests from many addresses do not lock the owner out of email links', async () => {
  const email = 'v4.telebe@asoiu.edu.az';
  // The owner signed in from 192.0.2.50 before.
  await fetch(`${h.url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: h.config.anonKey, 'content-type': 'application/json', 'x-forwarded-for': '192.0.2.50' },
    body: JSON.stringify({ email, password: 'Sifre2026!' }) });
  for (let i = 1; i <= 25; i++) await post(h, '/auth/v1/recover', { email }, `203.0.113.${i}`);
  assert.equal((await post(h, '/auth/v1/recover', { email }, '203.0.113.99')).status, 429, 'a stranger is stopped');
  assert.equal((await post(h, '/auth/v1/recover', { email }, '192.0.2.50')).status, 200, 'the owner still gets a link');
});

test('L-8: parallel AI requests do not pass the limit', async () => {
  const results = await Promise.all(Array.from({ length: 100 }, () =>
    h.service().rpc('ai_reserve_request', { p_profile_id: studentId, p_task: 'aida_chat', p_job_id: null, p_client_hash: null })));
  assert.equal(results.filter(r => r.data?.allowed === true).length, 80);
});

test('M-04: guests from one network, or a burst of guests, do not use up the shared AIDA pool', async () => {
  const reserve = (client: string, subnet: string) => h.service().rpc('ai_reserve_request', { p_profile_id: null, p_task: 'aida_chat', p_job_id: null, p_client_hash: client, p_subnet_hash: subnet });
  const hex = (n: number, salt: string) => (salt + n.toString(16)).padStart(40, '0').slice(-40);
  let allowed = 0;
  for (let i = 0; i < 12; i++) for (let j = 0; j < 20; j++) if ((await reserve(hex(i, 'a'), hex(1, 'b'))).data?.allowed) allowed++;
  assert.equal(allowed, 100, 'one network gets at most 100 a day');
  let burst = 0;
  for (let i = 0; i < 40; i++) for (let j = 0; j < 10; j++) if ((await reserve(hex(i, 'c'), hex(i, 'd'))).data?.allowed) burst++;
  assert.ok(burst <= 300 - 100, 'at most 300 guest requests an hour in all');
});

test('L-9: a refused upload leaves no folders behind', async () => {
  const token = (await student.auth.getSession()).data.session!.access_token;
  const deep = Array.from({ length: 40 }, (_, i) => `q${i}`).join('/');
  const res = await fetch(`${h.url}/storage/v1/object/public-media/${deep}/x.png`, { method: 'POST',
    headers: { apikey: h.config.anonKey, authorization: `Bearer ${token}`, 'content-type': 'image/png' }, body: fileBytes(64, 'image/png') });
  assert.ok(res.status >= 400);
  const dirs: string[] = [];
  const walk = (dir: string) => { for (const name of readdirSync(dir)) { const p = join(dir, name); if (statSync(p).isDirectory()) { dirs.push(p); walk(p); } } };
  walk(h.config.storageDir);
  assert.ok(!dirs.some(d => /q\d+$/.test(d)), 'no folder of the refused path');
});

test('L-10: an upload without credentials is refused before its body is read', async () => {
  const url = new URL(`${h.url}/storage/v1/object/avatars/x.png`);
  const status = await new Promise<number>((resolve, reject) => {
    const req = request({ host: url.hostname, port: url.port, path: url.pathname, method: 'POST',
      headers: { 'content-type': 'image/png', 'content-length': String(50 * 1024 * 1024) } }, res => { resolve(res.statusCode ?? 0); res.resume(); req.destroy(); });
    req.on('error', () => {});
    req.write(Buffer.alloc(1024 * 1024));        // 1 MB of a declared 50 MB, then nothing
    setTimeout(() => reject(new Error('the server waited for the body')), 3000);
  });
  assert.ok(status === 401 || status === 400 || status === 403, String(status));
});

test('M-03: wrong passwords for the platform reset are stopped after three tries', async () => {
  const admin = await staff('v4.super@asoiu.edu.az', 'super_admin');
  const codes: (string | undefined)[] = [];
  for (let i = 0; i < 4; i++) codes.push((await admin.rpc('admin_reset_platform_data', { p_confirmation: 'SIFIRLA', p_password: `Sehv${i}` })).error?.code);
  assert.deepEqual(codes.slice(0, 3), ['28P01', '28P01', '28P01']);
  assert.notEqual(codes[3], '28P01', 'the fourth try is not even checked');
  const right = await admin.rpc('admin_reset_platform_data', { p_confirmation: 'SIFIRLA', p_password: 'Sifre2026!' });
  assert.ok(right.error, 'locked for a while, the right password included');
  assert.ok(await one(h.pool, 'SELECT id FROM jobs WHERE id = ?', [openJob]), 'nothing was deleted');
});

test('L48 (rest): an invitation link brings a one-time link code, never a session token', async () => {
  const invited = await fetch(`${h.url}/auth/v1/invite?redirect_to=${encodeURIComponent('https://asoiu-career.vercel.app/')}`, { method: 'POST',
    headers: { apikey: h.config.serviceRoleKey, authorization: `Bearer ${h.config.serviceRoleKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'v4.devet@asoiu.edu.az', data: { role: 'student', full_name: 'Dəvət' } }) });
  assert.equal(invited.status, 200);
  const res = await openLink(h, lastMail(h, 'v4.devet@asoiu.edu.az').link);
  const fragment = new URLSearchParams(new URL(res.headers.get('location')!).hash.slice(1));
  assert.equal(fragment.get('access_token'), null);
  assert.equal(fragment.get('type'), 'invite');
  const code = fragment.get('link_code')!;
  const trade = (grant: string, body: unknown) => fetch(`${h.url}/auth/v1/token?grant_type=${grant}`, { method: 'POST',
    headers: { apikey: h.config.anonKey, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await trade('pkce', { auth_code: code, code_verifier: '-' })).status, 400, 'not a PKCE code');
  const first = await trade('link_code', { link_code: code });
  assert.equal(first.status, 200);
  assert.ok((await first.json()).access_token);
  assert.equal((await trade('link_code', { link_code: code })).status, 400, 'once');
});
