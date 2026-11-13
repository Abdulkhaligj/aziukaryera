import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeJwt } from 'jose';
import { exec, one, rows } from '../src/db.ts';
import { currentAdminRole } from '../src/write/rules/core.ts';
import { loadConfig } from '../src/config.ts';
import { startHarness, type Harness } from './helpers.ts';

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h?.close(); });

// An email link opens a page with one button; pressing it posts the form (audit 2026-11-13, #75).
async function openLink(link: string) {
  const page = await fetch(link);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type') || '', /text\/html/);
  const html = await page.text();
  const unescape = (v: string) => v.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  const fields = Object.fromEntries([...html.matchAll(/name="(\w+)" value="([^"]*)"/g)].map(m => [m[1], unescape(m[2])]));
  return fetch(`${h.url}/auth/v1/verify`, { method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields) });
}

const studentMeta = { role: 'student', account_status: 'student', full_name: 'Aysel Məmmədova', phone: '+994500000000',
  faculty_name: 'İnformasiya texnologiyaları', major_name: 'Kompüter elmləri', group_name: '650.22', bachelor_start_year: '2022', bachelor_end_year: '2026' };

test('student signup with a university email creates the profile and education, as handle_new_user did', async () => {
  const { data, error } = await h.anon().auth.signUp({ email: 'Aysel.M@asoiu.edu.az', password: 'Sifre2026!', options: { data: studentMeta } });
  assert.equal(error, null);
  assert.ok(data.session?.access_token, 'autoconfirm returns a session');
  assert.equal(data.user?.email, 'aysel.m@asoiu.edu.az');
  const profile = await one(h.pool, 'SELECT role, status, full_name, account_status, alumni_verified FROM profiles WHERE id = ?', [data.user!.id]);
  assert.deepEqual(profile, { role: 'student', status: 'active', full_name: 'Aysel Məmmədova', account_status: 'student', alumni_verified: false });
  const education = await rows(h.pool, 'SELECT degree_type, specialty, start_year, graduation_year, is_current FROM education WHERE profile_id = ?', [data.user!.id]);
  assert.deepEqual(education, [{ degree_type: 'bachelor', specialty: 'Kompüter elmləri', start_year: 2022, graduation_year: 2026, is_current: true }]);
  const audit = await rows(h.pool, `SELECT resource, action, actor_name FROM admin_audit_logs WHERE resource IN ('profiles','education') ORDER BY resource`);
  assert.deepEqual(audit, [{ resource: 'education', action: 'db_insert', actor_name: 'System' }, { resource: 'profiles', action: 'db_insert', actor_name: 'System' }]);
});

test('a student without a university email is refused with the message the portal translates', async () => {
  const { data, error } = await h.anon().auth.signUp({ email: 'someone@gmail.com', password: 'Sifre2026!', options: { data: studentMeta } });
  assert.equal(data.user, null);
  assert.equal(error?.message, 'Database error saving new user');
  assert.equal(await one(h.pool, `SELECT id FROM auth_users WHERE email = 'someone@gmail.com'`), null, 'the auth user is rolled back too');
});

test('company signup creates a pending company, a free subscription and the owner seat within the plan quota', async () => {
  const { data, error } = await h.anon().auth.signUp({ email: 'hr@example.az', password: 'Sifre2026!',
    options: { data: { role: 'company', company_name: 'Nümunə MMC', full_name: 'Leyla Əliyeva', sector: 'IT', contact_name: 'Leyla' } } });
  assert.equal(error, null);
  const id = data.user!.id;
  assert.deepEqual(await one(h.pool, 'SELECT role, status FROM profiles WHERE id = ?', [id]), { role: 'company', status: 'pending' });
  const company = await one<{ id: string; name: string; status: string }>(h.pool, 'SELECT id, name, status FROM companies WHERE owner_id = ?', [id]);
  assert.equal(company?.name, 'Nümunə MMC');
  assert.equal(company?.status, 'pending');
  assert.deepEqual(await one(h.pool, 'SELECT plan_id, status, ends_at FROM subscriptions WHERE company_id = ?', [company!.id]), { plan_id: 'free', status: 'active', ends_at: null });
  assert.deepEqual(await one(h.pool, 'SELECT member_role, status FROM company_members WHERE company_id = ?', [company!.id]), { member_role: 'owner', status: 'active' });
  assert.deepEqual(await one(h.pool, `SELECT used_count FROM private_company_quota_counters WHERE subject_id = ? AND feature_key = 'team_members'`, [company!.id]), { used_count: 1 });
  assert.deepEqual(await one(h.pool, `SELECT u.used_count FROM subscription_usage u JOIN subscriptions s ON s.id = u.subscription_id
    WHERE s.company_id = ? AND u.feature_key = 'team_members'`, [company!.id]), { used_count: 1 });
});

