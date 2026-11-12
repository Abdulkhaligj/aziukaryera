// The Postgres trigger ports, driven through the data client as the portal does.
// Tests run in order and build on each other (one company, one student).
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { ApiClient } from './helpers.ts';
import { exec, one, rows } from '../src/db.ts';
import { startHarness, type Harness } from './helpers.ts';

let h: Harness;
let student: ApiClient, company: ApiClient, admin: ApiClient, reviewer: ApiClient;
let studentId: string, companyUser: string, companyId: string, adminId: string;
let jobId: string, applicationId: string, slotId: string;

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

const notes = (profileId: string, kind: string) =>
  rows<{ title: string; body: string; link: string }>(h.pool, 'SELECT title, body, link FROM notifications WHERE profile_id = ? AND kind = ? ORDER BY created_at, id', [profileId, kind]);
const counter = async (subject: string, feature: string) =>
  (await one<{ used_count: number }>(h.pool, 'SELECT used_count FROM private_company_quota_counters WHERE subject_id = ? AND feature_key = ?', [subject, feature]))?.used_count ?? 0;

before(async () => {
  h = await startHarness();
  ({ client: student, id: studentId } = await signedIn('aysel@asoiu.edu.az', { role: 'student', full_name: 'Aysel Məmmədova' }));
  ({ client: company, id: companyUser } = await signedIn('hr@azercell.az', { role: 'company', company_name: 'Azercell', full_name: 'HR Azercell' }));
  companyId = (await one<{ id: string }>(h.pool, 'SELECT id FROM companies WHERE owner_id = ?', [companyUser]))!.id;
  ({ client: admin, id: adminId } = await staff('admin2@asoiu.edu.az', 'super_admin'));
  ({ client: reviewer } = await staff('reviewer@asoiu.edu.az', 'reviewer'));
});
after(async () => { await h?.close(); });

test('company status is staff-only and the owner profile follows it', async () => {
  const own = await company.from('companies').update({ status: 'active' }).eq('id', companyId);
  assert.equal(own.status, 403);
  assert.equal(own.error?.message, 'Şirkət statusunu yalnız Karyera Mərkəzi dəyişə bilər');
  const ok = await admin.from('companies').update({ status: 'active' }).eq('id', companyId);
  assert.equal(ok.error, null);
  assert.equal((await one<{ status: string }>(h.pool, 'SELECT status FROM profiles WHERE id = ?', [companyUser]))!.status, 'active');
  assert.deepEqual(await notes(companyUser, 'company_status'), [{ title: 'Şirkət hesabının statusu dəyişdi', body: 'active', link: 'company-profile' }]);
  const rename = await company.from('companies').update({ about: 'Mobil operator' }).eq('id', companyId);
  assert.equal(rename.error, null, 'other fields stay editable');
  const audit = await rows(h.pool, `SELECT actor_name FROM admin_audit_logs WHERE resource IN ('companies', 'profiles') AND action = 'db_update' AND actor_id = ?`, [adminId]);
  assert.ok(audit.length >= 2, 'the company and the synced profile are both audited');
});

test('jobs: vacancy quota, staff-only approval, owner notification and broadcast', async () => {
  const deadline = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
  const created = await company.from('jobs').insert({ company_id: companyId, title: 'Təcrübəçi mühəndis', type: 'tecrube', deadline, location: 'Bakı' })
    .select('id,status').single();
  assert.equal(created.error, null);
  assert.equal(created.data!.status, 'pending', 'the column default is in NEW');
  jobId = created.data!.id;
  assert.equal(await counter(companyId, 'active_vacancies'), 1);
  const usage = await one<{ used_count: number }>(h.pool, `SELECT u.used_count FROM subscription_usage u JOIN subscriptions s ON s.id = u.subscription_id
     WHERE s.company_id = ? AND u.feature_key = 'active_vacancies'`, [companyId]);
  assert.equal(usage?.used_count, 1);

  const self = await company.from('jobs').update({ status: 'approved' }).eq('id', jobId);
  assert.equal(self.status, 403);
  assert.equal(self.error?.message, 'Elanın statusunu yalnız Karyera Mərkəzi dəyişə bilər');

  assert.equal((await admin.from('jobs').update({ status: 'approved' }).eq('id', jobId)).error, null);
  assert.deepEqual(await notes(companyUser, 'vacancy_approved'), [{ title: 'Vakansiya təsdiqləndi', body: 'Təcrübəçi mühəndis', link: 'vacancies' }]);
  const seen = await student.from('broadcast_notifications').select('kind,title,body,link,source_type');
  assert.deepEqual(seen.data, [{ kind: 'new_internship', title: 'Yeni təcrübə imkanı', body: 'Təcrübəçi mühəndis', link: 'jobs', source_type: 'jobs' }]);

  for (const title of ['İkinci vakansiya', 'Üçüncü vakansiya']) {
    assert.equal((await company.from('jobs').insert({ company_id: companyId, title, type: 'is', deadline })).error, null);
  }
  const over = await company.from('jobs').insert({ company_id: companyId, title: 'Dördüncü vakansiya', type: 'is', deadline });
  assert.equal(over.error?.code, '23514');
  assert.equal(over.error?.message, 'Paketinizin limiti dolub');
  assert.equal(await counter(companyId, 'active_vacancies'), 3, 'the refused insert rolled back');
});

