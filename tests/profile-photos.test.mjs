import test from 'node:test';
import assert from 'node:assert/strict';
import { readSource as read } from './read-source.mjs';

test('approved profile photos are wired into network, header and employer candidate views', () => {
  const app = read('student-web/assets/js/app.js');
  const tools = read('student-web/assets/js/employer-tools.js');
  const photos = read('student-web/assets/js/profile-photos.js');
  assert.match(app, /class="avatar" data-avatar-id="\$\{esc\(p\.authorId\)\}"/);
  assert.match(app, /class="avatar sm" data-avatar-id="\$\{esc\(c\.authorId\)\}"/);
  assert.match(app, /class="avatar" data-avatar-id="\$\{esc\(user\.id\)\}"/);
  assert.match(app, /class="brandbox" data-avatar-id="\$\{esc\(s\.id\)\}"/);
  assert.match(app, /data-avatar-id="\$\{esc\(application\.studentId\)\}"/);
  assert.match(tools, /class="brandbox" data-avatar-id="'\+esc\(s\.id\)\+'"/);
  assert.match(photos, /rpc\('profile_avatar_paths'/);
  assert.match(photos, /createSignedUrls\(/);
  assert.doesNotMatch(photos, /localStorage|service_role/);
});

test('only the light theme ships', () => {
  const app = read('student-web/assets/js/app.js');
  const css = read('student-web/assets/css/styles.css');
  const index = read('student-web/index.html');
  assert.doesNotMatch(app, /data-act="theme"|setTheme\(/);
  assert.doesNotMatch(css, /prefers-color-scheme: dark|data-theme="dark"/);
  assert.match(index, /<meta name="color-scheme" content="light">/);
});

test('avatar paths come from a definer RPC limited to visible profiles', () => {
  const sql = read('supabase/migrations/20261104100000_profile_avatar_paths.sql');
  assert.match(sql, /create or replace function public\.profile_avatar_paths\(p_ids uuid\[\]\)/);
  assert.match(sql, /p\.id in \(select cp\.id from public\.candidate_profiles\(\) cp\)/);
  assert.match(sql, /revoke all on function public\.profile_avatar_paths\(uuid\[\]\) from public, anon;/);
});