test('a paid plan at signup becomes a request with a numbered invoice and an admin notification', async () => {
  await exec(h.pool, `INSERT INTO auth_users (id, email) VALUES ('22222222-2222-4222-8222-222222222222', 'career@asoiu.edu.az')`);
  await exec(h.pool, `INSERT INTO profiles (id, role, status, email, full_name, admin_role)
    VALUES ('22222222-2222-4222-8222-222222222222', 'admin', 'active', 'career@asoiu.edu.az', 'Karyera Mərkəzi', 'super_admin')`);
  const { data, error } = await h.anon().auth.signUp({ email: 'pro@example.az', password: 'Sifre2026!',
    options: { data: { role: 'company', company_name: 'Pro MMC', plan_id: 'pro' } } });
  assert.equal(error, null);
  const company = await one<{ id: string }>(h.pool, 'SELECT id FROM companies WHERE owner_id = ?', [data.user!.id]);
  assert.deepEqual(await one(h.pool, 'SELECT plan_id, status, requested_plan_id FROM subscriptions WHERE company_id = ?', [company!.id]),
    { plan_id: 'free', status: 'active', requested_plan_id: 'pro' });
  const invoice = await one<{ invoice_number: string; amount: number; status: string }>(h.pool, 'SELECT invoice_number, amount, status FROM payments WHERE company_id = ?', [company!.id]);
  assert.match(invoice!.invoice_number, /^KM-\d{4}-00001$/);
  assert.equal(invoice!.amount, 24.99);
  assert.equal(invoice!.status, 'pending');
  const notice = await one<{ kind: string; title: string }>(h.pool,
    `SELECT kind, title FROM notifications WHERE profile_id = '22222222-2222-4222-8222-222222222222'`);
  assert.deepEqual(notice, { kind: 'invoice_created', title: `Yeni hesab-faktura: ${invoice!.invoice_number}` });
});

test('signing up twice reports an existing account', async () => {
  const { error } = await h.anon().auth.signUp({ email: 'aysel.m@asoiu.edu.az', password: 'Sifre2026!', options: { data: studentMeta } });
  assert.equal(error?.message, 'User already registered');
});

test('password sign-in issues the expected token shape; a wrong password gets the GoTrue message', async () => {
  const client = h.anon();
  const bad = await client.auth.signInWithPassword({ email: 'aysel.m@asoiu.edu.az', password: 'wrong-password' });
  assert.equal(bad.error?.message, 'Invalid login credentials');
  const { data, error } = await client.auth.signInWithPassword({ email: 'AYSEL.M@asoiu.edu.az', password: 'Sifre2026!' });
  assert.equal(error, null);
  const claims = decodeJwt(data.session!.access_token);
  assert.equal(claims.role, 'authenticated');
  assert.equal(claims.aud, 'authenticated');
  assert.equal(claims.sub, data.user!.id);
  assert.equal(claims.iss, `${h.url}/auth/v1`);
  assert.ok(typeof claims.session_id === 'string');
  assert.deepEqual((claims.app_metadata as Record<string, unknown>).provider, 'email');
  const me = await client.auth.getUser();
  assert.equal(me.data.user?.email, 'aysel.m@asoiu.edu.az');
});

test('passwords migrated from the old database (bcrypt $2a$) keep working', async () => {
  // Published bcrypt test vector: password "U*U".
  await exec(h.pool, `INSERT INTO auth_users (id, email, encrypted_password, email_confirmed_at) VALUES
    ('11111111-1111-4111-8111-111111111111', 'migrated@asoiu.edu.az', '$2a$05$CCCCCCCCCCCCCCCCCCCCC.E5YPO9kmyuRGyh0XouQYb4YMJKvyOeW', CURRENT_TIMESTAMP(6))`);
  const { data, error } = await h.anon().auth.signInWithPassword({ email: 'migrated@asoiu.edu.az', password: 'U*U' });
  assert.equal(error, null);
  assert.equal(data.user?.id, '11111111-1111-4111-8111-111111111111');
});

