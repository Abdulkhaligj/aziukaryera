// AI budgets and context for the Edge Functions (no EXECUTE grant to site
// roles; service key only): ai_request_context, ai_reserve_request,
// ai_consume_provider_attempt, ai_candidate_pack.
import { exec, one, rows, toMysqlDatetime, type Row } from '../db.ts';
import { DbRuleError } from '../errors.ts';
import { insertRow, type WriteEnv } from '../write/pipeline.ts';
import { companyHasFeature, left } from '../write/rules/core.ts';
import { matchScore } from './profiles.ts';
import { rpc } from './registry.ts';
import { bakuStart, inList } from './util.ts';

const STUDENT_DAILY = 25;
const CAREER_TASKS = ['cv_analyze', 'cv_rewrite', 'job_match_explain', 'interview_questions', 'interview_evaluate', 'candidate_rank', 'job_post_write'];
const truthy = (v: unknown) => ['true', 't', 'yes', 'y', 'on', '1'].includes(String(v ?? 'false').toLowerCase());

/** public.ai_request_context */
export async function aiRequestContext(env: WriteEnv, profileId: string, task: string | null, jobId: string | null): Promise<Row> {
  const profile = await one<{ role: string; status: string }>(env.tx, 'SELECT role, status FROM profiles WHERE id = ?', [profileId]);
  if (!profile) return { allowed: false, reason: 'profile_not_found' };
  if (profile.status !== 'active') return { allowed: false, reason: 'profile_inactive' };
  const role = profile.role;
  const now = toMysqlDatetime(env.now);

  if (task === 'candidate_rank' || task === 'job_post_write') {
    if (role !== 'company' && role !== 'admin') return { allowed: false, reason: 'company_only' };
    let company: string | null = null;
    if (jobId != null) {
      company = (await one<{ company_id: string }>(env.tx, 'SELECT company_id FROM jobs WHERE id = ?', [jobId]))?.company_id ?? null;
      if (company == null) return { allowed: false, reason: 'job_not_found' };
      if (role !== 'admin'
        && !await one(env.tx, 'SELECT 1 AS ok FROM companies WHERE id = ? AND owner_id = ?', [company, profileId])
        && !await one(env.tx, `SELECT 1 AS ok FROM company_members WHERE company_id = ? AND profile_id = ? AND status = 'active'`, [company, profileId])) {
        return { allowed: false, reason: 'not_member' };
      }
    } else {
      company = (await one<{ id: string }>(env.tx, `SELECT c.id FROM companies c WHERE c.owner_id = ?
          OR EXISTS (SELECT 1 FROM company_members m WHERE m.company_id = c.id AND m.profile_id = ? AND m.status = 'active')
        ORDER BY c.owner_id = ? DESC LIMIT 1`, [profileId, profileId, profileId]))?.id ?? null;
    }
    if (role === 'admin') return { allowed: true, role, company_id: company, used: 0, limit: null, period: 'month' };
    if (company == null) return { allowed: false, reason: 'no_company' };
    const status = (await one<{ status: string }>(env.tx, 'SELECT status FROM companies WHERE id = ?', [company]))?.status;
    if (status !== 'active') return { allowed: false, reason: 'company_inactive', company_id: company };
    const active = `s.company_id = ? AND s.status = 'active' AND (s.starts_at IS NULL OR s.starts_at <= ?) AND (s.plan_id = 'free' OR s.ends_at > ?)`;
    const plan = (await one<{ plan_id: string }>(env.tx, `SELECT s.plan_id FROM subscriptions s WHERE ${active} LIMIT 1`, [company, now, now]))?.plan_id ?? null;
    if (task === 'candidate_rank' && !await companyHasFeature(env, company, 'ai_cv_ranking')) {
      return { allowed: false, reason: 'plan_required', company_id: company, plan_id: plan ?? 'free' };
    }
    const feature = await one<{ enabled: boolean; limit_value: number | null }>(env.tx, `SELECT pf.enabled, pf.limit_value FROM subscriptions s
        JOIN plan_features pf ON pf.plan_id = s.plan_id AND pf.feature_key = 'ai_requests_monthly' WHERE ${active} LIMIT 1`, [company, now, now]);
    const limit = !feature || !feature.enabled ? 0 : feature.limit_value;
    const used = Number((await one<{ n: number }>(env.tx, 'SELECT COUNT(*) AS n FROM ai_usage WHERE company_id = ? AND success AND created_at >= ?',
      [company, toMysqlDatetime(bakuStart(env.now, 'month'))]))!.n);
    return {
      allowed: limit == null || used < limit, reason: limit != null && used >= limit ? 'quota_exceeded' : null,
      role, company_id: company, plan_id: plan ?? 'free', used, limit, period: 'month'
    };
  }

  if (role === 'admin') return { allowed: true, role, used: 0, limit: null, period: 'day' };
  const used = Number((await one<{ n: number }>(env.tx, `SELECT COUNT(*) AS n FROM ai_usage
      WHERE profile_id = ? AND company_id IS NULL AND success AND created_at >= ?`, [profileId, toMysqlDatetime(bakuStart(env.now, 'day'))]))!.n);
  return { allowed: used < STUDENT_DAILY, reason: used >= STUDENT_DAILY ? 'quota_exceeded' : null, role, used, limit: STUDENT_DAILY, period: 'day' };
}

