// Guards added by the security audit of 2026-11-13. Each block names its
// finding. They run in the write pipeline like the trigger ports, so every
// caller (data API, RPC, functions) gets them. Names start with "001_" so
// they run before the older triggers of the same table and event.
import { one, rows, toMysqlDatetime, type Row } from '../../db.ts';
import { DbRuleError } from '../../errors.ts';
import { before, nowText, type WriteEnv } from '../pipeline.ts';
import { distinct } from '../../values.ts';
import { audited, changed, currentAdminRole, isTrusted, privileged } from './core.ts';
import { blocked } from './moderation.ts';

const deny = (message: string): never => { throw new DbRuleError(message, '42501'); };
const SENIOR = ['super_admin', 'manager'];
const role = (env: WriteEnv) => currentAdminRole(env.tx, env.ctx);
const since = (env: WriteEnv, ms: number) => toMysqlDatetime(new Date(env.now.getTime() - ms));
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** The public storage URL prefix of this API (set at start-up). Images and
 *  logos may only come from there, so no page loads a tracker (#53). */
let storagePublicBase: string | null = null;
export function setStoragePublicBase(apiUrl: string) { storagePublicBase = `${apiUrl.replace(/\/$/, '')}/storage/v1/object/public/`; }

function ownImage(column: string, value: unknown) {
  if (value == null || value === '' || storagePublicBase == null) return;
  // Other schemes are refused by the CHECK constraints; https must be ours.
  if (/^https:\/\//i.test(String(value)) && !String(value).startsWith(storagePublicBase)) {
    deny(`${column}: yalnız platformaya yüklənmiş şəkil istifadə oluna bilər`);
  }
}

// ---- applications -------------------------------------------------------

// H-07: a student creates an application; its status, company notes, tags
// and timestamps are the server's.
before('applications', '001_security_application_insert', ['insert'], async (env, row) => {
  if (await privileged(env)) return;
  row.status = 'gonderildi';
  row.company_note = '';
  row.candidate_tags = [];
  row.created_at = nowText(env);
  row.updated_at = nowText(env);
});

// #39: a reviewed application stays; the student can withdraw it, not delete
// it and apply again.
const OPEN_APPLICATION = ['gonderildi', 'applied', 'geri_goturuldu'];
before('applications', '001_security_application_delete', ['delete'], async (env, row) => {
  if (await privileged(env)) return;
  if (!OPEN_APPLICATION.includes(row.status as string)) deny('Baxılmış müraciəti silmək olmaz');
});
const CLOSED_APPLICATION = ['imtina', 'rejected', 'teklif', 'offer', 'hired'];
before('applications', '001_security_application_withdraw', ['update'], async (env, row, old) => {
  if (await privileged(env)) return;
  if (changed(row, old, 'status') && row.status === 'geri_goturuldu' && CLOSED_APPLICATION.includes(old!.status as string)) {
    deny('Yekunlaşmış müraciəti geri götürmək olmaz');
  }
});

// ---- jobs ----------------------------------------------------------------

// H-06: a company that is not active (pending, rejected, blocked) cannot
// manage vacancies; #25: featuring is staff-only; jobs stay in their company.
before('jobs', '001_security_job_owner', ['insert', 'update', 'delete'], async (env, row, old) => {
  if (await privileged(env)) return;
  const company = await one<{ status: string }>(env.tx, 'SELECT status FROM companies WHERE id = ?', [(old ?? row).company_id]);
  if (company?.status !== 'active') deny('Şirkət hesabı aktiv deyil');
  if (old && row !== old && changed(row, old, 'company_id')) deny('Vakansiyanı başqa şirkətə keçirmək olmaz');
  if (row !== old) {
    if (!old) row.featured_until = null;
    else if (changed(row, old, 'featured_until')) row.featured_until = old.featured_until;
  }
});

// #31: approving or publishing is for super admins and managers; an editor
// (who can create vacancies) cannot approve them.
before('jobs', '001_security_job_approval', ['insert', 'update'], async (env, row, old) => {
  if (isTrusted(env) && !env.ctx.uid) return;
  const approving = (row.status === 'approved' || row.status === 'published') && (!old || changed(row, old, 'status'));
  if (approving && (await role(env)) === 'editor') deny('Vakansiyanı yalnız Super Admin və ya Menecer təsdiqləyə bilər');
});

// ---- companies -----------------------------------------------------------

// #24: verification is staff-only; #26: only a super admin or manager moves a
// company to another account; #53: logos and covers come from our storage.
before('companies', '001_security_company_fields', ['insert', 'update'], async (env, row, old) => {
  const trusted = await privileged(env);
  if (!trusted) {
    if (!old) row.verified = false;
    else if (changed(row, old, 'verified')) deny('Şirkətin təsdiq nişanını yalnız Karyera Mərkəzi verə bilər');
  }
  // #54: when the owner's profile is deleted (ON DELETE SET NULL) the company
  // stays, without an owner, and waits for the Career Centre again.
  const ownerRemoved = old && old.owner_id != null && row.owner_id == null && env.definer;
  if (ownerRemoved) row.status = 'pending';
  if (old && changed(row, old, 'owner_id') && !ownerRemoved && !(isTrusted(env) && !env.ctx.uid) && !SENIOR.includes((await role(env)) ?? '')) {
    deny('Şirkəti başqa hesaba yalnız Super Admin və ya Menecer keçirə bilər');
  }
  if (!isTrusted(env) || env.ctx.uid) {
    if (!old || changed(row, old, 'logo_url')) ownImage('logo_url', row.logo_url);
    if (!old || changed(row, old, 'cover_url')) ownImage('cover_url', row.cover_url);
  }
});

// ---- profiles ------------------------------------------------------------

// #27: the account type (student, company, admin) is changed by the server
// (admin-users) or a super admin, not by a manager through the data API.
// (Users who are not staff are refused by profiles_guard_privileges.)
before('profiles', '001_security_profile_role', ['update'], async (env, row, old) => {
  if (!changed(row, old, 'role') || (isTrusted(env) && !env.ctx.uid)) return;
  const staff = await role(env);
  if (staff && staff !== 'super_admin') deny('Hesab növünü yalnız Super Admin dəyişə bilər');
});

// #68: the last active super admin cannot be demoted, blocked or deleted,
// whoever asks and however many requests run at once.
before('profiles', '001_security_last_super_admin', ['update', 'delete'], async (env, row, old) => {
  const was = old!.role === 'admin' && old!.admin_role === 'super_admin' && old!.status === 'active';
  const stays = row !== old && row.role === 'admin' && row.admin_role === 'super_admin' && row.status === 'active';
  if (!was || stays) return;
  const others = await rows(env.tx, `SELECT id FROM profiles
      WHERE role = 'admin' AND admin_role = 'super_admin' AND status = 'active' AND id <> ? FOR UPDATE`, [old!.id]);
  if (!others.length) throw new DbRuleError('Sonuncu aktiv Super Admin hesabı dəyişdirilə və ya silinə bilməz', 'P0001');
});

// #53: a profile photo URL is ours (the avatar flow stores a storage path).
before('profiles', '001_security_profile_avatar_url', ['insert', 'update'], (env, row, old) => {
  if (isTrusted(env) && !env.ctx.uid) return;
  if (!old || changed(row, old, 'avatar_url')) ownImage('avatar_url', row.avatar_url);
});

// #52: the time of the AI consent is the server's clock, not the browser's.
before('profiles', '001_security_profile_ai_consent', ['insert', 'update'], (env, row, old) => {
  if (isTrusted(env) && !env.ctx.uid) return;
  if (!old ? row.ai_consent_at != null : changed(row, old, 'ai_consent_at') && row.ai_consent_at != null) row.ai_consent_at = nowText(env);
});

// #53, #81: the pictures of ads, events, awards and partners come from the
// platform's storage too, so the sites can allow images from there only.
for (const [table, column] of [['ads', 'image_url'], ['events', 'image_url'], ['company_awards', 'logo_url'], ['benefit_partners', 'logo_url']]) {
  before(table, '001_security_own_image', ['insert', 'update'], (env, row, old) => {
    if (isTrusted(env) && !env.ctx.uid) return;
    if (!old || changed(row, old, column)) ownImage(column, row[column]);
  });
}

// ---- partners and benefits (H-02) ---------------------------------------

// A partner created by a user waits for staff approval; a benefit of such a
// partner is inactive until staff turn it on. Only then is it public and
// broadcast to students.
before('benefit_partners', '001_security_partner_status', ['insert', 'update'], async (env, row, old) => {
  if (await privileged(env)) return;
  if (!old) row.status = 'pending';
  else if (changed(row, old, 'status')) deny('Tərəfdaşın statusunu yalnız Karyera Mərkəzi dəyişə bilər');
  if (!old || changed(row, old, 'logo_url')) ownImage('logo_url', row.logo_url);
});
before('benefits', '001_security_benefit_active', ['insert', 'update'], async (env, row, old) => {
  if (await privileged(env)) return;
  if (!old) row.active = false;
  else if (changed(row, old, 'active')) deny('Güzəşti yalnız Karyera Mərkəzi aktivləşdirə bilər');
});

// ---- audit log (#30) -----------------------------------------------------

// Who and when are the server's: an administrator cannot write a row in
// another person's name or with another date.
before('admin_audit_logs', '001_security_audit_actor', ['insert'], async (env, row) => {
  if (isTrusted(env) && !env.ctx.uid) return;
  const actor = env.ctx.uid ? await one<{ full_name: string }>(env.tx, 'SELECT full_name FROM profiles WHERE id = ?', [env.ctx.uid]) : null;
  row.actor_id = env.ctx.uid;
  row.actor_name = actor?.full_name || 'System';
  row.created_at = nowText(env);
});
before('admin_audit_logs', '001_security_audit_immutable', ['update', 'delete'], (env, row, old, event) => {
  if (isTrusted(env) && !env.ctx.uid) return;
  // ON DELETE SET NULL of a removed person's profile only clears actor_id.
  const fkSetNull = event.op === 'update' && row.actor_id == null
    && Object.keys(row).every(c => c === 'actor_id' || !distinct(row[c], old![c]));
  if (!fkSetNull) deny('Audit qeydləri dəyişdirilə və ya silinə bilməz');
});

// ---- messages (#34, #41) -------------------------------------------------

const MESSAGES_PER_HOUR = 30;
const NEW_CONTACTS_PER_DAY = 20;
before('messages', '001_security_message_send', ['insert'], async (env, row) => {
  if (await privileged(env)) return;
  if (row.recipient_id === row.sender_id) deny('Özünüzə mesaj göndərə bilməzsiniz');
  const body = String(row.body ?? '');
  if (!body.trim() || [...body].length > 2000) throw new DbRuleError('Mesaj 1–2000 simvol olmalıdır', '23514');
  const recipient = await one<{ status: string }>(env.tx, 'SELECT status FROM profiles WHERE id = ?', [row.recipient_id]);
  if (recipient?.status !== 'active') deny('Bu istifadəçiyə mesaj göndərmək olmaz');
  const sent = await one<{ n: number }>(env.tx, 'SELECT COUNT(*) AS n FROM messages WHERE sender_id = ? AND created_at >= ?', [row.sender_id, since(env, HOUR)]);
  if ((sent?.n ?? 0) >= MESSAGES_PER_HOUR) throw new DbRuleError('Bir saatda çox mesaj göndərilib. Bir az sonra yenidən yazın.', 'P0001');
  const known = await one(env.tx, 'SELECT 1 AS ok FROM messages WHERE sender_id = ? AND recipient_id = ? LIMIT 1', [row.sender_id, row.recipient_id])
    || await one(env.tx, 'SELECT 1 AS ok FROM messages WHERE sender_id = ? AND recipient_id = ? LIMIT 1', [row.recipient_id, row.sender_id]);
  if (!known) {
    const contacts = await one<{ n: number }>(env.tx, `SELECT COUNT(DISTINCT recipient_id) AS n FROM messages m WHERE m.sender_id = ? AND m.created_at >= ?
        AND NOT EXISTS (SELECT 1 FROM messages e WHERE e.sender_id = m.sender_id AND e.recipient_id = m.recipient_id AND e.created_at < ?)`,
      [row.sender_id, since(env, DAY), since(env, DAY)]);
    if ((contacts?.n ?? 0) >= NEW_CONTACTS_PER_DAY) throw new DbRuleError('Bu gün çox yeni istifadəçiyə yazılıb. Sabah yenidən cəhd edin.', 'P0001');
  }
  if (await blocked(env, body)) throw new DbRuleError('Mətndə nalayiq ifadə var. Zəhmət olmasa, mətni düzəldib yenidən göndərin.', '23514');
  row.read_at = null;
  row.created_at = nowText(env);
});
before('messages', '001_security_message_read', ['update'], async (env, row, old) => {
  if (await privileged(env)) return;
  if (changed(row, old, 'sender_id', 'recipient_id', 'body', 'created_at')) deny('Mesajda yalnız oxunma qeydi dəyişə bilər');
});

// ---- connections (#35) ---------------------------------------------------

before('connections', '001_security_connection', ['insert', 'update'], async (env, row, old) => {
  if (await privileged(env)) return;
  if (!old) {
    if (row.requester_id === row.addressee_id) deny('Özünüzə əlaqə sorğusu göndərə bilməzsiniz');
    row.status = 'pending';
    row.responded_at = null;
    return;
  }
  if (changed(row, old, 'requester_id', 'addressee_id', 'created_at')) deny('Əlaqə sorğusunun tərəfləri dəyişdirilə bilməz');
  if (changed(row, old, 'status')) {
    // Only the person who received the request answers it.
    if (env.ctx.uid !== old!.addressee_id) deny('Sorğunu yalnız onu alan şəxs cavablandıra bilər');
    row.responded_at = nowText(env);
  }
});

// ---- invites (#36) -------------------------------------------------------

before('invites', '001_security_invite', ['insert', 'update'], async (env, row, old) => {
  if (await privileged(env)) return;
  const company = await one<{ status: string }>(env.tx, 'SELECT status FROM companies WHERE id = ?', [row.company_id]);
  if (company?.status !== 'active') deny('Şirkət hesabı aktiv deyil');
  const job = await one<{ company_id: string; status: string }>(env.tx, 'SELECT company_id, status FROM jobs WHERE id = ?', [row.job_id]);
  if (!job || job.company_id !== row.company_id) deny('Dəvət yalnız şirkətin öz vakansiyasına göndərilə bilər');
  if (!['approved', 'published'].includes(job!.status)) deny('Dəvət yalnız təsdiqlənmiş vakansiyaya göndərilə bilər');
  if (!old || changed(row, old, 'student_id')) {
    const student = await one<{ role: string; status: string }>(env.tx, 'SELECT role, status FROM profiles WHERE id = ?', [row.student_id]);
    if (!student || !['student', 'graduate'].includes(student.role) || student.status !== 'active') deny('Dəvət yalnız aktiv tələbəyə göndərilə bilər');
  }
});

// ---- settings that only senior staff change (#28, #67) ------------------

for (const tableName of ['moderation_terms', 'moderation_allow', 'faculties', 'majors', 'invites']) {
  before(tableName, '001_security_senior_staff', ['insert', 'update', 'delete'], async env => {
    const staff = await role(env);
    if (staff && !SENIOR.includes(staff)) deny('Bu bölməni yalnız Super Admin və ya Menecer dəyişə bilər');
  });
}
before('post_comments', '001_security_comment_delete', ['delete'], async (env, row) => {
  if (row.author_id === env.ctx.uid) return;
  const staff = await role(env);
  if (staff && !SENIOR.includes(staff)) deny('Başqasının şərhini yalnız Super Admin və ya Menecer silə bilər');
});
for (const tableName of ['payments', 'subscriptions']) {
  before(tableName, '001_security_billing_delete', ['delete'], async env => {
    if (isTrusted(env) && !env.ctx.uid) return;
    if ((await role(env)) !== 'super_admin') deny('Ödəniş və abunəlik qeydlərini yalnız Super Admin silə bilər');
  });
}

// ---- the word filter on public profile texts (#44) ----------------------

const PUBLIC_TEXT: Record<string, string[]> = {
  profiles: ['full_name', 'summary'],
  companies: ['name', 'about'],
  benefits: ['title', 'description', 'terms', 'discount_label'],
  benefit_partners: ['name', 'about']
};
for (const [tableName, columns] of Object.entries(PUBLIC_TEXT)) {
  before(tableName, '001_security_public_text', ['insert', 'update'], async (env, row, old) => {
    if (await privileged(env)) return;
    const edited = columns.filter(c => (!old || distinct(row[c], old[c])) && row[c] != null && row[c] !== '');
    if (edited.length && await blocked(env, edited.map(c => String(row[c])).join('\n'))) {
      throw new DbRuleError('Mətndə nalayiq ifadə var. Zəhmət olmasa, mətni düzəldib yenidən göndərin.', '23514');
    }
  });
}

// ---- daily content limits (H-12) ----------------------------------------

// One account cannot use up the shared moderation budget: posts and comments
// per author per day are limited (staff are not).
const DAILY: Record<string, number> = { posts: 20, post_comments: 100 };
for (const [tableName, cap] of Object.entries(DAILY)) {
  before(tableName, '001_security_daily_limit', ['insert'], async (env, row) => {
    if (await privileged(env)) return;
    const used = await one<{ n: number }>(env.tx, `SELECT COUNT(*) AS n FROM ${tableName} WHERE author_id = ? AND created_at >= ?`,
      [row.author_id, since(env, DAY)]);
    if ((used?.n ?? 0) >= cap) {
      throw new DbRuleError(tableName === 'posts' ? 'Gündəlik paylaşım limiti dolub. Sabah yenidən cəhd edin.' : 'Gündəlik şərh limiti dolub. Sabah yenidən cəhd edin.', 'P0001');
    }
  });
}

// #70: changes to the moderation lists, deleted comments and deleted messages
// leave an audit row.
for (const tableName of ['moderation_terms', 'moderation_allow']) audited(tableName);
audited('post_comments', ['delete']);
audited('messages', ['delete']);

export type { Row };
