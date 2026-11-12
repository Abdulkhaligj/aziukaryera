import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { exec, one } from '../src/db.ts';
import { startHarness, type Harness } from './helpers.ts';

let h: Harness;
let student: SupabaseClient, otherStudent: SupabaseClient, company: SupabaseClient, admin: SupabaseClient, editor: SupabaseClient;
let studentId: string, otherId: string, companyUser: string, companyId: string, openJob: string, pendingJob: string;

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
  return client;
}

before(async () => {
  h = await startHarness();
  ({ client: student, id: studentId } = await signedIn('telebe@asoiu.edu.az', { role: 'student', full_name: 'Nigar Quliyeva', major_name: 'Neft mühəndisliyi' }));
  ({ client: otherStudent, id: otherId } = await signedIn('diger@asoiu.edu.az', { role: 'student', full_name: 'Orxan Əliyev' }));
  ({ client: company, id: companyUser } = await signedIn('hr@socar.az', { role: 'company', company_name: 'SOCAR', full_name: 'HR SOCAR' }));
  companyId = (await one<{ id: string }>(h.pool, 'SELECT id FROM companies WHERE owner_id = ?', [companyUser]))!.id;
  await exec(h.pool, `UPDATE companies SET status = 'active' WHERE id = ?`, [companyId]);
  await exec(h.pool, `UPDATE profiles SET status = 'active' WHERE id = ?`, [companyUser]);
  openJob = '33333333-3333-4333-8333-333333333333';
  pendingJob = '44444444-4444-4444-8444-444444444444';
  // Through the API, so the vacancy quota counts them (raw SQL would skip it).
  const today = new Date().toISOString().slice(0, 10);
  const later = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const jobs = await h.service().from('jobs').insert([
    { id: openJob, company_id: companyId, title: 'Qazma mühəndisi', type: 'is', status: 'approved', deadline: today, location: 'Bakı' },
    { id: pendingJob, company_id: companyId, title: 'Gizli vakansiya', type: 'tecrube', status: 'pending', deadline: later, location: '' }]);
  if (jobs.error) throw jobs.error;
  admin = await staff('admin@asoiu.edu.az', 'super_admin');
  editor = await staff('editor@asoiu.edu.az', 'editor');
});
after(async () => { await h?.close(); });

test('anonymous visitors see only published jobs, with the company embedded', async () => {
  const { data, error } = await h.anon().from('jobs').select('id,title,companies(name)').order('title');
  assert.equal(error, null);
  assert.deepEqual(data, [{ id: openJob, title: 'Qazma mühəndisi', companies: { name: 'SOCAR' } }]);
});

test('the company owner sees its own pending job; exact counts and HEAD work', async () => {
  const { data, count, error } = await company.from('jobs').select('id,status', { count: 'exact' }).order('status', { ascending: false });
  assert.equal(error, null);
  assert.equal(count, 2);
  // ENUM columns sort by declaration order in MySQL, as Postgres enums do.
  assert.deepEqual(data!.map(j => j.status), ['approved', 'pending']);
  const head = await h.anon().from('jobs').select('id', { count: 'exact', head: true });
  assert.equal(head.count, 1);
  assert.equal(head.data, null);
});

test('single and maybeSingle follow PostgREST: 406 for no row, null for maybe', async () => {
  const single = await h.anon().from('jobs').select('id').eq('id', pendingJob).single();
  assert.equal(single.error?.code, 'PGRST116');
  const maybe = await h.anon().from('jobs').select('id').eq('id', pendingJob).maybeSingle();
  assert.equal(maybe.error, null);
  assert.equal(maybe.data, null);
});

test('a student applies to an open job; a closed one is refused by the policy', async () => {
  const ok = await student.from('applications').insert({ job_id: openJob, student_id: studentId }).select('id,status').single();
  assert.equal(ok.error, null);
  assert.ok(ok.data!.id);
  const refused = await student.from('applications').insert({ job_id: pendingJob, student_id: studentId });
  assert.equal(refused.error?.code, '42501');
  assert.match(refused.error!.message, /row-level security/);
  const forOther = await student.from('applications').insert({ job_id: openJob, student_id: otherId });
  assert.equal(forOther.error?.code, '42501', 'cannot apply on behalf of someone else');
});

