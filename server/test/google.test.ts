// Sign-in with a Google account (src/auth/google.ts), against a stand-in for
// Google's token endpoint.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { one } from '../src/db.ts';
import { loadConfig } from '../src/config.ts';
import { codeFlowClient, startHarness, type Harness } from './helpers.ts';

const CLIENT = '123456789012-abcdef0123456789abcdef0123456789.apps.googleusercontent.com';
const SITE = 'https://asoiu-career.vercel.app/';

let h: Harness;
let fake: Server;
let authority: string;
/** What the stand-in token endpoint answers for each code. */
const answers = new Map<string, Record<string, unknown> | 'fail'>();
const posted: URLSearchParams[] = [];

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const idToken = (claims: Record<string, unknown>) => `${b64({ alg: 'RS256', typ: 'JWT', kid: 'k' })}.${b64(claims)}.c2lnbmF0dXJl`;

before(async () => {
  fake = createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const form = new URLSearchParams(body);
      posted.push(form);
      const claims = answers.get(form.get('code') ?? '');
      const fine = req.method === 'POST' && req.url === '/token' && form.get('client_secret') === 'test-secret'
        && form.get('grant_type') === 'authorization_code' && claims && claims !== 'fail';
      res.writeHead(fine ? 200 : 400, { 'content-type': 'application/json' });
      res.end(JSON.stringify(fine ? { token_type: 'Bearer', id_token: idToken(claims as Record<string, unknown>), access_token: 'unused' } : { error: 'invalid_grant' }));
    });
  });
  await new Promise<void>(resolve => fake.listen(0, '127.0.0.1', resolve));
  const address = fake.address();
  authority = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  h = await startHarness({ GOOGLE_CLIENT_ID: CLIENT, GOOGLE_CLIENT_SECRET: 'test-secret', GOOGLE_AUTHORITY: authority });
});
after(async () => { await h?.close(); fake?.close(); });

function memoryStorage() {
  const store = new Map<string, string>();
  return { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } };
}

/** Starts a sign-in as the site does and follows the API to Google's page. */
async function start(role?: string) {
  const client = codeFlowClient(h.url, h.config.anonKey, memoryStorage());
  const { data, error } = await client.auth.signInWithOAuth({ provider: 'google', options: {
    redirectTo: SITE, skipBrowserRedirect: true, queryParams: { prompt: 'select_account', ...(role ? { role } : {}) } } });
  assert.equal(error, null);
  const res = await fetch(data.url!, { redirect: 'manual' });
  assert.equal(res.status, 302);
  return { client, google: new URL(res.headers.get('location')!) };
}

const now = () => Math.floor(Date.now() / 1000);
const claimsFor = (google: URL, extra: Record<string, unknown> = {}) => ({
  aud: CLIENT, iss: authority, nonce: google.searchParams.get('nonce'), sub: '1098765432101234567890',
  exp: now() + 3600, iat: now() - 10, email: 'orxan.mammadov@gmail.com', email_verified: true, name: 'Orxan Məmmədov', ...extra
});

let codes = 0;
async function finish(google: URL, claims: Record<string, unknown> | 'fail', state = google.searchParams.get('state')!) {
  const code = `4/google-code-${++codes}`;
  answers.set(code, claims);
  // Google adds its own parameters (scope with addresses in it, authuser, prompt).
  const extra = '&scope=email+profile+https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fuserinfo.email+openid&authuser=0&prompt=consent';
  const res = await fetch(`${h.url}/auth/v1/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}${extra}`, { redirect: 'manual' });
  assert.equal(res.status, 303);
  return new URL(res.headers.get('location')!);
}
const failure = (location: URL) => Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
const userCount = async (email: string) => (await one<{ n: number }>(h.pool, 'SELECT COUNT(*) AS n FROM auth_users WHERE email = ?', [email]))!.n;