rpc({
  name: 'ai_request_context', args: { p_profile_id: 'uuid', p_task: 'text', p_job_id: 'uuid' }, roles: [], security: 'definer', returns: 'value',
  run: (env, a) => aiRequestContext(env, a.p_profile_id, a.p_task, a.p_job_id)
});

/** public.ai_reserve_request: one reservation per AI call, within its budget. */
export async function aiReserveRequest(env: WriteEnv, profileId: string | null, task: string | null, jobId: string | null, clientHash: string | null): Promise<Row> {
  // pg_advisory_xact_lock: one global lock also makes the anonymous cap independent of client headers.
  await one(env.tx, `SELECT value FROM private_sequences WHERE name = 'ai_reservation_lock' FOR UPDATE`);
  let ctx: Row = {};
  let role: string | null = null;
  if (profileId != null) {
    const p = await one<{ role: string; status: string; admin_role: string | null; meta: Row | null }>(env.tx,
      'SELECT p.role, p.status, p.admin_role, u.raw_app_meta_data AS meta FROM profiles p JOIN auth_users u ON u.id = p.id WHERE p.id = ?', [profileId]);
    if (p?.status !== 'active') return { allowed: false, reason: 'profile_inactive' };
    role = p.role;
    if (role === 'admin' && (p.admin_role == null || !['super_admin', 'manager', 'editor', 'reviewer'].includes(p.admin_role)
      || p.admin_role !== (p.meta?.admin_role ?? null) || truthy(p.meta?.must_change_password))) {
      return { allowed: false, reason: 'profile_inactive' };
    }
  }
  const clock = new Date();
  let since = bakuStart(clock, 'day');
  let budget: string;
  let limit: number;
  let company: string | null = null;
  if (task === 'aida_chat') {
    if (profileId == null) {
      if (clientHash == null || !/^[0-9a-f]{40}$/.test(clientHash)) throw new DbRuleError('Invalid anonymous client', '22023');
      const used = Number((await one<{ n: number }>(env.tx, `SELECT COUNT(*) AS n FROM private_ai_reservations
          WHERE task = 'aida_chat' AND profile_id IS NULL AND created_at >= ?`, [toMysqlDatetime(since)]))!.n);
      if (used >= 2000) return { allowed: false, reason: 'quota_exceeded', limit: 2000, used };
      budget = `aida:anonymous:${clientHash}`; limit = 20;
    } else { budget = `aida:profile:${profileId}`; limit = 80; }
  } else if (task === 'admin_assistant') {
    if (role !== 'admin') return { allowed: false, reason: 'forbidden' };
    budget = `admin:${profileId}`; limit = 200;
  } else if (task === 'content_moderation' || task === 'avatar_moderation') {
    budget = 'moderation'; limit = 5000;
  } else if (task != null && CAREER_TASKS.includes(task)) {
    if (profileId == null) return { allowed: false, reason: 'forbidden' };
    ctx = await aiRequestContext(env, profileId, task, jobId);
    if (ctx.allowed !== true) return ctx;
    company = (ctx.company_id as string | null | undefined) ?? null;
    if (role === 'admin') { budget = `admin:${profileId}`; limit = 200; }
    else if (company != null) {
      budget = `career:company:${company}`;
      since = bakuStart(clock, 'month');
      // Unlimited plans still have an explicit paid-work safety ceiling.
      limit = Math.min((ctx.limit as number | null) ?? 10000, 10000);
    } else { budget = `career:profile:${profileId}`; limit = 25; }
  } else throw new DbRuleError('Unsupported AI task', '22023');
  const used = Number((await one<{ n: number }>(env.tx, 'SELECT COUNT(*) AS n FROM private_ai_reservations WHERE budget = ? AND created_at >= ?',
    [budget, toMysqlDatetime(since)]))!.n);
  if (used >= limit) return { ...ctx, allowed: false, reason: 'quota_exceeded', used, limit };
  const reservation = await insertRow(env, 'private_ai_reservations', { profile_id: profileId, company_id: company, client_hash: clientHash, task, budget });
  return { ...ctx, allowed: true, reservation_id: reservation.id, used: used + 1, limit };
}