test('applications: history, notifications and the field guards', async () => {
  const applied = await student.from('applications').insert({ job_id: jobId, student_id: studentId }).select('id').single();
  assert.equal(applied.error, null);
  applicationId = applied.data!.id;
  assert.deepEqual(await notes(companyUser, 'new_application'),
    [{ title: 'Yeni müraciət', body: 'Vakansiyanıza yeni müraciət daxil olub.', link: 'applications' }]);

  assert.equal((await company.from('applications').update({ status: 'baxilir', company_note: 'CV-yə baxılır' }).eq('id', applicationId)).error, null);
  assert.deepEqual(await notes(studentId, 'application_status'), [{ title: 'Müraciət statusu dəyişdi', body: 'baxilir', link: 'applications' }]);
  const history = await rows<{ old_status: string | null; new_status: string; changed_by: string; note: string }>(h.pool,
    'SELECT old_status, new_status, changed_by, note FROM application_status_history WHERE application_id = ? ORDER BY created_at', [applicationId]);
  assert.deepEqual(history, [
    { old_status: null, new_status: 'gonderildi', changed_by: studentId, note: '' },
    { old_status: 'gonderildi', new_status: 'baxilir', changed_by: companyUser, note: 'CV-yə baxılır' }]);

  const note = await company.from('applications').update({ note: 'dəyişdirildi' }).eq('id', applicationId);
  assert.equal(note.status, 403);
  assert.equal(note.error?.message, 'Müraciətin bu sahələrini dəyişmək icazəsi yoxdur');
  const withdraw = await company.from('applications').update({ status: 'geri_goturuldu' }).eq('id', applicationId);
  assert.equal(withdraw.error?.message, 'Müraciəti yalnız tələbə geri götürə bilər');

  const limited = await reviewer.from('applications').update({ company_note: 'reviewer' }).eq('id', applicationId);
  assert.equal(limited.error?.code, '42501');
  assert.equal(limited.error?.message, 'Limited administrators may only change moderation fields');
});

test('interview slots: defaults, validation, overlap, stage change and notifications', async () => {
  const startsAt = '2026-12-01T06:00:00Z';
  const noPlace = await company.from('company_interview_slots').insert({ application_id: applicationId, starts_at: startsAt });
  assert.equal(noPlace.error?.code, '23514', 'meeting_mode defaults to on_site, which needs a place');
  assert.equal(noPlace.error?.message, 'Əyani müsahibə üçün görüş məkanı daxil edilməlidir');

  const slot = await company.from('company_interview_slots').insert({ application_id: applicationId, starts_at: startsAt, location: 'Bakı, Azercell ofisi' })
    .select('id,created_by,status,duration_minutes').single();
  assert.equal(slot.error, null);
  slotId = slot.data!.id;
  assert.deepEqual({ ...slot.data, id: undefined }, { id: undefined, created_by: companyUser, status: 'scheduled', duration_minutes: 45 });
  assert.equal((await one<{ status: string }>(h.pool, 'SELECT status FROM applications WHERE id = ?', [applicationId]))!.status, 'interview');
  assert.deepEqual(await notes(studentId, 'interview'),
    [{ title: 'Müsahibə vaxtınız təyin olundu', body: 'Təcrübəçi mühəndis · 01.12.2026 10:00 (Bakı vaxtı)', link: 'applications' }]);
  const request = await one<{ status: string; scheduled_slot_id: string }>(h.pool, 'SELECT status, scheduled_slot_id FROM interview_requests WHERE application_id = ?', [applicationId]);
  assert.deepEqual(request, { status: 'scheduled', scheduled_slot_id: slotId });

  const overlap = await company.from('company_interview_slots').insert({ application_id: applicationId, starts_at: '2026-12-01T06:30:00Z', location: 'Bakı' });
  assert.equal(overlap.status, 409);
  assert.equal(overlap.error?.message, 'Bu namizəd üçün seçilən vaxtda artıq aktiv müsahibə var');

  const moved = await company.from('company_interview_slots').update({ application_id: slotId }).eq('id', slotId);
  assert.equal(moved.error?.message, 'Müsahibənin namizəd və müəllif məlumatı dəyişdirilə bilməz');

  assert.equal((await company.from('company_interview_slots').update({ status: 'cancelled' }).eq('id', slotId)).error, null);
  assert.equal((await notes(studentId, 'interview')).at(-1)!.title, 'Müsahibə ləğv edildi');
});

