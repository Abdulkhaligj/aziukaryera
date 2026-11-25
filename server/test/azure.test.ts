// Sign-in with the university's Microsoft 365 accounts (src/auth/azure.ts),
// against a stand-in for Microsoft's token endpoint.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { one } from '../src/db.ts';
import { loadConfig } from '../src/config.ts';
import { codeFlowClient, startHarness, type Harness } from './helpers.ts';

const TENANT = '44774b4d-c635-4fa6-8746-23738dd53e9c';
const CLIENT = '0b7c9a52-3e1d-4f6a-9c8b-2d5e7f1a3b4c';
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
      const fine = req.method === 'POST' && req.url === `/${TENANT}/oauth2/v2.0/token` && form.get('client_secret') === 'test-secret'
        && form.get('grant_type') === 'authorization_code' && claims && claims !== 'fail';
      res.writeHead(fine ? 200 : 400, { 'content-type': 'application/json' });
      res.end(JSON.stringify(fine ? { token_type: 'Bearer', id_token: idToken(claims as Record<string, unknown>), access_token: 'unused' } : { error: 'invalid_grant' }));
    });
  });
  await new Promise<void>(resolve => fake.listen(0, '127.0.0.1', resolve));
  const address = fake.address();
  authority = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  h = await startHarness({ AZURE_CLIENT_ID: CLIENT, AZURE_CLIENT_SECRET: 'test-secret', AZURE_TENANT_ID: TENANT, AZURE_AUTHORITY: authority });
});
after(async () => { await h?.close(); fake?.close(); });

function memoryStorage() {
  const store = new Map<string, string>();
  return { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } };
}

/** Starts a sign-in as the site does (code flow, with a verifier in this
 *  browser's storage) and follows the API to Microsoft's sign-in page. */
async function start(role?: string) {
  const client = codeFlowClient(h.url, h.config.anonKey, memoryStorage());
  const { data, error } = await client.auth.signInWithOAuth({ provider: 'azure', options: {
    redirectTo: SITE, skipBrowserRedirect: true, queryParams: { prompt: 'select_account', ...(role ? { role } : {}) } } });
  assert.equal(error, null);
  const res = await fetch(data.url!, { redirect: 'manual' });
  assert.equal(res.status, 302);
  return { client, microsoft: new URL(res.headers.get('location')!) };
}

const now = () => Math.floor(Date.now() / 1000);
const claimsFor = (microsoft: URL, extra: Record<string, unknown> = {}) => ({
  aud: CLIENT, tid: TENANT, iss: `${authority}/${TENANT}/v2.0`, nonce: microsoft.searchParams.get('nonce'),
  exp: now() + 3600, nbf: now() - 10, iat: now() - 10, oid: 'a1b2c3', name: 'Aysel Məmmədova', preferred_username: 'aysel.mammadova@asoiu.edu.az', ...extra
});

/** Microsoft sends the browser back with a code; the API answers with where the site continues. */
let codes = 0;
async function finish(microsoft: URL, claims: Record<string, unknown> | 'fail', state = microsoft.searchParams.get('state')!) {
  const code = `ms-code-${++codes}`;
  answers.set(code, claims);
  const res = await fetch(`${h.url}/auth/v1/callback?code=${code}&state=${encodeURIComponent(state)}`, { redirect: 'manual' });
  assert.equal(res.status, 303);
  return new URL(res.headers.get('location')!);
}
const failure = (location: URL) => Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
const userCount = async (email: string) => (await one<{ n: number }>(h.pool, 'SELECT COUNT(*) AS n FROM auth_users WHERE email = ?', [email]))!.n;

