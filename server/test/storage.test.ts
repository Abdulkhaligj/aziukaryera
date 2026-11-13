// /storage/v1 through the data client: the avatar, public-media and assistant-audio
// flows the portal, the admin panel and the moderation function use.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { decodeJwt } from 'jose';
import type { ApiClient } from './helpers.ts';
import { exec, one } from '../src/db.ts';
import { fileBytes, startHarness, type Harness } from './helpers.ts';

let h: Harness;
let student: ApiClient, other: ApiClient, admin: ApiClient;
let studentId: string, otherId: string, adminId: string;

async function signedIn(email: string, data: Record<string, unknown>) {
  const client = h.anon();
  const { data: res, error } = await client.auth.signUp({ email, password: 'Sifre2026!', options: { data } });
  if (error) throw error;
  return { client, id: res.user!.id };
}

const hex = (n: number) => n.toString(16).padStart(32, '0');
const image = (bytes = 64, type = 'image/webp') => new Blob([fileBytes(bytes, type)], { type });

before(async () => {
  h = await startHarness();
  ({ client: student, id: studentId } = await signedIn('nermin@asoiu.edu.az', { role: 'student', full_name: 'Nərmin Abbasova' }));
  ({ client: other, id: otherId } = await signedIn('kamran@asoiu.edu.az', { role: 'student', full_name: 'Kamran Rəhimov' }));
  const created = await h.service().auth.admin.createUser({ email: 'media@asoiu.edu.az', password: 'Sifre2026!', email_confirm: true,
    user_metadata: { role: 'student', full_name: 'Media Admin' }, app_metadata: { admin_role: 'super_admin' } });
  adminId = created.data.user!.id;
  await exec(h.pool, `UPDATE profiles SET role = 'admin', admin_role = 'super_admin' WHERE id = ?`, [adminId]);
  admin = h.anon();
  await admin.auth.signInWithPassword({ email: 'media@asoiu.edu.az', password: 'Sifre2026!' });
});
after(async () => { await h?.close(); });

test('avatar upload: own folder only, bucket size and type limits, no overwrite', async () => {
  const path = `${studentId}/${hex(1)}.webp`;
  const up = await student.storage.from('avatars').upload(path, image(), { contentType: 'image/webp', upsert: false });
  assert.equal(up.error, null);
  assert.deepEqual(up.data, { path, id: up.data!.id, fullPath: `avatars/${path}` });
  assert.ok(existsSync(join(h.config.storageDir, 'avatars', studentId, `${hex(1)}.webp`)), 'bytes are on disk');
  const row = await one<{ owner_id: string; size: number; mimetype: string }>(h.pool, 'SELECT owner_id, size, mimetype FROM storage_objects WHERE name = ?', [path]);
  assert.deepEqual(row, { owner_id: studentId, size: 64, mimetype: 'image/webp' });

  const again = await student.storage.from('avatars').upload(path, image());
  assert.equal(again.error?.message, 'The resource already exists');
  const foreign = await student.storage.from('avatars').upload(`${otherId}/${hex(2)}.webp`, image());
  assert.equal(foreign.error?.message, 'new row violates row-level security policy');
  const png = await student.storage.from('avatars').upload(`${studentId}/${hex(3)}.png`, image(64, 'image/png'));
  assert.equal(png.error?.message, 'mime type image/png is not supported');
  const fake = await student.storage.from('avatars').upload(`${studentId}/${hex(7)}.webp`, new Blob([new TextEncoder().encode('<html><script>alert(1)</script>')], { type: 'image/webp' }));
  assert.equal(fake.error?.message, 'The file content is not image/webp', 'the bytes must match the type (#56)');
  const big = await student.storage.from('avatars').upload(`${studentId}/${hex(4)}.webp`, image(1048577));
  assert.equal(big.error?.message, 'The object exceeded the maximum allowed size');
  assert.equal((await h.anon().storage.from('avatars').upload(`x/${hex(5)}.webp`, image())).error?.message, 'new row violates row-level security policy');
});