test('the company sees its applicant through the named foreign key; other students do not', async () => {
  const { data, error } = await company.from('applications').select('id,profiles!applications_student_id_fkey(full_name),jobs(title)');
  assert.equal(error, null);
  // Untyped client: embedded many-to-one rows arrive as objects.
  assert.deepEqual((data as unknown as { profiles: { full_name: string }; jobs: { title: string } }[]).map(a => [a.profiles.full_name, a.jobs.title]), [['Nigar Quliyeva', 'Qazma mühəndisi']]);
  const theirs = await otherStudent.from('applications').select('id');
  assert.deepEqual(theirs.data, []);
});

test('profiles are private to their owner', async () => {
  const mine = await student.from('profiles').select('full_name').eq('id', studentId).single();
  assert.equal(mine.data?.full_name, 'Nigar Quliyeva');
  const other = await student.from('profiles').select('full_name').eq('id', otherId);
  assert.deepEqual(other.data, []);
  const anon = await h.anon().from('profiles').select('id');
  assert.deepEqual(anon.data, []);
});

test('staff permissions follow admin_can: the editor may update but not delete jobs', async () => {
  const update = await editor.from('jobs').update({ title: 'Gizli vakansiya (redaktə)' }).eq('id', pendingJob).select('title').single();
  assert.equal(update.error, null);
  assert.equal(update.data!.title, 'Gizli vakansiya (redaktə)');
  const del = await editor.from('jobs').delete().eq('id', pendingJob).select('id');
  assert.equal(del.error, null);
  assert.deepEqual(del.data, [], 'restrictive staff policy hides the row from DELETE');
  assert.ok(await one(h.pool, 'SELECT id FROM jobs WHERE id = ?', [pendingJob]));
  const adminDelete = await admin.from('jobs').delete().eq('id', pendingJob).select('id');
  assert.deepEqual(adminDelete.data, [{ id: pendingJob }]);
});

test('anonymous inserts are refused with 401 and the RLS message', async () => {
  const { error, status } = await h.anon().from('jobs').insert({ company_id: companyId, title: 'Spam', type: 'is' });
  assert.equal(status, 401);
  assert.equal(error?.code, '42501');
});

test('database errors map to Postgres codes and messages', async () => {
  const duplicate = await student.from('applications').insert({ job_id: openJob, student_id: studentId });
  assert.equal(duplicate.error?.code, '23505');
  assert.match(duplicate.error!.message, /duplicate key value violates unique constraint/);
  const unknown = await student.from('applications').insert({ job_id: openJob, student_id: studentId, nope: 1 } as never);
  assert.equal(unknown.error?.code, 'PGRST204');
  const missing = await h.anon().from('does_not_exist').select('*');
  assert.equal(missing.error?.code, 'PGRST205');
});

test('upsert with onConflict marks a broadcast as read once', async () => {
  const broadcast = '55555555-5555-4555-8555-555555555555';
  await exec(h.pool, `INSERT INTO broadcast_notifications (id, kind, title, body, target_roles, source_type, source_id, created_by)
    VALUES (?, 'announcement', 'Elan', 'Mətn', JSON_ARRAY('student'), 'manual', UUID(), NULL)`, [broadcast]);
  for (let i = 0; i < 2; i++) {
    const { error } = await student.from('broadcast_notification_reads').upsert({ broadcast_id: broadcast, profile_id: studentId, read_at: new Date().toISOString() }, { onConflict: 'broadcast_id,profile_id' });
    assert.equal(error, null);
  }
  const { data } = await student.from('broadcast_notification_reads').select('broadcast_id');
  assert.equal(data!.length, 1);
  const visible = await student.from('broadcast_notifications').select('title').order('title');
  // The approved job published its own broadcast (jobs_broadcast_notification).
  assert.deepEqual(visible.data, [{ title: 'Elan' }, { title: 'Yeni vakansiya' }], 'targeted by role through JSON_CONTAINS(target_roles, role)');
  const companyView = await company.from('broadcast_notifications').select('title');
  assert.deepEqual(companyView.data, []);
});