test('the sign-in is offered, and goes to the university directory only', async () => {
  const settings = await (await fetch(`${h.url}/auth/v1/settings`, { headers: { apikey: h.config.anonKey } })).json();
  assert.equal(settings.external.azure, true);
  const { microsoft } = await start();
  assert.equal(`${microsoft.origin}${microsoft.pathname}`, `${authority}/${TENANT}/oauth2/v2.0/authorize`);
  const p = microsoft.searchParams;
  assert.equal(p.get('client_id'), CLIENT);
  assert.equal(p.get('response_type'), 'code');
  assert.equal(p.get('redirect_uri'), `${h.url}/auth/v1/callback`);
  assert.equal(p.get('scope'), 'openid email profile');
  assert.equal(p.get('domain_hint'), 'asoiu.edu.az');
  assert.equal(p.get('prompt'), 'select_account');
  assert.ok((p.get('nonce') ?? '').length >= 16 && (p.get('state') ?? '').includes('.'));
});

test('a browser without a PKCE verifier cannot start one', async () => {
  const res = await fetch(`${h.url}/auth/v1/authorize?provider=azure&redirect_to=${encodeURIComponent(SITE)}`, { redirect: 'manual' });
  assert.equal(res.status, 400);
  const other = await fetch(`${h.url}/auth/v1/authorize?provider=google&code_challenge=${'a'.repeat(43)}`, { redirect: 'manual' });
  assert.equal(other.status, 400, 'only Microsoft is on');
});

test('a new student signs in with Microsoft; the code works once, in that browser only', async () => {
  const { client, microsoft } = await start();
  const back = await finish(microsoft, claimsFor(microsoft));
  assert.equal(`${back.origin}${back.pathname}`, SITE.slice(0, -1) + '/');
  assert.equal(back.hash, '', 'no token in the address');
  const code = back.searchParams.get('code')!;
  // The API asked Microsoft with its own secret and the registered return address.
  const form = posted.at(-1)!;
  assert.equal(form.get('client_id'), CLIENT);
  assert.equal(form.get('redirect_uri'), `${h.url}/auth/v1/callback`);
  // Another browser, without this one's verifier, gets nothing for the code.
  const stranger = await fetch(`${h.url}/auth/v1/token?grant_type=pkce`, { method: 'POST',
    headers: { apikey: h.config.anonKey, 'content-type': 'application/json' }, body: JSON.stringify({ auth_code: code, code_verifier: 'x'.repeat(50) }) });
  assert.equal(stranger.status, 400);
  const { data, error } = await client.auth.exchangeCodeForSession(code);
  assert.notEqual(error, null, 'a wrong verifier used the code up');
  assert.equal(data.session, null);

  const again = await start();
  const second = await finish(again.microsoft, claimsFor(again.microsoft));
  const session = await again.client.auth.exchangeCodeForSession(second.searchParams.get('code')!);
  assert.equal(session.error, null);
  assert.equal(session.data.user!.email, 'aysel.mammadova@asoiu.edu.az');
  assert.equal(session.data.user!.app_metadata.provider, 'azure');
  const profile = await one<{ role: string; status: string; full_name: string; account_status: string }>(h.pool,
    'SELECT role, status, full_name, account_status FROM profiles WHERE id = ?', [session.data.user!.id]);
  assert.deepEqual(profile, { role: 'student', status: 'active', full_name: 'Aysel Məmmədova', account_status: 'student' });
  assert.equal((await again.client.auth.exchangeCodeForSession(second.searchParams.get('code')!)).error !== null, true, 'once');
  assert.equal(await userCount('aysel.mammadova@asoiu.edu.az'), 1);
});

test('a graduate picked on the sign-up form gets a graduate account', async () => {
  const { client, microsoft } = await start('graduate');
  const back = await finish(microsoft, claimsFor(microsoft, { preferred_username: 'Kamran.Aliyev@ASOIU.EDU.AZ', name: 'Kamran Əliyev' }));
  const { data, error } = await client.auth.exchangeCodeForSession(back.searchParams.get('code')!);
  assert.equal(error, null);
  assert.equal(data.user!.email, 'kamran.aliyev@asoiu.edu.az');
  const profile = await one<{ role: string; account_status: string; status: string }>(h.pool, 'SELECT role, account_status, status FROM profiles WHERE id = ?', [data.user!.id]);
  assert.deepEqual(profile, { role: 'graduate', account_status: 'alumni', status: 'active' });
});