test('download, signed URLs and listing respect the select policy', async () => {
  const path = `${studentId}/${hex(1)}.webp`;
  const mine = await student.storage.from('avatars').download(path);
  assert.equal(mine.error, null);
  assert.equal(mine.data!.size, 64);
  // storage-js reports download errors without parsing the body; check the response itself.
  assert.equal((await other.storage.from('avatars').download(path)).data, null, 'a pending photo is private');
  const otherToken = (await other.auth.getSession()).data.session!.access_token;
  const raw = await fetch(`${h.url}/storage/v1/object/authenticated/avatars/${path}`, { headers: { apikey: h.config.anonKey, authorization: `Bearer ${otherToken}` } });
  assert.equal(raw.status, 404);
  assert.deepEqual(await raw.json(), { statusCode: '404', error: 'not_found', message: 'Object not found' });

  const signed = await student.storage.from('avatars').createSignedUrl(path, 60);
  assert.equal(signed.error, null);
  const fetched = await fetch(signed.data!.signedUrl);
  assert.equal(fetched.status, 200);
  assert.equal(fetched.headers.get('content-type'), 'image/webp');
  assert.equal(fetched.headers.get('x-content-type-options'), 'nosniff', 'audit 2026-11-13, #56');
  assert.match(fetched.headers.get('content-security-policy') || '', /sandbox/);
  assert.equal((await fetched.arrayBuffer()).byteLength, 64);
  const tampered = await fetch(signed.data!.signedUrl.replace(hex(1), hex(9)));
  assert.equal(tampered.status, 400);
  assert.equal((await other.storage.from('avatars').createSignedUrl(path, 60)).error?.message, 'Object not found');

  const many = await h.service().storage.from('avatars').createSignedUrls([path, `${studentId}/missing.webp`], 60);
  assert.equal(many.data![0].error, null);
  assert.ok(many.data![0].signedUrl);
  assert.equal(many.data![1].signedUrl, null);

  // #21: a URL signature is not a session token, and a URL dies with the version it signed.
  const signature = new URL(signed.data!.signedUrl).searchParams.get('token')!;
  const asSession = await fetch(`${h.url}/rest/v1/profiles?select=id`, { headers: { apikey: h.config.anonKey, authorization: `Bearer ${signature}` } });
  assert.equal(asSession.status, 401);
  const week = await student.storage.from('avatars').createSignedUrl(path, 365 * 24 * 3600);
  const { exp, iat } = decodeJwt(new URL(week.data!.signedUrl).searchParams.get('token')!);
  assert.equal(exp! - iat!, 7 * 24 * 3600, 'signed URLs live at most a week');
  await exec(h.pool, 'UPDATE storage_objects SET updated_at = updated_at + INTERVAL 1 SECOND WHERE bucket_id = ? AND name = ?', ['avatars', path]);
  assert.equal((await fetch(week.data!.signedUrl)).status, 404, 'a replaced file needs a new URL');

  const listed = await student.storage.from('avatars').list(studentId, { limit: 100 });
  assert.deepEqual(listed.data!.map(f => f.name), [`${hex(1)}.webp`]);
  const root = await student.storage.from('avatars').list('');
  assert.deepEqual(root.data!.map(f => [f.name, f.id]), [[studentId, null]], 'folders appear with a null id');
  assert.deepEqual((await other.storage.from('avatars').list(studentId)).data, []);
});

test('a photo the profile points to cannot be deleted; paths are never reused', async () => {
  const path = `${studentId}/${hex(1)}.webp`;
  assert.equal((await student.rpc('avatar_submit', { p_path: path })).error, null);
  const blocked = await student.storage.from('avatars').remove([path]);
  assert.deepEqual(blocked.data, [], 'the restrictive policy hides a referenced generation');
  assert.ok(existsSync(join(h.config.storageDir, 'avatars', studentId, `${hex(1)}.webp`)));

  assert.deepEqual((await student.rpc('avatar_remove')).data, { files: [path] });
  const removed = await student.storage.from('avatars').remove([path]);
  assert.deepEqual(removed.data!.map(f => f.name), [path]);
  assert.ok(!existsSync(join(h.config.storageDir, 'avatars', studentId, `${hex(1)}.webp`)), 'the file is gone after commit');
  const reused = await student.storage.from('avatars').upload(path, image());
  assert.equal(reused.error?.message, 'Avatar generation keys cannot be reused; upload a new random path');
});