rpc({
  name: 'ai_reserve_request', args: { p_profile_id: 'uuid', p_task: 'text', p_job_id: 'uuid', p_client_hash: 'text' }, roles: [], security: 'definer', returns: 'value',
  run: (env, a) => aiReserveRequest(env, a.p_profile_id, a.p_task, a.p_job_id, a.p_client_hash)
});

rpc({
  name: 'ai_consume_provider_attempt', args: { p_reservation_id: 'uuid' }, roles: [], security: 'definer', returns: 'value',
  async run(env, a) {
    const result = await exec(env.tx, `UPDATE private_ai_reservations SET provider_attempts = provider_attempts + 1
       WHERE id = ? AND provider_attempts < 7 AND created_at > ?`, [a.p_reservation_id, toMysqlDatetime(new Date(Date.now() - 5 * 60_000))]);
    return result.affectedRows === 1;
  }
});

rpc({
  name: 'ai_candidate_pack', args: { p_job_id: 'uuid', p_limit: 'int', p_offset: 'int' }, roles: [], security: 'definer', returns: 'value',
  async run(env, a) {
    const job = await one<Row>(env.tx, 'SELECT * FROM jobs WHERE id = ?', [a.p_job_id]);
    const names = async (table: 'faculties' | 'majors', ids: unknown) => {
      const list = (Array.isArray(ids) ? ids : []).filter(v => v != null);
      return list.length ? (await rows<{ name: string }>(env.tx, `SELECT name FROM ${table} WHERE id IN (${inList(list)}) ORDER BY id`, list)).map(r => r.name) : [];
    };
    const apps = job ? await rows<Row>(env.tx, `SELECT a.id AS application_id, a.student_id, a.status, a.created_at,
          p.faculty_id, p.major_id, p.course, p.gpa, p.skills, p.languages, p.certificates, p.summary
        FROM applications a JOIN profiles p ON p.id = a.student_id
       WHERE a.job_id = ? AND a.status NOT IN ('geri_goturuldu', 'imtina', 'rejected')`, [job.id]) : [];
    const scored = apps.map(x => ({ ...x, deterministic_score: matchScore(job!.faculty_ids, job!.major_ids, job!.skills, x.faculty_id, x.major_id, x.skills) }) as Row & { deterministic_score: number })
      .sort((x, y) => y.deterministic_score - x.deterministic_score || new Date(x.created_at as string).getTime() - new Date(y.created_at as string).getTime());
    // least() and greatest() ignore NULL arguments.
    const limit = Math.max(1, Math.min(a.p_limit ?? 25, 25));
    const offset = Math.max(a.p_offset ?? 0, 0);
    const candidates = [];
    for (const c of scored.slice(offset, offset + limit)) {
      const faculty = c.faculty_id ? (await one<{ name: string }>(env.tx, 'SELECT name FROM faculties WHERE id = ?', [c.faculty_id]))?.name ?? null : null;
      const major = c.major_id ? (await one<{ name: string }>(env.tx, 'SELECT name FROM majors WHERE id = ?', [c.major_id]))?.name ?? null : null;
      const education = (await rows<Row>(env.tx, 'SELECT degree_type, specialty, graduation_year, is_current FROM education WHERE profile_id = ? ORDER BY id',
        [c.student_id])).map(e => ({ degree: e.degree_type, specialty: e.specialty, graduation_year: e.graduation_year, is_current: e.is_current }));
      const cv = await one<{ source_text: string }>(env.tx, `SELECT source_text FROM cv_documents WHERE profile_id = ? AND source_text IS NOT NULL
         ORDER BY updated_at DESC LIMIT 1`, [c.student_id]);
      candidates.push({
        application_id: c.application_id, student_id: c.student_id, status: c.status, deterministic_score: c.deterministic_score,
        created_at: c.created_at, faculty, major, course: c.course, gpa: c.gpa, skills: c.skills, languages: c.languages,
        certificates: c.certificates, summary: left(c.summary, 800), education, cv_text: cv ? left(cv.source_text, 2500) : null
      });
    }
    return {
      job: job ? {
        title: job.title, type: job.type, summary: job.summary, duties: job.duties, requirements: job.requirements, skills: job.skills,
        preferred_skills: job.preferred_skills, experience_level: job.experience_level, min_course: job.min_course, min_gpa: job.min_gpa,
        faculties: await names('faculties', job.faculty_ids), majors: await names('majors', job.major_ids)
      } : null,
      total: scored.length,
      candidates
    };
  }
});
