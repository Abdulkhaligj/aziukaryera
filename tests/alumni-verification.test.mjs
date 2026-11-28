import test from 'node:test';
import assert from 'node:assert/strict';
import { readSource as read } from './read-source.mjs';

test('a graduate waiting for approval sends diploma details and cannot apply yet', () => {
  const app = read('student-web/assets/js/app.js');
  const backend = read('student-web/assets/js/backend.js');
  const store = read('student-web/assets/js/store.js');
  assert.match(app, /function alumniPending\(\) \{\n  return isGraduateProfile\(\) && Auth\.currentUser\(\)\?\.status === 'pending';/);
  const apply = app.slice(app.indexOf('function applyModal('), app.indexOf('function applyModal(') + 600);
  assert.match(apply, /if \(alumniPending\(\)\) \{/, 'the apply button explains instead of failing at the server');
  assert.match(app, /return `\$\{alumniVerifyCard\(\)\}\n  <div class="welcome">/, 'the dashboard shows the verification card first');
  assert.match(app, /form\.dataset\.act !== 'alumni-verify-form'/);
  // Only the own row is read, and the details are sent as an upsert on the profile.
  assert.match(backend, /from\('alumni_verifications'\)\.select\('\*'\)\.eq\('profile_id', uid\)\.maybeSingle\(\)/);
  assert.match(backend, /from\('alumni_verifications'\)\.upsert\(\{\n\s+profile_id: session\.user\.id,/);
  const submit = backend.slice(backend.indexOf('async submitAlumniVerification('));
  assert.doesNotMatch(submit.slice(0, submit.indexOf('\n  },')), /status:/, 'the decision is never sent from the site');
  assert.match(store, /this\.state\.alumniVerification = p\.alumniVerification \|\| null;/);
});

test('staff see the diploma details and decide in the admin panel', () => {
  const shell = read('components/admin-shell.tsx');
  const data = read('lib/admin-data.ts');
  const route = read('app/api/admin/[resource]/[id]/route.ts');
  assert.match(data, /async function alumniRequests\(/);
  assert.doesNotMatch(data.slice(data.indexOf('async function alumniRequests(')), /alumni_verifications\([^)]*\)|\.in\(/, 'no embedded select or in() (university WAF)');
  assert.match(shell, /name="alumni_decision"/);
  assert.match(route, /body\.alumni_decision === 'approved'\) \{\n\s+body\.status = 'active';\n\s+body\.alumni_verified = 'true';/);
  assert.match(route, /from\('alumni_verifications'\)\n\s+\.update\(\{ status: 'rejected', review_note: note \|\| null \}\)\.eq\('profile_id', id\)/);
});