test('filters: ilike, in, gte, is, neq and Postgres NULL ordering', async () => {
  const like = await h.anon().from('jobs').select('title').ilike('title', '%QAZMA%');
  assert.equal(like.data!.length, 1);
  const inList = await company.from('jobs').select('id').in('id', [openJob, pendingJob]);
  assert.equal(inList.data!.length, 1, 'the deleted job is gone');
  const today = new Date().toISOString().slice(0, 10);
  assert.equal((await h.anon().from('jobs').select('id').gte('deadline', today)).data!.length, 1);
  assert.equal((await h.anon().from('jobs').select('id').is('location', null)).data!.length, 0);
  assert.equal((await h.anon().from('jobs').select('id').neq('status', 'approved')).data!.length, 0);
});

test('logic trees: or=, and= and not.or= filters', async () => {
  const anon = h.anon();
  assert.equal((await anon.from('jobs').select('id').or('title.ilike.*qazma*,location.eq.Gəncə')).data!.length, 1);
  assert.equal((await anon.from('jobs').select('id').or('title.eq.Yoxdur,location.eq.Gəncə')).data!.length, 0);
  assert.equal((await anon.from('jobs').select('id').or('and(title.ilike.*qazma*,location.eq.Bakı),title.eq.Yoxdur')).data!.length, 1);
  assert.equal((await anon.from('jobs').select('id').not('or', '(title.ilike.*qazma*,location.eq.Gəncə)' as never, '' as never)).data?.length ?? 0, 0);
  const quoted = await anon.from('jobs').select('id').or('title.eq."Qazma mühəndisi",title.in.("a,b",c)');
  assert.equal(quoted.data!.length, 1, 'quoted values keep commas');
});

test('filters on embedded resources narrow the embed; with !inner they drop the parent', async () => {
  const kept = await company.from('applications').select('id,jobs(title)').eq('jobs.title', 'Başqa vakansiya');
  assert.equal(kept.data!.length, 1);
  assert.equal((kept.data![0] as unknown as { jobs: null }).jobs, null, 'the parent stays, the embed is filtered out');
  const inner = await company.from('applications').select('id,jobs!inner(title)').eq('jobs.title', 'Başqa vakansiya');
  assert.deepEqual(inner.data, []);
  const match = await company.from('applications').select('id,jobs!inner(title)').eq('jobs.title', 'Qazma mühəndisi');
  assert.equal(match.data!.length, 1);
  const write = await company.from('applications').update({ status: 'baxilir' }).eq('jobs.title', 'Qazma mühəndisi');
  assert.equal(write.error?.code, 'PGRST100', 'embedded filters are for reads only');
});

test('embedded resources can be ordered and limited per parent row', async () => {
  const extra = '66666666-6666-4666-8666-666666666666';
  await exec(h.pool, `INSERT INTO jobs (id, company_id, title, type, status, deadline, location) VALUES (?, ?, 'Ab vakansiya', 'is', 'approved', CURRENT_DATE + INTERVAL 5 DAY, 'Bakı')`,
    [extra, companyId]);
  const asc = await h.anon().from('companies').select('name,jobs(title)').eq('id', companyId).order('title', { referencedTable: 'jobs' });
  assert.deepEqual((asc.data![0] as unknown as { jobs: { title: string }[] }).jobs.map(j => j.title), ['Ab vakansiya', 'Qazma mühəndisi']);
  const top = await h.anon().from('companies').select('name,jobs(title)').eq('id', companyId)
    .order('title', { referencedTable: 'jobs', ascending: false }).limit(1, { referencedTable: 'jobs' });
  assert.deepEqual((top.data![0] as unknown as { jobs: { title: string }[] }).jobs.map(j => j.title), ['Qazma mühəndisi']);
  await exec(h.pool, 'DELETE FROM jobs WHERE id = ?', [extra]);
});
