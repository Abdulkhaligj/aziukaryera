// Statement semantics kept from Postgres: which error wins, AFTER triggers at
// the end of the statement, and BEFORE INSERT triggers inside an upsert.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { exec, one, rows } from '../src/db.ts';
import { startHarness, type Harness } from './helpers.ts';

let h: Harness;
let student: SupabaseClient, studentId: string, otherId: string, admin: SupabaseClient;

before(async () => {
  h = await startHarness();
  student = h.anon();
  studentId = (await student.auth.signUp({ email: 'rena@asoiu.edu.az', password: 'Sifre2026!', options: { data: { role: 'student', full_name: 'Rəna Kərimova' } } })).data.user!.id;
  otherId = (await h.anon().auth.signUp({ email: 'tural@asoiu.edu.az', password: 'Sifre2026!', options: { data: { role: 'student', full_name: 'Tural Abbasov' } } })).data.user!.id;
  const staff = await h.service().auth.admin.createUser({ email: 'awards@asoiu.edu.az', password: 'Sifre2026!', email_confirm: true,
    user_metadata: { role: 'student', full_name: 'Awards Admin' }, app_metadata: { admin_role: 'super_admin' } });
  await exec(h.pool, `UPDATE profiles SET role = 'admin', admin_role = 'super_admin' WHERE id = ?`, [staff.data.user!.id]);
  admin = h.anon();
  await admin.auth.signInWithPassword({ email: 'awards@asoiu.edu.az', password: 'Sifre2026!' });
});
after(async () => { await h?.close(); });

test('a row breaking both a policy and a NOT NULL constraint gets the policy error, as in Postgres', async () => {
  const both = await student.from('posts').insert({ author_id: otherId });
  assert.equal(both.error?.code, '42501', 'row-level security is checked before constraints');
  const onlyConstraint = await student.from('posts').insert({ author_id: studentId });
  assert.equal(onlyConstraint.error?.code, '23502');
  assert.match(onlyConstraint.error!.message, /null value in column "body"/);
});

test('upsert runs BEFORE INSERT triggers first, so ON CONFLICT sees the trimmed values', async () => {
  const first = await admin.from('company_awards').insert({ year: 2026, nomination: 'Ən yaxşı işəgötürən', tier: 'gold', company_name: 'SOCAR' })
    .select('id').single();
  assert.equal(first.error, null);
  const again = await admin.from('company_awards')
    .upsert({ year: 2026, nomination: '  Ən yaxşı işəgötürən ', tier: 'silver', company_name: ' SOCAR ' }, { onConflict: 'year,nomination,company_name' })
    .select('id,tier,nomination,company_name').single();
  assert.equal(again.error, null);
  assert.deepEqual(again.data, { id: first.data!.id, tier: 'silver', nomination: 'Ən yaxşı işəgötürən', company_name: 'SOCAR' });
  assert.equal(Number((await one<{ n: number }>(h.pool, 'SELECT COUNT(*) AS n FROM company_awards'))!.n), 1);
});

test('AFTER triggers of a multi-row statement fire after every row is written', async () => {
  // Each audit row is written by an AFTER trigger; in statement order they follow both inserts.
  const res = await admin.from('events').insert([
    { title: 'Birinci tədbir', starts_at: '2026-12-01T08:00:00Z' }, { title: 'İkinci tədbir', starts_at: '2026-12-02T08:00:00Z' }
  ]).select('id');
  assert.equal(res.error, null);
  const broadcasts = await rows<{ title: string }>(h.pool, `SELECT title FROM broadcast_notifications WHERE source_type = 'events' ORDER BY title`);
  assert.deepEqual(broadcasts.map(b => b.title), ['Yeni tədbir: Birinci tədbir', 'Yeni tədbir: İkinci tədbir']);
  const audit = await rows<{ resource: string }>(h.pool, `SELECT resource FROM admin_audit_logs WHERE resource IN ('events', 'broadcast_notifications')
     AND action = 'db_insert' ORDER BY created_at, id`);
  assert.equal(audit.length, 4);
});