test('posts: moderation state is server-owned, terms are blocked, admin posts are broadcast', async () => {
  const post = await student.from('posts').insert({ author_id: studentId, body: 'Salam hamıya' }).select('id,moderation_status,moderation_requested_at').single();
  assert.equal(post.error, null);
  assert.equal(post.data!.moderation_status, 'pending');
  assert.ok(post.data!.moderation_requested_at);
  assert.equal(await counter(studentId, 'monthly_network_posts'), 1);

  const self = await student.from('posts').update({ moderation_status: 'visible' }).eq('id', post.data!.id).select('moderation_status').single();
  assert.equal(self.data?.moderation_status, 'pending', 'an author cannot approve their own post');

  const backdated = await student.from('posts').insert({ author_id: studentId, body: 'Köhnə', created_at: '2020-01-01T00:00:00Z' });
  assert.equal(backdated.status, 403);
  assert.equal(backdated.error?.message, 'Post author and creation time are server-owned');

  const added = await admin.from('moderation_terms').insert({ term: ' QWXZ! ' }).select('term,script,match').single();
  assert.deepEqual(added.data, { term: 'qwxz', script: 'latin', match: 'stem' });
  const mixed = await admin.from('moderation_terms').insert({ term: 'qwxz привет' });
  assert.equal(mixed.error?.message, 'Söz tanınmadı: bir əlifbada yazılmış söz və ya söz birləşməsi əlavə edin');
  for (const body of ['bu q*xz idi', 'QWXZlar hamısı']) {
    const blocked = await student.from('posts').insert({ author_id: studentId, body });
    assert.equal(blocked.error?.message, 'Mətndə nalayiq ifadə var. Zəhmət olmasa, mətni düzəldib yenidən göndərin.', body);
  }

  // Staff may not insert posts through the data API (admin_can); the admin panel uses the service key.
  assert.equal((await admin.from('posts').insert({ author_id: adminId, body: 'Karyera həftəsi' })).error?.code, '42501');
  const own = await h.service().from('posts').insert({ author_id: adminId, body: 'Karyera həftəsi başlayır' }).select('id,moderation_status').single();
  assert.equal(own.data?.moderation_status, 'pending', 'new text is moderated even for trusted writers');
  assert.equal((await h.service().from('posts').update({ moderation_status: 'visible' }).eq('id', own.data!.id)).error, null);
  const broadcast = await one<{ kind: string; title: string; body: string }>(h.pool, `SELECT kind, title, body FROM broadcast_notifications WHERE source_type = 'posts'`);
  assert.deepEqual(broadcast, { kind: 'new_post', title: 'Karyera Mərkəzindən yeni paylaşım', body: 'Karyera həftəsi başlayır' });

  const media = await company.from('posts').insert({ author_id: companyUser, body: 'Yeni ofisimiz', attachment_url: 'https://example.com/ofis.png' });
  assert.equal(media.error?.message, 'Paketiniz şəkil və sənəd paylaşımını dəstəkləmir');
  assert.equal((await company.from('posts').insert({ author_id: companyUser, body: 'Yeni ofisimiz' })).error, null);
});

test('profiles: users cannot change their role, status or alumni flag', async () => {
  const before = (await one<{ updated_at: string }>(h.pool, 'SELECT updated_at FROM profiles WHERE id = ?', [studentId]))!.updated_at;
  const role = await student.from('profiles').update({ role: 'admin' }).eq('id', studentId);
  assert.equal(role.status, 403);
  assert.equal(role.error?.message, 'Rol və hesab statusunu dəyişmək icazəsi yoxdur');
  const alumni = await student.from('profiles').update({ alumni_verified: true }).eq('id', studentId);
  assert.equal(alumni.error?.message, 'Məzun təsdiqini yalnız Karyera Mərkəzi dəyişə bilər');
  assert.equal((await student.from('profiles').update({ summary: 'Neft mühəndisliyi tələbəsi' }).eq('id', studentId)).error, null);
  const after = (await one<{ updated_at: string }>(h.pool, 'SELECT updated_at FROM profiles WHERE id = ?', [studentId]))!.updated_at;
  assert.ok(after > before, 'updated_at is touched');
});