test('the Google sign-in is offered and goes to Google with this app and a fresh nonce', async () => {
  const settings = await (await fetch(`${h.url}/auth/v1/settings`, { headers: { apikey: h.config.anonKey } })).json();
  assert.equal(settings.external.google, true);
  assert.equal(settings.external.azure, false);
  const { google } = await start();
  assert.equal(`${google.origin}${google.pathname}`, `${authority}/o/oauth2/v2/auth`);
  const p = google.searchParams;
  assert.equal(p.get('client_id'), CLIENT);
  assert.equal(p.get('response_type'), 'code');
  assert.equal(p.get('redirect_uri'), `${h.url}/auth/v1/callback`);
  assert.equal(p.get('scope'), 'openid email profile');
  assert.equal(p.get('prompt'), 'select_account');
  assert.equal(p.get('hd'), null, 'any Google account, not one domain');
  assert.ok((p.get('nonce') ?? '').length >= 16 && (p.get('state') ?? '').includes('.'));
  const azure = await fetch(`${h.url}/auth/v1/authorize?provider=azure&code_challenge=${'a'.repeat(43)}`, { redirect: 'manual' });
  assert.equal(azure.status, 400, 'only Google is on');
});

test('an existing account with the Gmail address signs in with Google, in that browser only', async () => {
  const created = await h.service().auth.admin.createUser({ email: 'orxan.mammadov@gmail.com', password: 'Sifre2026!', email_confirm: true,
    user_metadata: { role: 'graduate', account_status: 'alumni', full_name: 'Orxan Məmmədov' } });
  assert.equal(created.error, null);
  const { client, google } = await start();
  const back = await finish(google, claimsFor(google));
  assert.equal(back.hash, '', 'no token in the address');
  const code = back.searchParams.get('code')!;
  const form = posted.at(-1)!;
  assert.equal(form.get('client_id'), CLIENT);
  assert.equal(form.get('redirect_uri'), `${h.url}/auth/v1/callback`);
  const stranger = await fetch(`${h.url}/auth/v1/token?grant_type=pkce`, { method: 'POST',
    headers: { apikey: h.config.anonKey, 'content-type': 'application/json' }, body: JSON.stringify({ auth_code: code, code_verifier: 'x'.repeat(50) }) });
  assert.equal(stranger.status, 400);

  const again = await start();
  const second = await finish(again.google, claimsFor(again.google, { email: 'Orxan.Mammadov@Gmail.com' }));
  const { data, error } = await again.client.auth.exchangeCodeForSession(second.searchParams.get('code')!);
  assert.equal(error, null);
  assert.equal(data.user!.id, created.data.user!.id);
  assert.deepEqual(data.user!.app_metadata.providers, ['email', 'google']);
  assert.equal((await again.client.auth.exchangeCodeForSession(second.searchParams.get('code')!)).error !== null, true, 'once');
  assert.equal((await h.anon().auth.signInWithPassword({ email: 'orxan.mammadov@gmail.com', password: 'Sifre2026!' })).error, null, 'own password still works');
  assert.equal(await userCount('orxan.mammadov@gmail.com'), 1);
  void client;
});

test('a graduate picked on the sign-up form gets a graduate account that staff review', async () => {
  const { client, google } = await start('graduate');
  const back = await finish(google, claimsFor(google, { email: 'sevinc.aliyeva@gmail.com', name: 'Sevinc Əliyeva' }));
  const { data, error } = await client.auth.exchangeCodeForSession(back.searchParams.get('code')!);
  assert.equal(error, null);
  assert.equal(data.user!.app_metadata.provider, 'google');
  const profile = await one<{ role: string; account_status: string; status: string; full_name: string; alumni_verified: number }>(h.pool,
    'SELECT role, account_status, status, full_name, alumni_verified FROM profiles WHERE id = ?', [data.user!.id]);
  assert.deepEqual({ ...profile, alumni_verified: Number(profile!.alumni_verified) },
    { role: 'graduate', account_status: 'alumni', status: 'pending', full_name: 'Sevinc Əliyeva', alumni_verified: 0 });
});

test('a Gmail address without an account gets none as a student or from the sign-in tab', async () => {
  for (const role of [undefined, 'student', 'master_student']) {
    const { google } = await start(role);
    const back = await finish(google, claimsFor(google, { email: 'yeni.telebe@gmail.com' }));
    assert.equal(back.searchParams.get('code'), null, String(role));
    const f = failure(back);
    assert.equal(f.error_code, 'signup_disabled', String(role));
    assert.match(f.error_description, /Outlook/);
  }
  assert.equal(await userCount('yeni.telebe@gmail.com'), 0);
});

