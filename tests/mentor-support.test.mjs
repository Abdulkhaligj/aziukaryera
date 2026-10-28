import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('student Mentor dəstəyi page: request form, history and AI mentor are loaded', () => {
  const index = read('student-web/index.html');
  const mentor = read('student-web/assets/js/mentor.js');
  const ai = read('student-web/assets/js/mentor-ai.js');
  new Script(mentor); new Script(ai);
  assert.match(index, /assets\/js\/mentor\.js\?v=/);
  assert.match(index, /assets\/js\/mentor-ai\.js\?v=/);
  assert.match(index, /assets\/css\/mentor\.css\?v=/);
  /* mentor.js must load after app.js (needs NAV/VIEWS) */
  assert.ok(index.indexOf('assets/js/mentor.js') > index.indexOf('assets/js/app.js'));
  assert.match(mentor, /from\('mentor_requests'\)/);
  assert.match(mentor, /id:'mentor',label:'Mentor dəstəyi'/);
  assert.match(mentor, /VIEWS\.student\.mentor=viewMentorSupport/);
  assert.doesNotMatch(mentor + ai, /service_role|supabaseKey|localStorage\.setItem\('sb-/);
  /* AI mentor works without the AIDA widget exposing an API */
  assert.match(ai, /functions\.invoke\('aida-chat'/);
});

test('dashboard/profile mentor card and landing CTA open the platform flow, email stays as fallback', () => {
  const card = read('student-web/assets/js/student-profile-enhancements.js');
  const landing = read('student-web/assets/js/landing.js');
  assert.match(card, /data-act="go" data-view="mentor"/);
  assert.match(card, /mailto:career@asoiu\.edu\.az/);
  assert.match(landing, /lp-mentor-button" data-lp="auth">Mentora müraciət et/);
  assert.match(landing, /və ya e-poçtla yaz/);
});

test('admin panel manages mentor requests with role checks and validated statuses', () => {
  const types = read('lib/types.ts');
  const perms = read('lib/permissions.ts');
  const data = read('lib/admin-data.ts');
  const api = read('app/api/admin/[resource]/[id]/route.ts');
  const shell = read('components/admin-shell.tsx');
  assert.match(types, /'mentor_requests'/);
  assert.match(perms, /moderation = new Set<ResourceKey>\(\[[^\]]*'mentor_requests'/);
  assert.match(data, /from\('mentor_requests'\)/);
  assert.match(api, /resource === 'mentor_requests'/);
  assert.match(api, /\['pending', 'in_review', 'matched', 'completed', 'cancelled'\]\.includes\(state\)/);
  assert.match(api, /Mentor təyin etmək üçün mentorun adını yazın/);
  assert.match(shell, /key: 'mentor_requests', label: 'Mentor müraciətləri'/);
  assert.match(shell, /name="admin_note"/);
});