test('changing the password needs the current one, rejects the same one, and ends the other sessions', async () => {
  const client = h.anon();
  await client.auth.signInWithPassword({ email: 'aysel.m@asoiu.edu.az', password: 'Sifre2026!' });
  const other = h.anon();
  await other.auth.signInWithPassword({ email: 'aysel.m@asoiu.edu.az', password: 'Sifre2026!' });
  const update = (attributes: Record<string, unknown>) => client.auth.updateUser(attributes as { password: string });
  const missing = await update({ password: 'YeniSifre2026!' });
  assert.equal(missing.error?.message, 'Current password is incorrect', 'a stolen session cannot set a new password (#14)');
  const wrong = await update({ password: 'YeniSifre2026!', current_password: 'Sehv2026!' });
  assert.equal(wrong.error?.message, 'Current password is incorrect');
  const same = await update({ password: 'Sifre2026!', current_password: 'Sifre2026!' });
  assert.match(same.error?.message || '', /different from the old password/);
  const changed = await update({ password: 'YeniSifre2026!', current_password: 'Sifre2026!' });
  assert.equal(changed.error, null);
  const stillHere = await client.auth.getUser();
  assert.equal(stillHere.error, null, 'the session that changed the password stays');
  const otherToken = (await other.auth.getSession()).data.session!.access_token;
  const ended = await fetch(`${h.url}/rest/v1/profiles?select=id`, { headers: { apikey: h.config.anonKey, authorization: `Bearer ${otherToken}` } });
  assert.equal(ended.status, 401, 'every other session ends at once (H-10)');
  const relogin = await h.anon().auth.signInWithPassword({ email: 'aysel.m@asoiu.edu.az', password: 'YeniSifre2026!' });
  assert.equal(relogin.error, null);
});

