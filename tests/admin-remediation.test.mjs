import test from 'node:test';
import assert from 'node:assert/strict';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { readSource } from './read-source.mjs';

function load(file, names, mocks = {}) {
  let source = readSource(file).replace(/^import .*;\r?\n/gm, '');
  source = stripTypeScriptTypes(source, { mode: 'strip' }).replace(/^export /gm, '');
  const context = { Response, console, ...mocks };
  vm.createContext(context);
  vm.runInContext(source + '\nglobalThis.subject = {' + names.join(',') + '};', context, { filename: file });
  return context.subject;
}

function fixture({ role = 'manager', authRole = role, mustChangePassword = false, status = 'active', authError = null, profileError = null } = {}) {
  const user = { id: 'actor', email: 'fixture@example.invalid', app_metadata: { admin_role: authRole, must_change_password: mustChangePassword } };
  const client = {
    auth: { getUser: async () => ({ data: { user }, error: authError }) },
    from: () => ({ select: columns => {
      assert.ok(columns.includes('admin_role'));
      return { eq: () => ({ single: async () => ({ data: { role: 'admin', admin_role: role, status, full_name: 'Fixture' }, error: profileError }) }) };
    } })
  };
  return { user, client, getAdminContext: load('lib/admin-data.ts', ['getAdminContext'], { createClient: async () => client }).getAdminContext };
}

test('current admin role is used; stale role and inactive accounts fail closed', async () => {
  assert.equal((await fixture().getAdminContext()).role, 'manager');
  assert.equal(await fixture({ role: 'reviewer', authRole: 'super_admin' }).getAdminContext(), null);
  assert.equal(await fixture({ status: 'rejected' }).getAdminContext(), null);
  assert.equal(await fixture({ authRole: 'unknown' }).getAdminContext(), null);
  assert.equal(await fixture({ authError: { message: 'offline' } }).getAdminContext(), null);
  assert.equal(await fixture({ profileError: { message: 'offline' } }).getAdminContext(), null);
});

test('mandatory-password session cannot call real resource POST; password page has explicit exception', async () => {
  const { getAdminContext } = fixture({ mustChangePassword: true });
  assert.equal(await getAdminContext(), null);
  assert.equal((await getAdminContext({ allowPasswordChange: true })).mustChangePassword, true);
  const NextResponse = { json: (body, options = {}) => new Response(JSON.stringify(body), options) };
  const { POST } = load('app/api/admin/[resource]/route.ts', ['POST'], { getAdminContext, NextResponse, resourceKeys: ['events'] });
  const result = await POST({ json: () => { throw Error('Body must not be read'); } }, { params: Promise.resolve({ resource: 'events' }) });
  assert.equal(result.status, 401);
});

test('audit storage failure is a logged warning, never a failed (retryable) saved change', async () => {
  const logged = [];
  const { writeAudit } = load('lib/admin-data.ts', ['writeAudit'], { console: { error: (...args) => logged.push(args.join(' ')) } });
  let attempts = 0;
  assert.equal(await writeAudit({ userId: 'actor', fullName: 'Fixture', db: { from: () => ({ insert: async () => { attempts++; return { error: { message: 'unavailable' } }; } }) } }, 'events', null, 'create', 'Fixture'), false);
  assert.equal(attempts, 1);
  assert.match(logged.join('\n'), /audit/);
  assert.equal(await writeAudit({ db: { from: () => ({ insert: async () => ({ error: null }) }) } }, 'events', null, 'create', 'Fixture'), true);
});

class Redirect extends Error { constructor(url) { super(url); this.url = url; } }
const redirect = url => { throw new Redirect(url); };

test('failed logout never produces a successful logout notice', async () => {
  const { logout } = load('app/login/actions.ts', ['logout'], { redirect, createClient: async () => ({ auth: { signOut: async () => ({ error: { message: 'network' } }) } }) });
  await assert.rejects(logout(), error => error.url.startsWith('/login?error='));
  const success = load('app/login/actions.ts', ['logout'], { redirect, createClient: async () => ({ auth: { signOut: async () => ({ error: null }) } }) });
  await assert.rejects(success.logout(), error => error.url.startsWith('/login?notice='));
});

test('password action uses trusted combined change and checks failure/refresh outcomes', async () => {
  const calls = [];
  let ok = false;
  const client = { auth: { getUser: async () => ({ data: { user: { id: 'actor' } } }), refreshSession: async () => { calls.push('refresh'); return { error: null }; } }, functions: { invoke: async (name, args) => { calls.push([name, args.body.action]); assert.equal(args.body.password, 'ChangedPass2026'); return { data: { ok }, error: null }; } } };
  const { changePassword } = load('app/account/password/actions.ts', ['changePassword'], { redirect, createClient: async () => client, getAdminContext: async () => ({ mustChangePassword: true }) });
  const form = new Map([['password', 'ChangedPass2026'], ['password2', 'ChangedPass2026']]);
  await assert.rejects(changePassword(form), error => error.url.startsWith('/account/password?error='));
  assert.equal(calls.length, 1);
  ok = true;
  await assert.rejects(changePassword(form), error => error.url.startsWith('/admin?notice='));
  assert.deepEqual(calls, [['admin-users', 'change_password'], ['admin-users', 'change_password'], 'refresh']);
});

test('streamed JSON is bounded and malformed/array bodies return controlled errors', async () => {
  const { crossSite } = load('lib/admin-input.ts', ['crossSite'], { URL });
  const { readAdminJson } = load('lib/request-body.ts', ['readAdminJson'], { TextDecoder, crossSite });
  const json = { 'content-type': 'application/json' };
  const request = (text, headers = json) => new Request('https://audit.invalid', { method: 'POST', body: text, headers });
  assert.equal((await readAdminJson(request('{"title":"Normal"}'))).body.title, 'Normal');
  assert.equal((await readAdminJson(request('{"title":"Same"}', { ...json, origin: 'https://audit.invalid' }))).body.title, 'Same');
  for (const body of ['{', '[]', 'null', '"string"']) assert.equal((await readAdminJson(request(body))).status, 400);
  assert.equal((await readAdminJson(request('{"a":"' + 'x'.repeat(200) + '"}'), 64)).status, 413);
  assert.equal((await readAdminJson(request('{}', { ...json, 'content-length': '1000' }), 64)).status, 413);
  // CSRF: another site's form or fetch, and non-JSON (simple form) bodies, are refused.
  assert.equal((await readAdminJson(request('{}', { ...json, origin: 'https://evil.invalid' }))).status, 403);
  assert.equal((await readAdminJson(request('{}', { ...json, 'sec-fetch-site': 'cross-site' }))).status, 403);
  assert.equal((await readAdminJson(request('{}', { 'content-type': 'text/plain' }))).status, 415);
  assert.equal((await readAdminJson(request('title=x', { 'content-type': 'application/x-www-form-urlencoded' }))).status, 415);
});