test('an existing account with the same address is signed in, not duplicated', async () => {
  const created = await h.service().auth.admin.createUser({ email: 'nigar.huseynova@asoiu.edu.az', password: 'Sifre2026!', email_confirm: true,
    user_metadata: { role: 'graduate', account_status: 'alumni', full_name: 'Nigar Hüseynova' } });
  assert.equal(created.error, null);
  const { client, microsoft } = await start('student');
  const back = await finish(microsoft, claimsFor(microsoft, { preferred_username: 'nigar.huseynova@asoiu.edu.az' }));
  const { data, error } = await client.auth.exchangeCodeForSession(back.searchParams.get('code')!);
  assert.equal(error, null);
  assert.equal(data.user!.id, created.data.user!.id);
  assert.deepEqual(data.user!.app_metadata.providers, ['email', 'azure']);
  const profile = await one<{ role: string }>(h.pool, 'SELECT role FROM profiles WHERE id = ?', [data.user!.id]);
  assert.equal(profile!.role, 'graduate', 'the role picked now does not change an existing account');
  // The own password still works.
  assert.equal((await h.anon().auth.signInWithPassword({ email: 'nigar.huseynova@asoiu.edu.az', password: 'Sifre2026!' })).error, null);
  assert.equal(await userCount('nigar.huseynova@asoiu.edu.az'), 1);
});

test("an unconfirmed sign-up by someone else loses its password when the mailbox owner signs in", async () => {
  const stranger = await h.service().auth.admin.createUser({ email: 'leyla.qasimova@asoiu.edu.az', password: 'Yad-Sifre-2026', email_confirm: false,
    user_metadata: { role: 'student' } });
  assert.equal(stranger.error, null);
  const { client, microsoft } = await start();
  const back = await finish(microsoft, claimsFor(microsoft, { preferred_username: 'leyla.qasimova@asoiu.edu.az' }));
  const { data, error } = await client.auth.exchangeCodeForSession(back.searchParams.get('code')!);
  assert.equal(error, null);
  assert.equal(data.user!.id, stranger.data.user!.id);
  assert.ok(data.user!.email_confirmed_at, 'the directory confirmed the mailbox');
  assert.notEqual((await h.anon().auth.signInWithPassword({ email: 'leyla.qasimova@asoiu.edu.az', password: 'Yad-Sifre-2026' })).error, null);
});

test('tokens Microsoft did not issue for this app and this sign-in are refused', async () => {
  const cases: [string, Record<string, unknown>][] = [
    ['another directory', { tid: '99999999-9999-4999-8999-999999999999', iss: `${authority}/99999999-9999-4999-8999-999999999999/v2.0` }],
    ['another app', { aud: '00000000-0000-4000-8000-000000000000' }],
    ['another issuer', { iss: 'https://evil.example/v2.0' }],
    ['another sign-in (nonce)', { nonce: 'replayed' }],
    ['expired', { exp: now() - 3600 }],
    ['not valid yet', { nbf: now() + 3600 }]
  ];
  for (const [name, extra] of cases) {
    const { microsoft } = await start();
    const back = await finish(microsoft, claimsFor(microsoft, { preferred_username: 'rufat.babayev@asoiu.edu.az', ...extra }));
    assert.equal(back.searchParams.get('code'), null, name);
    assert.equal(failure(back).error_code, 'provider_error', name);
  }
  const { microsoft } = await start();
  assert.equal(failure(await finish(microsoft, 'fail')).error_code, 'provider_error', 'the token endpoint said no');
  assert.equal(await userCount('rufat.babayev@asoiu.edu.az'), 0);
});