test('a paid invoice credits its plan once and unlocks post media', async () => {
  assert.equal((await h.service().from('subscriptions').update({ requested_plan_id: 'pro' }).eq('company_id', companyId)).error, null);
  const invoice = await one<{ id: string; invoice_number: string; amount: number }>(h.pool,
    `SELECT id, invoice_number, amount FROM payments WHERE company_id = ? AND status = 'pending'`, [companyId]);
  assert.match(invoice!.invoice_number, /^KM-\d{4}-00001$/);
  assert.equal(invoice!.amount, 24.99);
  assert.equal((await notes(adminId, 'invoice_created')).length, 1);

  const paid = await admin.from('payments').update({ status: 'paid' }).eq('id', invoice!.id).select('paid_at,subscription_id').single();
  assert.equal(paid.error, null);
  assert.ok(paid.data!.paid_at && paid.data!.subscription_id);
  const sub = await one<{ plan_id: string; status: string; ends_at: string; requested_plan_id: string | null; approved_by: string }>(h.pool,
    'SELECT plan_id, status, ends_at, requested_plan_id, approved_by FROM subscriptions WHERE company_id = ?', [companyId]);
  assert.deepEqual({ ...sub, ends_at: undefined }, { plan_id: 'pro', status: 'active', ends_at: undefined, requested_plan_id: null, approved_by: adminId });
  const days = (new Date(sub!.ends_at).getTime() - Date.now()) / 86_400_000;
  assert.ok(days > 29.9 && days < 30.1, `ends in 30 days (${days})`);
  assert.equal((await notes(companyUser, 'subscription_active'))[0].title, 'Pro paketi aktivdir');

  const changed = await admin.from('payments').update({ months: 2 }).eq('id', invoice!.id);
  assert.equal(changed.error?.message, 'Credited invoice identity and period are immutable');
  const media = await company.from('posts').insert({ author_id: companyUser, body: 'Ofisdən şəkillər', attachment_url: 'https://example.com/ofis.png' });
  assert.equal(media.error, null, 'Pro includes post_media');
});

test('events publish a broadcast with the Baku start time', async () => {
  const event = await admin.from('events').insert({ title: 'Karyera günü', kind: 'Sərgi', place: 'Əsas bina', starts_at: '2026-12-05T08:30:00Z' });
  assert.equal(event.error, null);
  const broadcast = await one<{ title: string; body: string }>(h.pool, `SELECT title, body FROM broadcast_notifications WHERE source_type = 'events'`);
  assert.deepEqual(broadcast, { title: 'Yeni tədbir: Karyera günü', body: 'Sərgi · Əsas bina · 05.12.2026 12:30' });
});

test('CHECK constraints that MySQL cannot declare are enforced', async () => {
  const follow = await student.from('follows').insert({ follower_id: studentId });
  assert.equal(follow.error?.code, '23514');
  assert.equal(follow.error?.message, 'new row for relation "follows" violates check constraint "follows_check"');
  const message = await h.service().from('messages').insert({ sender_id: studentId, recipient_id: studentId, body: 'Salam' });
  assert.equal(message.error?.message, 'new row for relation "messages" violates check constraint "messages_check"');
});

test('partnership requests notify the admins, then the company; the original request is fixed', async () => {
  const request = await company.from('company_partnership_requests').insert({
    company_id: companyId, created_by: companyUser, category: 'career_day', title: 'Karyera günü stendi',
    details: 'Tələbələr üçün stend və qısa təqdimat təklif edirik.', contact_email: 'hr@azercell.az'
  }).select('id').single();
  assert.equal(request.error, null);
  assert.deepEqual(await notes(adminId, 'partnership'),
    [{ title: 'Yeni əməkdaşlıq müraciəti', body: 'Azercell: Karyera günü stendi', link: 'partnerships-admin' }]);
  assert.equal((await admin.from('company_partnership_requests').update({ status: 'reviewing' }).eq('id', request.data!.id)).error, null);
  assert.deepEqual(await notes(companyUser, 'partnership'),
    [{ title: 'Əməkdaşlıq sorğunuz yeniləndi', body: 'Karyera günü stendi · Status: reviewing', link: 'partnerships' }]);
  const edit = await admin.from('company_partnership_requests').update({ title: 'Başqa başlıq' }).eq('id', request.data!.id);
  assert.equal(edit.error?.message, 'Əməkdaşlıq müraciətinin ilkin məlumatı dəyişdirilə bilməz');
});

