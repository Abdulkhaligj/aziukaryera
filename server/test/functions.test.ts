// The functions from server/functions, run by the API's gateway. Gemini
// is replaced by a stub at the fetch level (the functions run in this process),
// so the whole moderation chain is exercised: trigger → webhook after commit →
// content-moderation → moderation_claim / moderation_finish.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { exec, one, rows } from '../src/db.ts';
import { startHarness, type Harness } from './helpers.ts';

const SECRET = 'm'.repeat(40);
let h: Harness;
let student: SupabaseClient, studentId: string, studentToken: string;
let verdict = { verdict: 'allow', categories: [] as string[], reason: '' };
let geminiCalls = 0;

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith('https://generativelanguage.googleapis.com/')) {
    geminiCalls++;
    return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(verdict) }] } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return realFetch(input, init);
}) as typeof fetch;

const call = (name: string, body: unknown, headers: Record<string, string> = {}) => realFetch(`${h.url}/functions/v1/${name}`, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body)
});
const status = async (id: string) => (await one<{ moderation_status: string }>(h.pool, 'SELECT moderation_status FROM posts WHERE id = ?', [id]))!.moderation_status;

before(async () => {
  h = await startHarness({ MODERATION_WEBHOOK_SECRET: SECRET, GEMINI_API_KEY: 'test-key' });
  student = h.anon();
  const res = await student.auth.signUp({ email: 'fuad@asoiu.edu.az', password: 'Sifre2026!', options: { data: { role: 'student', full_name: 'Fuad Quliyev' } } });
  if (res.error) throw res.error;
  studentId = res.data.user!.id;
  studentToken = res.data.session!.access_token;
});
after(async () => { await h?.close(); globalThis.fetch = realFetch; });

test('the gateway: unknown functions, and the JWT check only for admin-users', async () => {
  const missing = await call('no-such-function', {});
  assert.equal(missing.status, 404);
  const noAuth = await call('admin-users', { action: 'list' });
  assert.equal(noAuth.status, 401);
  assert.deepEqual(await noAuth.json(), { code: 401, message: 'Missing authorization header' });
  assert.equal((await call('admin-users', {}, { authorization: 'Bearer nope' })).status, 401);
  const notAdmin = await call('admin-users', { action: 'list' }, { authorization: `Bearer ${studentToken}`, apikey: h.config.anonKey });
  assert.equal(notAdmin.status, 401, 'the function itself refuses a caller without an admin role');
  assert.deepEqual(await notAdmin.json(), { ok: false, error: 'İcazə yoxdur' });
});

test('content-moderation: secret, verdicts applied through the RPCs, usage recorded', async () => {
  const post = await student.from('posts').insert({ author_id: studentId, body: 'Hamıya uğurlar!' }).select('id').single();
  assert.equal((await call('content-moderation', { table: 'posts', id: post.data!.id })).status, 401, 'no webhook secret');
  verdict = { verdict: 'allow', categories: [], reason: '' };
  const allowed = await call('content-moderation', { table: 'posts', id: post.data!.id }, { 'x-moderation-secret': SECRET });
  assert.equal(allowed.status, 200);
  assert.deepEqual((await allowed.json()).status, 'visible');
  assert.equal(await status(post.data!.id), 'visible');
  assert.equal(Number((await one<{ n: number }>(h.pool, `SELECT COUNT(*) AS n FROM ai_usage WHERE task = 'content_moderation' AND success`))!.n), 1);

  const rude = await student.from('posts').insert({ author_id: studentId, body: 'Bu mətn bloklanacaq' }).select('id').single();
  verdict = { verdict: 'block', categories: ['insult'], reason: 'Mətndə təhqir var.' };
  const blocked = await call('content-moderation', { table: 'posts', id: rude.data!.id }, { 'x-moderation-secret': SECRET });
  assert.equal((await blocked.json()).status, 'hidden');
  assert.equal(await status(rude.data!.id), 'hidden');
  const note = await one<{ body: string }>(h.pool, `SELECT body FROM notifications WHERE profile_id = ? AND kind = 'content_hidden'`, [studentId]);
  assert.match(note!.body, /^Mətndə təhqir var\./);
  const repeat = await call('content-moderation', { table: 'posts', id: rude.data!.id }, { 'x-moderation-secret': SECRET });
  assert.deepEqual(await repeat.json(), { ok: true, skipped: true }, 'a decided post is not claimed again');
});

test('avatar moderation downloads the photo from storage and publishes it', async () => {
  const path = `${studentId}/${'b'.repeat(32)}.webp`;
  assert.equal((await student.storage.from('avatars').upload(path, new Blob([new Uint8Array(40)], { type: 'image/webp' }))).error, null);
  assert.equal((await student.rpc('avatar_submit', { p_path: path })).error, null);
  verdict = { verdict: 'allow', categories: [], reason: '' };
  const res = await call('content-moderation', { table: 'profiles', id: studentId }, { 'x-moderation-secret': SECRET });
  assert.equal((await res.json()).status, 'visible');
  assert.equal((await one<{ avatar_path: string }>(h.pool, 'SELECT avatar_path FROM profiles WHERE id = ?', [studentId]))!.avatar_path, path);
});

test('the database webhook calls the function after commit (pg_net replacement)', async () => {
  await exec(h.pool, `INSERT INTO private_moderation_webhook_config (singleton, endpoint, secret, enabled) VALUES (1, ?, ?, 1)`,
    [`${h.url}/functions/v1/content-moderation`, SECRET]);
  verdict = { verdict: 'allow', categories: [], reason: '' };
  const before = geminiCalls;
  const post = await student.from('posts').insert({ author_id: studentId, body: 'Avtomatik yoxlanış' }).select('id').single();
  for (let i = 0; i < 50 && await status(post.data!.id) === 'pending'; i++) await new Promise(r => setTimeout(r, 50));
  assert.equal(await status(post.data!.id), 'visible');
  assert.equal(geminiCalls, before + 1);
});

test('the gateway sets the client IP itself: forged IP headers do not open a new guest quota', async () => {
  await exec(h.pool, 'DELETE FROM private_ai_reservations WHERE profile_id IS NULL');
  // Caddy (the one trusted hop) appends the real address last; whatever the
  // client wrote before it, or in cf-connecting-ip / x-real-ip, is ignored.
  for (const ip of ['198.51.100.1', '198.51.100.2']) {
    await call('aida-chat', { message: 'Salam' }, { 'cf-connecting-ip': ip, 'x-real-ip': ip, 'x-forwarded-for': `${ip}, 203.0.113.9` });
  }
  const hashes = await rows<{ client_hash: string }>(h.pool, 'SELECT DISTINCT client_hash FROM private_ai_reservations WHERE profile_id IS NULL');
  assert.equal(hashes.length, 1, 'both guest calls count against the same address');
});
