import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('approval decision saves only status without replacing job content',()=>{
  const api=read('app/api/admin/[resource]/[id]/route.ts');
  const admin=read('components/admin-shell.tsx');
  assert.match(api,/key === 'pending_jobs' && body\.__action === 'approval_status'/);
  assert.match(api,/\.from\('jobs'\)\s*\.update\(update\)\.eq\('id', id\)/);
  assert.match(api,/if \(!data\) return NextResponse\.json/);
  const approvalOnly=api.split("if (key === 'pending_jobs' && body.__action === 'approval_status')")[1].split("if (people.has(key))")[0];
  assert.doesNotMatch(approvalOnly,/company_id|skills:|application_method|salary_min/);
  assert.match(approvalOnly,/rejection_reason/);
  assert.match(admin,/if \(resource === 'pending_jobs'\) return/);
  assert.match(admin,/payload\.__action = 'approval_status'/);
  assert.match(admin,/Yadda saxla/);
  assert.match(admin,/Qeyd et/);
});

test('student profile has real avatar file upload backed by private moderation',()=>{
  const js=read('student-web/assets/js/student-profile-enhancements.js');
  const css=read('student-web/assets/css/student-profile-enhancements.css');
  const index=read('student-web/index.html');
  new Script(js);
  assert.match(js,/data-photo-input type="file"/);
  assert.match(js,/accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(js,/storage\.from\('avatars'\)\.upload/);
  assert.match(js,/\.rpc\('avatar_submit',\{p_path:path\}\)/);
  assert.match(js,/createSignedUrl\(path,3600\)/);
  assert.match(js,/avatar_pending_path/);
  assert.match(js,/me\.role === 'student'/);
  assert.doesNotMatch(js,/localStorage|service_role|supabaseKey/);
  assert.match(css,/\.student-photo-card/);
  assert.match(index,/student-profile-enhancements\.js\?v=20261028a/);
});

test('mentor support is present within student dashboard and profile',()=>{
  const js=read('student-web/assets/js/student-profile-enhancements.js');
  assert.match(js,/view==='dashboard'\|\|view==='profile'/);
  assert.match(js,/Mentor dəstəyi/);
  assert.match(js,/mailto:career@asoiu\.edu\.az/);
  assert.match(js,/Mentora müraciət et/);
  const index=read('student-web/index.html');
  assert.match(index,/student-profile-enhancements\.css\?v=20261028a/);
});
