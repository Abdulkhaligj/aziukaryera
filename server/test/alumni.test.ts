// Graduate verification (src/write/rules/alumni.ts, migration 0011): a
// graduate with a personal address sends diploma details, staff decide.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { ApiClient } from './helpers.ts';
import { exec, one, rows } from '../src/db.ts';
import { startHarness, type Harness } from './helpers.ts';

let h: Harness;
let graduate: ApiClient, student: ApiClient, company: ApiClient, manager: ApiClient, reviewer: ApiClient;
let graduateId: string, studentId: string, managerId: string;

async function signedIn(email: string, data: Record<string, unknown>) {
  const client = h.anon();
  const { data: res, error } = await client.auth.signUp({ email, password: 'Sifre2026!', options: { data } });
  if (error) throw error;
  return { client, id: res.user!.id };
}

async function staff(email: string, role: string) {
  const created = await h.service().auth.admin.createUser({ email, password: 'Sifre2026!', email_confirm: true,
    user_metadata: { role: 'student', full_name: `Staff ${role}` }, app_metadata: { admin_role: role } });
  if (created.error) throw created.error;
  await exec(h.pool, `UPDATE profiles SET role = 'admin', admin_role = ? WHERE id = ?`, [role, created.data.user!.id]);
  const client = h.anon();
  await client.auth.signInWithPassword({ email, password: 'Sifre2026!' });
  return { client, id: created.data.user!.id };
}

const profile = (id: string) => one<{ status: string; alumni_verified: number }>(h.pool, 'SELECT status, alumni_verified FROM profiles WHERE id = ?', [id]);
const request = (id: string) => one<{ status: string; diploma_number: string; reviewed_by: string | null; review_note: string | null }>(h.pool,
  'SELECT status, diploma_number, reviewed_by, review_note FROM alumni_verifications WHERE profile_id = ?', [id]);
const notes = (id: string, kind: string) => rows<{ title: string }>(h.pool, 'SELECT title FROM notifications WHERE profile_id = ? AND kind = ?', [id, kind]);
const details = (id: string, extra: Record<string, unknown> = {}) => ({
  profile_id: id, full_name: 'Orxan Məmmədov', diploma_number: 'aa 123456', graduation_year: 2019,
  faculty: 'İnformasiya texnologiyaları və idarəetmə', specialty: 'Kompüter mühəndisliyi', ...extra
});

before(async () => {
  h = await startHarness();
  ({ client: graduate, id: graduateId } = await signedIn('orxan.mammadov@gmail.com', { role: 'graduate', account_status: 'alumni', full_name: 'Orxan Məmmədov' }));
  ({ client: student, id: studentId } = await signedIn('aysel@asoiu.edu.az', { role: 'student', full_name: 'Aysel Məmmədova' }));
  ({ client: company } = await signedIn('hr@azercell.az', { role: 'company', company_name: 'Azercell', full_name: 'HR Azercell' }));
  ({ client: manager, id: managerId } = await staff('manager@asoiu.edu.az', 'manager'));
  ({ client: reviewer } = await staff('reviewer@asoiu.edu.az', 'reviewer'));
});
after(async () => { await h?.close(); });

test('a graduate with a personal address waits, and sends diploma details for the check', async () => {
  assert.deepEqual({ ...(await profile(graduateId)), alumni_verified: Number((await profile(graduateId))!.alumni_verified) }, { status: 'pending', alumni_verified: 0 });
  // Asking for approval right away does not work: the request is only "sent".
  const sent = await graduate.from('alumni_verifications').upsert(details(graduateId, { status: 'approved', reviewed_by: graduateId }), { onConflict: 'profile_id' }).select().single();
  assert.equal(sent.error, null);
  assert.equal(sent.data.status, 'submitted');
  assert.equal(sent.data.diploma_number, 'AA 123456');
  assert.equal(sent.data.reviewed_by, null);
  assert.equal((await profile(graduateId))!.status, 'pending');
  assert.equal((await notes(managerId, 'alumni_verification')).length, 1, 'staff see it in their queue');
  // Changed details go back to the queue.
  const again = await graduate.from('alumni_verifications').update({ diploma_number: 'AA 654321' }).eq('profile_id', graduateId).select().single();
  assert.equal(again.error, null);
  assert.equal((await request(graduateId))!.diploma_number, 'AA 654321');
});