test('shown avatars are readable by other users; the moderation function reads and removes files', async () => {
  const path = `${studentId}/${hex(6)}.webp`;
  assert.equal((await student.storage.from('avatars').upload(path, image(32))).error, null);
  await student.rpc('avatar_submit', { p_path: path });
  await exec(h.pool, `UPDATE profiles SET avatar_path = avatar_pending_path, avatar_pending_path = NULL WHERE id = ?`, [studentId]);
  assert.equal((await other.storage.from('avatars').download(path)).data?.size, 32, 'avatar_is_shown');
  const service = h.service();
  assert.equal((await service.storage.from('avatars').download(path)).data?.size, 32);
  assert.deepEqual((await service.storage.from('avatars').remove([path])).data!.map(f => f.name), [path], 'the service role bypasses the policies');
});

test('public-media: staff upload, anyone reads the public URL', async () => {
  const name = `ads/${hex(7)}.png`;
  assert.equal((await student.storage.from('public-media').upload(name, image(16, 'image/png'))).error?.message,
    'new row violates row-level security policy');
  const up = await admin.storage.from('public-media').upload(name, image(16, 'image/png'), { contentType: 'image/png', cacheControl: '31536000' });
  assert.equal(up.error, null);
  const url = admin.storage.from('public-media').getPublicUrl(name).data.publicUrl;
  const res = await fetch(url);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'max-age=31536000');
  assert.equal((await fetch(url.replace('public-media', 'avatars'))).status, 404, 'private buckets have no public URL');
});

test('assistant-audio: an admin\'s own folder, wav only', async () => {
  const name = `${adminId}/${hex(8)}.wav`;
  assert.equal((await admin.storage.from('assistant-audio').upload(name, image(16, 'audio/wav'), { contentType: 'audio/wav' })).error, null);
  assert.equal((await admin.storage.from('assistant-audio').upload(`${adminId}/x.mp3`, image(8, 'audio/mpeg'))).error?.message,
    'mime type audio/mpeg is not supported');
  assert.equal((await student.storage.from('assistant-audio').upload(`${studentId}/a.wav`, image(16, 'audio/wav'))).error?.message,
    'new row violates row-level security policy');
  const service = h.service();
  assert.equal((await service.storage.from('assistant-audio').download(name)).data?.size, 16);
});

test('public-media (audit 2026-11-12): editors upload, only super admins and managers replace or delete', async () => {
  const staffClient = async (email: string, role: string) => {
    const made = await h.service().auth.admin.createUser({ email, password: 'Sifre2026!', email_confirm: true,
      user_metadata: { role: 'student', full_name: `Staff ${role}` }, app_metadata: { admin_role: role } });
    await exec(h.pool, `UPDATE profiles SET role = 'admin', admin_role = ? WHERE id = ?`, [role, made.data.user!.id]);
    const client = h.anon();
    await client.auth.signInWithPassword({ email, password: 'Sifre2026!' });
    return client;
  };
  const editor = await staffClient('editor@asoiu.edu.az', 'editor');
  const reviewer = await staffClient('yoxlayici@asoiu.edu.az', 'reviewer');
  const name = `site/${hex(77)}.png`;
  assert.equal((await reviewer.storage.from('public-media').upload(name, image(16, 'image/png'), { contentType: 'image/png' })).error?.message,
    'new row violates row-level security policy');
  assert.equal((await editor.storage.from('public-media').upload(name, image(16, 'image/png'), { contentType: 'image/png' })).error, null);
  assert.equal((await editor.storage.from('public-media').update(name, image(20, 'image/png'), { contentType: 'image/png' })).error?.message,
    'new row violates row-level security policy');
  const removed = await editor.storage.from('public-media').remove([name]);
  assert.deepEqual(removed.data, [], 'an editor cannot delete');
  assert.equal((await admin.storage.from('public-media').remove([name])).data?.length, 1);
});