test('only addresses of the university get in: guests and other domains are refused', async () => {
  for (const name of ['someone@gmail.com', 'someone_gmail.com#EXT#@asoiu.edu.az', 'x@asoiu.edu.az.evil.example', 'x@sub.asoiu.edu.az']) {
    const { microsoft } = await start();
    const back = await finish(microsoft, claimsFor(microsoft, { preferred_username: name, email: name }));
    assert.equal(back.searchParams.get('code'), null, name);
    const f = failure(back);
    assert.equal(f.error_code, 'email_address_not_authorized', name);
    assert.match(f.error_description, /@asoiu\.edu\.az/);
  }
  assert.equal((await one<{ n: number }>(h.pool, "SELECT COUNT(*) AS n FROM auth_users WHERE email LIKE '%gmail%' OR email LIKE '%evil%'"))!.n, 0);
});

test('a changed or foreign state, and a cancelled sign-in, go back without a code', async () => {
  const { microsoft } = await start();
  const state = microsoft.searchParams.get('state')!;
  const [payload, signature] = state.split('.');
  const changed = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), redirect: 'https://evil.example/' })).toString('base64url');
  const forged = await finish(microsoft, claimsFor(microsoft), `${changed}.${signature}`);
  assert.equal(`${forged.origin}/`, SITE, 'back to the site, not to the address written into the state');
  assert.equal(failure(forged).error_code, 'bad_oauth_state');
  const cancelled = await fetch(`${h.url}/auth/v1/callback?error=access_denied&error_description=AADSTS65004&state=${encodeURIComponent(state)}`, { redirect: 'manual' });
  const location = new URL(cancelled.headers.get('location')!);
  assert.equal(failure(location).error_code, 'access_denied');
  assert.doesNotMatch(location.hash, /AADSTS/, "Microsoft's own text is not passed on");
});

test('the redirect target is checked against the allow list', async () => {
  const client = codeFlowClient(h.url, h.config.anonKey, memoryStorage());
  const { data } = await client.auth.signInWithOAuth({ provider: 'azure', options: { redirectTo: 'https://evil.example/', skipBrowserRedirect: true } });
  const microsoft = new URL((await fetch(data.url!, { redirect: 'manual' })).headers.get('location')!);
  const back = await finish(microsoft, claimsFor(microsoft, { preferred_username: 'tural.isayev@asoiu.edu.az' }));
  assert.equal(back.origin, new URL(SITE).origin);
});

test('the Microsoft settings go together and name the directory by its ID', () => {
  const base = { JWT_SECRET: 'x'.repeat(32), API_EXTERNAL_URL: 'http://127.0.0.1', MYSQL_URL: 'mysql://x', ANON_KEY: 'a', SERVICE_ROLE_KEY: 's' };
  assert.equal(loadConfig(base as NodeJS.ProcessEnv).azure, null, 'off by default');
  assert.throws(() => loadConfig({ ...base, AZURE_CLIENT_ID: CLIENT } as NodeJS.ProcessEnv), /go together/);
  assert.throws(() => loadConfig({ ...base, AZURE_CLIENT_ID: CLIENT, AZURE_CLIENT_SECRET: 's', AZURE_TENANT_ID: 'asoiu.edu.az' } as NodeJS.ProcessEnv), /tenant\) ID/);
  assert.throws(() => loadConfig({ ...base, NODE_ENV: 'production', DATA_ENCRYPTION_KEY: 'k', SMTP_HOST: 'h', MODERATION_WEBHOOK_SECRET: 'm'.repeat(32),
    AZURE_CLIENT_ID: CLIENT, AZURE_CLIENT_SECRET: 's', AZURE_TENANT_ID: TENANT, AZURE_AUTHORITY: 'https://evil.example' } as NodeJS.ProcessEnv), /only outside production/);
  const on = loadConfig({ ...base, AZURE_CLIENT_ID: CLIENT.toUpperCase(), AZURE_CLIENT_SECRET: 's', AZURE_TENANT_ID: TENANT } as NodeJS.ProcessEnv).azure!;
  assert.deepEqual(on, { clientId: CLIENT, clientSecret: 's', tenantId: TENANT, authority: 'https://login.microsoftonline.com' });
});
