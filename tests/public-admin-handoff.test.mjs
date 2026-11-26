import test from 'node:test';
import assert from 'node:assert/strict';
import { readSource } from './read-source.mjs';
import { Script } from 'node:vm';

const read = readSource;

test('public landing keeps Awards and Mentor and shows no company logos', () => {
  const landing = read('student-web/assets/js/landing.js');
  const app = read('student-web/assets/js/app.js');
  const css = read('student-web/assets/css/landing.css');
  new Script(landing);
  assert.match(landing, /id="lp-mentor"/);
  assert.match(landing, /Mentor dəstəyi/);
  assert.match(landing, /mailto:career@asoiu\.edu\.az\?subject=ADNSU/);
  assert.match(landing, /id="lp-awards"/);
  assert.match(landing, /from\('company_awards'\)/);
  assert.match(landing, /\.eq\('published', true\)/);
  assert.match(landing, /awards: \(awards\.data \|\| \[\]\)/);
  assert.match(landing, /\['lp-mentor', 'Mentor'\]/);
  assert.match(landing, /\['lp-awards', 'Awards'\]/);
  // 2026-11-26: the user asked for the company logos to go. No logo strip,
  // no bundled brand logos, no award logo; companies show their initials.
  assert.doesNotMatch(landing, /lp-logos|logoTiles|lp-award-logo|<img/);
  assert.doesNotMatch(app, /COMPANY_LOGOS|assets\/logos\//);
  assert.match(app, /function companyMark\(name\) \{\n  return esc\(initials\(name\)\);/);
  assert.doesNotMatch(css, /\.lp-lgo|\.lp-logos/);
});

test('approval note action is private, persistent and separate from saving status', () => {
  const admin = read('components/admin-shell.tsx');
  const route = read('app/api/admin/approval-notes/route.ts');
  const css = read('app/globals.css');
  assert.match(admin, /resource === 'pending_jobs' && modal\.mode === 'edit'/);
  assert.match(admin, /Qeyd et<\/button>/);
  assert.match(admin, /Yadda saxla/);
  assert.match(admin, /onClick=\{recordApprovalNote\}/);
  assert.match(admin, /method: 'POST'/);
  assert.match(admin, /approvalNotes\.map\(note/);
  assert.match(route, /getAdminContext\(\)/);
  assert.match(route, /can\(context\.role, 'edit', 'pending_jobs'\)/);
  assert.match(route, /\.from\('admin_audit_logs'\)/);
  assert.match(route, /action: 'note'/);
  assert.match(route, /resource: 'pending_jobs'/);
  assert.match(route, /\.select\('id,title,actor_name,created_at'\)/);
  assert.doesNotMatch(route, /changes_requested|rejection_reason|UPDATE public\.jobs/);
  assert.match(css, /\.approvalNotes/);
});

test('student and employer scripts stay loaded with previous patch versions', () => {
  const index = read('student-web/index.html');
  assert.match(index, /app\.js\?v=[0-9a-z]+/);
  assert.match(index, /company-package-hold\.js\?v=20261028c/);
  assert.match(index, /aida-pow\.js\?v=20261124a/);
  assert.match(index, /aida-widget\.js\?v=20261124a/);
});
