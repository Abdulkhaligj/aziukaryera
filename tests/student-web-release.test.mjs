import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('company registration is presented without package marketing', () => {
  const app = read('student-web/assets/js/app.js');
  const index = read('student-web/index.html');
  assert.match(app, /Şirkət kimi qeydiyyat/);
  assert.match(app, /Şirkət profili yaradın və vakansiyalar paylaşın/);
  assert.doesNotMatch(app, /Free, Pro və Business paketləri/);
  assert.match(index, /app\.js\?v=20261028b/);
});

test('company profile guard gives safe fallback while preserving linked employer views', () => {
  const context = {
    VIEWS: { company: { dashboard: () => 'DASHBOARD', talent: () => 'TALENT POOL' } },
    Auth: { currentUser: () => ({ email: '<img src=x onerror=1>', status: 'pending' }) },
    Store: { state: { company: null } },
  };
  runInNewContext(read('student-web/assets/js/company-profile-guard.js'), context);
  const missing = context.VIEWS.company.dashboard();
  assert.match(missing, /təsdiq gözləyir/);
  assert.doesNotMatch(missing, /<img/);
  assert.match(missing, /&lt;img/);
  context.Store.state.company = { id: 'company-1' };
  assert.equal(context.VIEWS.company.dashboard(), 'DASHBOARD');
  assert.equal(context.VIEWS.company.talent(), 'TALENT POOL');
});

test('company packages are hidden but active Talent Pool access remains', () => {
  const appended = [];
  const context = {
    NAV: { company: [{ id: 'dashboard' }, { id: 'subscription' }, { id: 'talent' }] },
    VIEWS: { company: { subscription: () => 'old package screen', talent: () => 'TALENT POOL' } },
    Auth: { currentUser: () => ({ role: 'company', status: 'active' }), role: () => 'company' },
    Store: { mode: 'supabase', state: { session: { id: 'u1' }, company: { id: 'c1' }, view: 'subscription' } },
    companyCanUse: () => false,
    document: {
      createElement: () => ({}),
      head: { appendChild: element => appended.push(element) },
      addEventListener: () => {},
    },
  };
  runInNewContext(read('student-web/assets/js/company-package-hold.js'), context);
  assert.deepEqual(Array.from(context.NAV.company, item => item.id), ['dashboard', 'talent']);
  assert.equal(context.Store.state.view, 'dashboard');
  assert.equal(context.VIEWS.company.talent(), 'TALENT POOL');
  assert.equal(context.companyCanUse('candidate_search'), true);
  assert.equal(context.companyCanUse('admin'), false);
  assert.match(appended[0].textContent, /registration-plans/);
});
