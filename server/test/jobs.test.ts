// The scheduled jobs that replaced pg_cron.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { ApiClient } from './helpers.ts';
import { exec, one, rows } from '../src/db.ts';
import { cronMatches, runJob } from '../src/jobs/scheduler.ts';
import { loadSchema, type Schema } from '../src/schema.ts';
import { startHarness, type Harness } from './helpers.ts';

let h: Harness, schema: Schema;
let student: ApiClient, studentId: string, adminId: string, companyUser: string, companyId: string;

before(async () => {
  h = await startHarness();
  schema = await loadSchema(h.pool);
  student = h.anon();
  studentId = (await student.auth.signUp({ email: 'sevda@asoiu.edu.az', password: 'Sifre2026!', options: { data: { role: 'student', full_name: 'Sevda Əhmədova' } } })).data.user!.id;
  const staff = await h.service().auth.admin.createUser({ email: 'ops@asoiu.edu.az', password: 'Sifre2026!', email_confirm: true,
    user_metadata: { role: 'student', full_name: 'Ops Admin' }, app_metadata: { admin_role: 'super_admin' } });
  adminId = staff.data.user!.id;
  await exec(h.pool, `UPDATE profiles SET role = 'admin', admin_role = 'super_admin' WHERE id = ?`, [adminId]);
  const company = h.anon();
  companyUser = (await company.auth.signUp({ email: 'hr@azal.az', password: 'Sifre2026!', options: { data: { role: 'company', company_name: 'AZAL', full_name: 'HR AZAL' } } })).data.user!.id;
  companyId = (await one<{ id: string }>(h.pool, 'SELECT id FROM companies WHERE owner_id = ?', [companyUser]))!.id;
});
after(async () => { await h?.close(); });

const kinds = (profileId: string, kind: string) =>
  rows<{ title: string; body: string }>(h.pool, 'SELECT title, body FROM notifications WHERE profile_id = ? AND kind = ? ORDER BY created_at, id', [profileId, kind]);

test('cron schedules match in UTC as pg_cron does', () => {
  assert.equal(cronMatches('* * * * *', new Date('2026-11-06T10:08:00Z')), true);
  assert.equal(cronMatches('7 * * * *', new Date('2026-11-06T10:07:00Z')), true);
  assert.equal(cronMatches('7 * * * *', new Date('2026-11-06T10:08:00Z')), false);
  assert.equal(cronMatches('0 3 * * 1', new Date('2026-11-09T03:00:00Z')), true, 'Monday 03:00');
});

test('content-moderation-retry counts attempts and alerts the admins after five', async () => {
  const post = await student.from('posts').insert({ author_id: studentId, body: 'Gözləyən paylaşım' }).select('id').single();
  await exec(h.pool, 'UPDATE posts SET moderation_requested_at = NOW(6) - INTERVAL 2 MINUTE WHERE id = ?', [post.data!.id]);
  assert.deepEqual({ ...(await runJob(h.pool, schema, 'content-moderation-retry') as object), ran_at: undefined }, { sent: 1, ran_at: undefined });
  const attempts = async () => (await one<{ n: number; s: string }>(h.pool, 'SELECT moderation_attempts AS n, moderation_status AS s FROM posts WHERE id = ?', [post.data!.id]))!;
  assert.deepEqual(await attempts(), { n: 1, s: 'pending' }, 'the moderation guard keeps the post pending');
  await exec(h.pool, 'UPDATE posts SET moderation_attempts = 4 WHERE id = ?', [post.data!.id]);
  await runJob(h.pool, schema, 'content-moderation-retry');
  assert.equal((await attempts()).n, 5);
  assert.deepEqual(await kinds(adminId, 'moderation_stuck'),
    [{ title: 'AI moderasiyası cavab vermir', body: 'Paylaşım 5 cəhddən sonra yoxlanılmayıb və gizli qalır. Admin paneldən əllə yoxlayın.' }]);
  assert.deepEqual({ ...(await runJob(h.pool, schema, 'content-moderation-retry') as object), ran_at: undefined }, { sent: 0, ran_at: undefined }, 'no sixth attempt');
});

test('avatar-moderation-retry resends a pending photo', async () => {
  await exec(h.pool, `UPDATE profiles SET avatar_pending_path = ?, avatar_requested_at = NOW(6) - INTERVAL 2 MINUTE, avatar_attempts = 0 WHERE id = ?`,
    [`${studentId}/${'c'.repeat(32)}.webp`, studentId]);
  const result = await runJob(h.pool, schema, 'avatar-moderation-retry') as { sent: number };
  assert.equal(result.sent, 1);
  assert.equal((await one<{ n: number }>(h.pool, 'SELECT avatar_attempts AS n FROM profiles WHERE id = ?', [studentId]))!.n, 1);
});

test('subscription-lifecycle: a reminder with an invoice a week before, then Free', async () => {
  await exec(h.pool, `UPDATE subscriptions SET plan_id = 'pro', status = 'active', starts_at = NOW(6) - INTERVAL 27 DAY,
      ends_at = NOW(6) + INTERVAL 3 DAY, reminder_sent_at = NULL, requested_plan_id = NULL WHERE company_id = ?`, [companyId]);
  const first = await runJob(h.pool, schema, 'subscription-lifecycle') as { reminded: number; expired: number };
  assert.deepEqual([first.reminded, first.expired], [1, 0]);
  const sub = await one<{ requested_plan_id: string; reminder: string | null }>(h.pool,
    'SELECT requested_plan_id, reminder_sent_at AS reminder FROM subscriptions WHERE company_id = ?', [companyId]);
  assert.equal(sub!.requested_plan_id, 'pro');
  assert.ok(sub!.reminder);
  const [note] = await kinds(companyUser, 'subscription_expiring');
  assert.equal(note.title, 'Pro paketinin müddəti bitir');
  assert.match(note.body, /^Pro paketi \d{2}\.\d{2}\.\d{4} tarixində bitir\. Davam etmək üçün KM-\d{4}-00001 nömrəli hesab-fakturanı \(24\.99 AZN\) bank köçürməsi ilə ödəyin\.$/);
  assert.deepEqual([(await runJob(h.pool, schema, 'subscription-lifecycle') as { reminded: number }).reminded], [0], 'one reminder only');

  await exec(h.pool, 'UPDATE subscriptions SET ends_at = NOW(6) - INTERVAL 1 MINUTE WHERE company_id = ?', [companyId]);
  const second = await runJob(h.pool, schema, 'subscription-lifecycle') as { expired: number };
  assert.equal(second.expired, 1);
  const free = await one<{ plan_id: string; ends_at: string | null; requested_plan_id: string }>(h.pool,
    'SELECT plan_id, ends_at, requested_plan_id FROM subscriptions WHERE company_id = ?', [companyId]);
  assert.deepEqual(free, { plan_id: 'free', ends_at: null, requested_plan_id: 'pro' }, 'the paid plan stays requested');
  assert.equal((await kinds(companyUser, 'subscription_expired'))[0].body, 'Hesabınız Free paketə keçdi. Pro imkanlarını bərpa etmək üçün hesab-fakturanı ödəyin.');
});

test('a job already running elsewhere is skipped (named lock)', async () => {
  const other = await h.pool.getConnection();
  try {
    await other.query(`SELECT GET_LOCK('asoiu_job:subscription-lifecycle', 0)`);
    assert.deepEqual(await runJob(h.pool, schema, 'subscription-lifecycle'), { skipped: 'already running' });
  } finally {
    await other.query(`SELECT RELEASE_LOCK('asoiu_job:subscription-lifecycle')`);
    other.release();
  }
});
