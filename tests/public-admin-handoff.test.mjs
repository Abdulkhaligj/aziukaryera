import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('public landing restores Awards, Mentor and real logo-only ticker', () => {
  const landing = read('student-web/assets/js/landing.js');
  const css = read('student-web/assets/css/landing.css');
  new Script(landing);
  assert.match(landing, /id="lp-mentor"/);
  assert.match(landing, /Mentor dəstəyi/);
  assert.match(landing, /mailto:career@asoiu\.edu\.az\?subject=ADNSU/);
  assert.match(landing, /id="lp-awards"/);
  assert.match(landing, /from\('company_awards'\)/);
  assert.match(landing, /\.eq\('published', true\)/);
  assert.match(landing, /awards: \(awards\.data \|\| \[\]\)/);
  const ticker = landing.split('<div class="lp-logos"')[1]?.split('</div></div>')[0] || '';
  assert.match(ticker, /\$\{logoTiles\}\$\{logoTilesCopy\}/);
  assert.doesNotMatch(ticker, /esc\(c\.name\)|companyMark\(c\.name\)/);
  assert.match(landing, /logoUrl: c\.logo_url \|\| ''/);
  assert.match(css, /\.lp-lgo img\s*\{/);
  assert.match(landing, /data-lp="scroll" data-to="lp-mentor"/);
  assert.match(landing, /data-lp="scroll" data-to="lp-awards"/);
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
  assert.match(index, /app\.js\?v=20261028b/);
  assert.match(index, /company-package-hold\.js\?v=20261028c/);
  assert.match(index, /aida-widget\.js\?v=20261028d/);
});