test('company awards: trimmed names and created_by from the caller', async () => {
  const award = await admin.from('company_awards').insert({ year: 2026, nomination: '  Ən yaxşı işəgötürən ', tier: 'gold', company_name: ' Azercell ' })
    .select('nomination,company_name,created_by').single();
  assert.deepEqual(award.data, { nomination: 'Ən yaxşı işəgötürən', company_name: 'Azercell', created_by: adminId });
});

test('after-commit work runs only when the transaction commits', async () => {
  const { transaction, onCommit } = await import('../src/db.ts');
  const ran: string[] = [];
  await transaction(h.pool, async tx => { onCommit(tx, async () => { ran.push('committed'); }); });
  await transaction(h.pool, async tx => { onCommit(tx, async () => { ran.push('rolled back'); }); throw new Error('stop'); }).catch(() => {});
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(ran, ['committed']);
});

// Security audit 2026-11-12 (the same rules as migration 20261112100000).
test('audit: editing an approved vacancy\'s content sends it back to review; the deadline does not', async () => {
  assert.equal((await admin.from('jobs').update({ status: 'approved' }).eq('id', jobId)).error, null);
  const later = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);
  assert.equal((await company.from('jobs').update({ deadline: later }).eq('id', jobId)).error, null);
  let job = await one<{ status: string; approved_at: string | null }>(h.pool, 'SELECT status, approved_at FROM jobs WHERE id = ?', [jobId]);
  assert.equal(job!.status, 'approved', 'deadline changes keep the approval');
  assert.equal((await company.from('jobs').update({ location: 'Bakı' }).eq('id', jobId)).error, null);
  assert.equal((await one<{ status: string }>(h.pool, 'SELECT status FROM jobs WHERE id = ?', [jobId]))!.status, 'approved', 'an unchanged value is no edit');
  assert.equal((await company.from('jobs').update({ application_url: 'https://apply.example.com/job' }).eq('id', jobId)).error, null);
  job = await one(h.pool, 'SELECT status, approved_at FROM jobs WHERE id = ?', [jobId]);
  assert.deepEqual(job, { status: 'pending', approved_at: null });
  assert.equal((await admin.from('jobs').update({ title: 'Təcrübəçi mühəndis (yenilənib)', status: 'approved' }).eq('id', jobId)).error, null);
  assert.equal((await one<{ status: string }>(h.pool, 'SELECT status FROM jobs WHERE id = ?', [jobId]))!.status, 'approved', 'staff edits stay approved');
});

test('audit: links must be http(s), images https', async () => {
  const bad = await company.from('jobs').update({ application_url: 'javascript:alert(1)' }).eq('id', jobId);
  assert.equal(bad.error?.code, '23514');
  assert.equal(bad.error?.message, 'new row for relation "jobs" violates check constraint "jobs_application_url_web"');
  const logo = await company.from('companies').update({ logo_url: 'http://cdn.example.com/logo.png' }).eq('id', companyId);
  assert.equal(logo.error?.message, 'new row for relation "companies" violates check constraint "companies_logo_url_web"');
  const site = await company.from('companies').update({ website: 'data:text/html,hi' }).eq('id', companyId);
  assert.equal(site.error?.message, 'new row for relation "companies" violates check constraint "companies_website_web"');
  assert.equal((await company.from('companies').update({ website: 'HTTPS://azercell.com', logo_url: '' }).eq('id', companyId)).error, null);
  const partner = await admin.from('benefit_partners').insert({ name: 'Test tərəfdaş', website: 'ftp://files.example.com' });
  assert.equal(partner.error?.message, 'new row for relation "benefit_partners" violates check constraint "benefit_partners_website_web"');
});

test('audit: the profile email follows the sign-in account; sign-up never verifies an alumnus', async () => {
  const email = await student.from('profiles').update({ email: 'someone.else@asoiu.edu.az' }).eq('id', studentId);
  assert.equal(email.status, 403);
  assert.equal(email.error?.message, 'E-poçt ünvanı giriş hesabından idarə olunur');
  const { id } = await signedIn('mezun.yeni@asoiu.edu.az', { role: 'graduate', full_name: 'Yeni Məzun' });
  const graduate = await one<{ role: string; status: string; alumni_verified: number }>(h.pool, 'SELECT role, status, alumni_verified FROM profiles WHERE id = ?', [id]);
  assert.deepEqual({ ...graduate, alumni_verified: Number(graduate!.alumni_verified) }, { role: 'graduate', status: 'active', alumni_verified: 0 });
});