test('university addresses and unconfirmed Google addresses are refused', async () => {
  for (const email of ['aysel.mammadova@asoiu.edu.az', 'AYSEL@ASOIU.EDU.AZ']) {
    const { google } = await start('graduate');
    const back = await finish(google, claimsFor(google, { email }));
    const f = failure(back);
    assert.equal(f.error_code, 'email_address_not_authorized', email);
    assert.match(f.error_description, /Outlook/);
  }
  for (const email_verified of [false, 'false', undefined]) {
    const { google } = await start('graduate');
    const back = await finish(google, claimsFor(google, { email: 'tesdiqsiz@gmail.com', email_verified }));
    assert.equal(failure(back).error_code, 'email_address_not_authorized', String(email_verified));
  }
  for (const email of ['', 'no-at-sign', 'x"y@gmail.com', 'x@localhost']) {
    const { google } = await start('graduate');
    assert.equal(failure(await finish(google, claimsFor(google, { email }))).error_code, 'email_address_not_authorized', email);
  }
  assert.equal((await one<{ n: number }>(h.pool, "SELECT COUNT(*) AS n FROM auth_users WHERE email LIKE 'tesdiqsiz%' OR email LIKE 'aysel%'"))!.n, 0);
});

test('tokens Google did not issue for this app and this sign-in are refused', async () => {
  const cases: [string, Record<string, unknown>][] = [
    ['another app', { aud: '999-other.apps.googleusercontent.com' }],
    ['another issuer', { iss: 'https://evil.example' }],
    ['another sign-in (nonce)', { nonce: 'replayed' }],
    ['expired', { exp: now() - 3600 }],
    ['no subject', { sub: '' }]
  ];
  for (const [name, extra] of cases) {
    const { google } = await start('graduate');
    const back = await finish(google, claimsFor(google, { email: 'rufat.babayev@gmail.com', ...extra }));
    assert.equal(back.searchParams.get('code'), null, name);
    assert.equal(failure(back).error_code, 'provider_error', name);
  }
  const { google } = await start('graduate');
  assert.equal(failure(await finish(google, 'fail')).error_code, 'provider_error', 'the token endpoint said no');
  assert.equal(await userCount('rufat.babayev@gmail.com'), 0);
});

test('a changed state and a cancelled Google sign-in go back without a code', async () => {
  const { google } = await start('graduate');
  const state = google.searchParams.get('state')!;
  const [payload, signature] = state.split('.');
  const changed = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), provider: 'azure' })).toString('base64url');
  const forged = await finish(google, claimsFor(google), `${changed}.${signature}`);
  assert.equal(failure(forged).error_code, 'bad_oauth_state');
  const cancelled = await fetch(`${h.url}/auth/v1/callback?error=access_denied&error_description=user_denied_google&state=${encodeURIComponent(state)}`, { redirect: 'manual' });
  const location = new URL(cancelled.headers.get('location')!);
  assert.equal(failure(location).error_code, 'access_denied');
  assert.doesNotMatch(location.hash, /user_denied_google/, "Google's own text is not passed on");
});

test('the Google settings go together and name a Google OAuth client', () => {
  const base = { JWT_SECRET: 'x'.repeat(32), API_EXTERNAL_URL: 'http://127.0.0.1', MYSQL_URL: 'mysql://x', ANON_KEY: 'a', SERVICE_ROLE_KEY: 's' };
  assert.equal(loadConfig(base as NodeJS.ProcessEnv).google, null, 'off by default');
  assert.throws(() => loadConfig({ ...base, GOOGLE_CLIENT_ID: CLIENT } as NodeJS.ProcessEnv), /go together/);
  assert.throws(() => loadConfig({ ...base, GOOGLE_CLIENT_ID: 'my-app', GOOGLE_CLIENT_SECRET: 's' } as NodeJS.ProcessEnv), /apps\.googleusercontent\.com/);
  assert.throws(() => loadConfig({ ...base, NODE_ENV: 'production', DATA_ENCRYPTION_KEY: 'k', SMTP_HOST: 'h', MODERATION_WEBHOOK_SECRET: 'm'.repeat(32),
    GOOGLE_CLIENT_ID: CLIENT, GOOGLE_CLIENT_SECRET: 's', GOOGLE_AUTHORITY: 'https://evil.example' } as NodeJS.ProcessEnv), /only outside production/);
  const on = loadConfig({ ...base, GOOGLE_CLIENT_ID: CLIENT, GOOGLE_CLIENT_SECRET: 's' } as NodeJS.ProcessEnv).google!;
  assert.deepEqual(on, { clientId: CLIENT, clientSecret: 's', authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token', issuers: ['https://accounts.google.com', 'accounts.google.com'] });
});