test('details are checked, and only a graduate sends them for themselves', async () => {
  for (const [name, extra] of [['diploma', { diploma_number: '1' }], ['future year', { graduation_year: new Date().getUTCFullYear() + 1 }],
    ['no faculty', { faculty: ' ' }]] as const) {
    const res = await graduate.from('alumni_verifications').update(extra).eq('profile_id', graduateId);
    assert.notEqual(res.error, null, name);
  }
  assert.notEqual((await student.from('alumni_verifications').insert(details(studentId))).error, null, 'a student is not a graduate');
  assert.notEqual((await student.from('alumni_verifications').insert(details(graduateId))).error, null, 'not for someone else');
});

test('diploma details are seen only by their owner and by staff', async () => {
  assert.equal((await graduate.from('alumni_verifications').select('profile_id')).data!.length, 1);
  assert.equal((await student.from('alumni_verifications').select('profile_id')).data!.length, 0);
  assert.equal((await company.from('alumni_verifications').select('profile_id')).data!.length, 0);
  assert.equal((await h.anon().from('alumni_verifications').select('profile_id')).data?.length ?? 0, 0);
  assert.equal((await manager.from('alumni_verifications').select('profile_id')).data!.length, 1);
});

test('a reviewer cannot decide; a rejection keeps the account waiting and says why', async () => {
  await reviewer.from('alumni_verifications').update({ status: 'approved' }).eq('profile_id', graduateId);
  assert.equal((await request(graduateId))!.status, 'submitted', 'reviewers may not approve graduates');
  const rejected = await manager.from('alumni_verifications').update({ status: 'rejected', review_note: 'Diplom nömrəsi arxivdə tapılmadı' }).eq('profile_id', graduateId);
  assert.equal(rejected.error, null);
  const row = await request(graduateId);
  assert.equal(row!.status, 'rejected');
  assert.equal(row!.reviewed_by, managerId);
  assert.equal((await profile(graduateId))!.status, 'pending');
  assert.deepEqual((await notes(graduateId, 'alumni_rejected')).map(n => n.title), ['Məzun təsdiqi alınmadı']);
  // Corrected details go back to the queue and keep the staff note until the next decision.
  const resent = await graduate.from('alumni_verifications').update({ diploma_number: 'AB 777777' }).eq('profile_id', graduateId).select().single();
  assert.equal(resent.error, null);
  assert.equal(resent.data.status, 'submitted');
  assert.equal(resent.data.review_note, 'Diplom nömrəsi arxivdə tapılmadı');
});

test('an approval opens the account and marks the graduate verified; then the graduate cannot change it', async () => {
  const approved = await manager.from('alumni_verifications').update({ status: 'approved' }).eq('profile_id', graduateId);
  assert.equal(approved.error, null);
  const p = await profile(graduateId);
  assert.deepEqual({ status: p!.status, verified: Number(p!.alumni_verified) }, { status: 'active', verified: 1 });
  assert.deepEqual((await notes(graduateId, 'alumni_verified')).map(n => n.title), ['Məzun statusunuz təsdiqləndi']);
  const change = await graduate.from('alumni_verifications').update({ diploma_number: 'ZZ 000000' }).eq('profile_id', graduateId);
  assert.ok(change.error !== null || (await request(graduateId))!.diploma_number === 'AB 777777', 'approved details stay as approved');
  assert.equal((await request(graduateId))!.status, 'approved');
});

test('the "verified graduate" box on the profile closes an open request too', async () => {
  const { client, id } = await signedIn('leyla.q@gmail.com', { role: 'graduate', account_status: 'alumni', full_name: 'Leyla Qasımova' });
  assert.equal((await client.from('alumni_verifications').insert(details(id, { full_name: 'Leyla Qasımova', diploma_number: 'BB 1234' }))).error, null);
  const res = await manager.from('profiles').update({ status: 'active', alumni_verified: true }).eq('id', id);
  assert.equal(res.error, null);
  assert.equal((await request(id))!.status, 'approved');
});
