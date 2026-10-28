import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext, Script } from 'node:vm';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('company registration is presented without package marketing', () => {
  const app = read('student-web/assets/js/app.js');
  const index = read('student-web/index.html');
  assert.match(app, /Şirkət kimi qeydiyyat/);
  assert.match(app, /Şirkət profili yaradın və vakansiyalar paylaşın/);
  assert.doesNotMatch(app, /Free, Pro və Business paketləri/);
  assert.match(index, /app\.js\?v=20261028b/);
});

test('public landing omits employer pricing without removing vacancy or events routes', () => {
  const landing = read('student-web/assets/js/landing.js');
  const index = read('student-web/index.html');
  const hold = read('student-web/assets/js/company-package-hold.js');
  assert.doesNotMatch(landing, /id="lp-pricing"/);
  assert.doesNotMatch(landing, /Şirkət paketləri/);
  assert.doesNotMatch(landing, /class="plan-grid"/);
  assert.match(landing, /id="lp-events"/);
  assert.match(landing, /id="lp-jobs"/);
  assert.match(index, /landing\.js\?v=20261028d/);
  assert.match(index, /company-package-hold\.js\?v=20261028c/);
  assert.match(hold, /\.field:has\(\[data-act="auth-plan"\]\)/);
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

test('AIDA chat and polished icons load on all public/authenticated screens', () => {
  const index = read('student-web/index.html');
  const chat = read('student-web/assets/js/aida-widget.js');
  const icons = read('student-web/assets/js/ui-icons.js');
  const css = read('student-web/assets/css/ux-polish.css');
  const landing = read('student-web/assets/js/landing.js');
  // Compile real browser scripts so that malformed quotes do not reach production.
  new Script(chat);
  new Script(icons);
  assert.match(index, /aida-widget\.js\?v=20261028d/);
  assert.match(index, /ui-icons\.js\?v=20261028a/);
  assert.match(index, /ux-polish\.css\?v=20261028d/);
  assert.match(chat, /functions\.invoke\('aida-chat'/);
  assert.match(chat, /body: \{message:text,history\}/);
  assert.match(chat, /bubble\.textContent = value/);
  assert.match(chat, /messages\.slice\(-10\)/);
  assert.doesNotMatch(chat, /localStorage|sessionStorage|service_role|GEMINI_API_KEY/);
  assert.match(chat, /aida-launch/);
  assert.match(icons, /MutationObserver\(draw\)/);
  assert.match(icons, /notification-bell/);
  assert.match(icons, /account-choice-icon/);
  assert.doesNotMatch(landing, /aida-hero-cta|data-aida-open/);
  assert.doesNotMatch(chat, /aida-launch-symbol|const icon =/);
  assert.match(chat, /aida-avatar" aria-hidden="true">A/);
  assert.match(chat, /<b>AIDA<\/b>/);
  assert.doesNotMatch(css, /aida-launch-symbol/);
  assert.doesNotMatch(landing, /Şablonlu qurucu təqdim edilən kodla/);
  assert.match(css, /prefers-reduced-motion/);
});