test('refresh rotates tokens, tolerates a concurrent reuse, and revokes the session on a late replay', async () => {
  const client = h.anon();
  const { data } = await client.auth.signInWithPassword({ email: 'aysel.m@asoiu.edu.az', password: 'YeniSifre2026!' });
  const first = data.session!.refresh_token;
  const refresh = (token: string) => fetch(`${h.url}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST', headers: { apikey: h.config.anonKey, 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: token })
  });
  const a = await refresh(first);
  assert.equal(a.status, 200);
  const b = await refresh(first);
  assert.equal(b.status, 200, 'second tab within the reuse interval');
  await exec(h.pool, `UPDATE auth_refresh_tokens SET revoked_at = CURRENT_TIMESTAMP(6) - INTERVAL 1 MINUTE WHERE token_hash = SHA2(?, 256)`, [first]);
  const late = await refresh(first);
  assert.equal(late.status, 400);
  assert.equal((await late.json()).error_code, 'refresh_token_already_used');
  const childToken = (await a.json()).refresh_token;
  assert.equal((await refresh(childToken)).status, 400, 'the whole session is revoked');
});

test('signing out revokes the session for /user', async () => {
  const client = h.anon();
  const { data } = await client.auth.signInWithPassword({ email: 'aysel.m@asoiu.edu.az', password: 'YeniSifre2026!' });
  const token = data.session!.access_token;
  assert.equal((await client.auth.signOut()).error, null);
  const res = await fetch(`${h.url}/auth/v1/user`, { headers: { apikey: h.config.anonKey, authorization: `Bearer ${token}` } });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error_code, 'session_not_found');
});

test('password recovery emails a link that signs the user in through the portal redirect', async () => {
  const before = h.mailer.outbox!.length;
  const { error } = await h.anon().auth.resetPasswordForEmail('aysel.m@asoiu.edu.az', { redirectTo: 'https://asoiu-career.vercel.app/' });
  assert.equal(error, null);
  const mail = h.mailer.outbox![before];
  assert.equal(mail.kind, 'recovery');
  assert.equal(mail.to, 'aysel.m@asoiu.edu.az');
  const res = await openLink(mail.link);
  assert.equal(res.status, 303);
  const location = new URL(res.headers.get('location')!);
  assert.equal(location.origin + location.pathname, 'https://asoiu-career.vercel.app/');
  const hash = new URLSearchParams(location.hash.slice(1));
  assert.equal(hash.get('type'), 'recovery');
  const recoveryAuth = { apikey: h.config.anonKey, authorization: `Bearer ${hash.get('access_token')}` };
  const user = await fetch(`${h.url}/auth/v1/user`, { headers: recoveryAuth });
  assert.equal(user.status, 200);
  // The recovery session only sets a new password (#15).
  const data = await fetch(`${h.url}/rest/v1/profiles?select=id`, { headers: recoveryAuth });
  assert.equal(data.status, 403);
  const email = await fetch(`${h.url}/auth/v1/user`, { method: 'PUT', headers: { ...recoveryAuth, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'x@asoiu.edu.az' }) });
  assert.equal(email.status, 403);
  const set = await fetch(`${h.url}/auth/v1/user`, { method: 'PUT', headers: { ...recoveryAuth, 'content-type': 'application/json' }, body: JSON.stringify({ password: 'Berpa2026!' }) });
  assert.equal(set.status, 200, 'no current password is needed after a recovery link');
  assert.equal((await fetch(`${h.url}/rest/v1/profiles?select=id`, { headers: recoveryAuth })).status, 200, 'then the session is a normal one');
  const again = await openLink(mail.link);
  assert.match(again.headers.get('location')!, /error_code=otp_expired/, 'links are single use');
  const tooSoon = await h.anon().auth.resetPasswordForEmail('aysel.m@asoiu.edu.az');
  assert.match(tooSoon.error?.message || '', /only request this after/);
});

test('redirects outside the allow list fall back to the site', async () => {
  await h.anon().auth.resetPasswordForEmail('hr@example.az', { redirectTo: 'https://evil.example/steal' });
  const mail = h.mailer.outbox!.at(-1)!;
  assert.match(mail.link, /redirect_to=https%3A%2F%2Fasoiu-career\.vercel\.app/);
});

test('magic links are only sent to existing accounts when shouldCreateUser is false', async () => {
  const before = h.mailer.outbox!.length;
  const unknown = await h.anon().auth.signInWithOtp({ email: 'nobody@asoiu.edu.az', options: { shouldCreateUser: false } });
  assert.equal(unknown.error, null, 'the answer does not tell whether the address is registered');
  assert.equal(h.mailer.outbox!.length, before, 'but no mail goes out');
  const known = await h.anon().auth.signInWithOtp({ email: 'migrated@asoiu.edu.az', options: { shouldCreateUser: false } });
  assert.equal(known.error, null);
  assert.equal(h.mailer.outbox!.at(-1)!.kind, 'magic_link');
});

test('admin API (service role): create, merge app_metadata, staff role check, delete with cascade', async () => {
  const admin = h.service().auth.admin;
  const created = await admin.createUser({ email: 'staff@asoiu.edu.az', password: 'Muveqqeti2026!', email_confirm: true,
    user_metadata: { role: 'student', full_name: 'Kamran Hüseynov' }, app_metadata: { admin_role: 'super_admin', must_change_password: true } });
  assert.equal(created.error, null);
  const id = created.data.user!.id;
  assert.equal(created.data.user!.app_metadata.provider, 'email');
  const updated = await admin.updateUserById(id, { app_metadata: { must_change_password: false } });
  assert.deepEqual({ ...updated.data.user!.app_metadata, providers: undefined },
    { provider: 'email', providers: undefined, admin_role: 'super_admin', must_change_password: false });
  await exec(h.pool, `UPDATE profiles SET role = 'admin', admin_role = 'super_admin' WHERE id = ?`, [id]);
  const login = await h.anon().auth.signInWithPassword({ email: 'staff@asoiu.edu.az', password: 'Muveqqeti2026!' });
  const claims = decodeJwt(login.data.session!.access_token);
  const tx = await h.pool.getConnection();
  try {
    assert.equal(await currentAdminRole(tx, { role: 'authenticated', uid: id, claims }), 'super_admin');
    assert.equal(await currentAdminRole(tx, { role: 'authenticated', uid: id, claims: { ...claims, app_metadata: { admin_role: 'editor' } } }), null, 'a stale JWT role is refused');
  } finally { tx.release(); }
  assert.equal((await admin.deleteUser(id)).error, null);
  assert.equal(await one(h.pool, 'SELECT id FROM profiles WHERE id = ?', [id]), null);
  const anonAdmin = await h.anon().auth.admin.getUserById(id);
  assert.equal(anonAdmin.error?.message, 'User not allowed');
});

test('requests without an API key are refused like the old gateway', async () => {
  const res = await fetch(`${h.url}/auth/v1/settings`);
  assert.equal(res.status, 401);
  assert.equal((await res.json()).msg, 'No API key found in request');
  const settings = await (await fetch(`${h.url}/auth/v1/settings`, { headers: { apikey: h.config.anonKey } })).json();
  assert.equal(settings.external.email, true);
  assert.equal(settings.mailer_autoconfirm, true);
});

test('email change: links to the current and the new address, both must confirm', async () => {
  const client = h.anon();
  const { data, error } = await client.auth.signUp({ email: 'kohne@asoiu.edu.az', password: 'Sifre2026!', options: { data: { role: 'student', full_name: 'Köhnə Ünvan' } } });
  assert.equal(error, null);
  const before = h.mailer.outbox!.length;
  const changed = await client.auth.updateUser({ email: 'yeni@asoiu.edu.az' });
  assert.equal(changed.error, null);
  assert.equal(changed.data.user!.new_email, 'yeni@asoiu.edu.az');
  assert.equal(changed.data.user!.email, 'kohne@asoiu.edu.az', 'nothing changes before the links are confirmed');
  const mails = h.mailer.outbox!.slice(before);
  assert.deepEqual(mails.map(m => [m.to, m.kind]).sort(), [['kohne@asoiu.edu.az', 'email_change_current'], ['yeni@asoiu.edu.az', 'email_change']]);

  const first = await openLink(mails[0].link);
  assert.match(first.headers.get('location')!, /#message=Confirmation\+link\+accepted/);
  const second = await openLink(mails[1].link);
  assert.match(second.headers.get('location')!, /#access_token=/);
  const user = await h.service().auth.admin.getUserById(data.user!.id);
  assert.equal(user.data.user!.email, 'yeni@asoiu.edu.az');
  assert.equal(user.data.user!.new_email, undefined);

  const existing = await h.service().auth.admin.createUser({ email: 'tutulub@asoiu.edu.az', password: 'Sifre2026!', email_confirm: true,
    user_metadata: { role: 'student', full_name: 'Tutulmuş Ünvan' } });
  assert.equal(existing.error, null);
  const sent = h.mailer.outbox!.length;
  const taken = await client.auth.updateUser({ email: 'tutulub@asoiu.edu.az' });
  assert.equal(taken.error, null, 'an address in use is not revealed (#18)');
  assert.equal(h.mailer.outbox!.length, sent, 'and gets no link');
});

test('resend for an email change follows the 60-second cooldown and ignores unknown addresses', async () => {
  const client = h.anon();
  await client.auth.signUp({ email: 'ikinci@asoiu.edu.az', password: 'Sifre2026!', options: { data: { role: 'student', full_name: 'İkinci Ünvan' } } });
  assert.equal((await client.auth.updateUser({ email: 'ucuncu@asoiu.edu.az' })).error, null);
  const soon = await client.auth.resend({ type: 'email_change', email: 'ucuncu@asoiu.edu.az' });
  assert.equal(soon.error?.message, 'For security purposes, you can only request this after 60 seconds.');
  const before = h.mailer.outbox!.length;
  const unknown = await client.auth.resend({ type: 'email_change', email: 'hec-kim@asoiu.edu.az' });
  assert.equal(unknown.error, null, 'no hint whether an address is pending');
  assert.equal(h.mailer.outbox!.length, before);
});

test('email confirmation is on unless ENABLE_EMAIL_AUTOCONFIRM=true (audit 2026-11-12, H-01)', () => {
  const base = { MYSQL_URL: 'mysql://app@127.0.0.1/app', JWT_SECRET: 'j'.repeat(40), ANON_KEY: 'anon', SERVICE_ROLE_KEY: 'service', API_EXTERNAL_URL: 'http://127.0.0.1' };
  assert.equal(loadConfig(base as NodeJS.ProcessEnv).mailerAutoconfirm, false);
  assert.equal(loadConfig({ ...base, ENABLE_EMAIL_AUTOCONFIRM: 'false' } as NodeJS.ProcessEnv).mailerAutoconfirm, false);
  assert.equal(loadConfig({ ...base, ENABLE_EMAIL_AUTOCONFIRM: 'true' } as NodeJS.ProcessEnv).mailerAutoconfirm, true);
});
