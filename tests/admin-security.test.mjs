import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('admin role validation uses fixed role allow-list', () => {
  const login = read('app/login/actions.ts');
  const guard = read('lib/admin-data.ts');
  assert.match(login, /allowedAdminRoles\.includes\(role\)/);
  assert.match(login, /supabase\.auth\.signOut\(\)/);
  assert.match(guard, /adminRoles\.includes\(requestedRole as AdminRole\)/);
  assert.match(guard, /profile\.role !== 'admin' \|\| profile\.status !== 'active'/);
});

test('internal compliance page enforces authentication', () => {
  const page = read('app/admin/compliance/page.tsx');
  assert.match(page, /getAdminContext\(\)/);
  assert.match(page, /if \(!context\) redirect\('\/login'\)/);
  assert.match(page, /mustChangePassword/);
  assert.match(page, /Hüquqi təsdiq gözlənilir/);
});

test('company partnership update checks affected row', () => {
  const action = read('app/admin/partnerships/actions.ts');
  assert.match(action, /'super_admin','manager'/);
  assert.match(action, /\.select\('id'\)/);
  assert.match(action, /if \(error \|\| !data\)/);
});

test('admin routes carry no-store and anti-framing headers', () => {
  const config = read('next.config.mjs');
  for (const required of ['X-Frame-Options', 'X-Content-Type-Options', 'Referrer-Policy', 'Cache-Control', 'no-store', '/admin/:path*']) {
    assert.ok(config.includes(required), 'Missing security header or route: ' + required);
  }
});

test('public site is not bundled as a drop-in admin deployment', () => {
  const config = read('next.config.mjs');
  assert.doesNotMatch(config, /asoiu-career-main-v3/);
  assert.doesNotMatch(config, /student-web\/index\.html/);
});
