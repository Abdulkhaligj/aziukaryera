// Profile cards, photos and candidate lists: candidate_profiles, profile_cards,
// profile_avatar_paths, avatar_submit, avatar_remove, ranked_jobs_for (match_score).
import { one, rows, toMysqlDatetime, type Row } from '../db.ts';
import { DbRuleError } from '../errors.ts';
import { nowText, updateRow, type WriteEnv } from '../write/pipeline.ts';
import { rpc } from './registry.ts';
import { bakuDate, inList, requireUid } from './util.ts';

/** The company search entitlement in candidate_profiles (independent of the row). */
async function hasCandidateSearch(env: WriteEnv): Promise<boolean> {
  if (!env.ctx.uid) return false;
  const now = toMysqlDatetime(env.now);
  return !!await one(env.tx, `SELECT 1 AS ok FROM companies c JOIN profiles actor ON actor.id = c.owner_id
      JOIN subscriptions s ON s.company_id = c.id JOIN plan_features pf ON pf.plan_id = s.plan_id
     WHERE c.owner_id = ? AND c.status = 'active' AND actor.role = 'company' AND actor.status = 'active'
       AND s.status = 'active' AND (s.starts_at IS NULL OR s.starts_at <= ?) AND (s.plan_id = 'free' OR s.ends_at > ?)
       AND pf.feature_key = 'candidate_search' AND pf.enabled LIMIT 1`, [env.ctx.uid, now, now]);
}

/** The candidate_profiles() condition on alias p (can_read_profile reads the session variables). */
async function candidateSql(env: WriteEnv): Promise<string> {
  return `(p.role IN ('student', 'graduate') AND p.status = 'active' AND (can_read_profile(p.id) OR ${await hasCandidateSearch(env) ? 'TRUE' : 'FALSE'}))`;
}

/** public.candidate_profiles() */
export async function candidateProfiles(env: WriteEnv): Promise<Row[]> {
  if (!env.ctx.uid) return [];
  return rows(env.tx, `SELECT p.id, p.full_name, p.role, p.status, p.faculty_id, p.major_id, p.course, p.gpa, p.skills, p.summary, p.account_status
      FROM profiles p WHERE ${await candidateSql(env)}`);
}

rpc({ name: 'candidate_profiles', args: {}, roles: ['authenticated'], security: 'definer', returns: 'rows', run: env => candidateProfiles(env) });

/** p_ids[1:500] */
const firstIds = (ids: (string | null)[] | null) => (ids ?? []).slice(0, 500).filter((id): id is string => id != null);
const VISIBLE_AUTHOR = `EXISTS (SELECT 1 FROM posts po WHERE po.author_id = p.id AND po.moderation_status = 'visible')
  OR EXISTS (SELECT 1 FROM post_comments pc WHERE pc.author_id = p.id AND pc.moderation_status = 'visible')`;

rpc({
  name: 'profile_cards', args: { p_ids: 'uuid[]' }, roles: ['authenticated'], security: 'definer', returns: 'rows',
  async run(env, a) {
    const ids = firstIds(a.p_ids);
    if (!env.ctx.uid || !ids.length) return [];
    return rows(env.tx, `SELECT p.id,
        CASE WHEN p.role = 'company' THEN COALESCE((SELECT c.name FROM companies c WHERE c.owner_id = p.id AND c.status = 'active'
          ORDER BY c.created_at LIMIT 1), p.full_name) ELSE p.full_name END AS full_name,
        p.role, p.faculty_id, p.major_id, CASE WHEN p.status = 'active' THEN p.avatar_path END AS avatar_path
      FROM profiles p WHERE p.id IN (${inList(ids)}) AND (p.id = ? OR ${VISIBLE_AUTHOR})`, [...ids, env.ctx.uid]);
  }
});

rpc({
  name: 'profile_avatar_paths', args: { p_ids: 'uuid[]' }, roles: ['authenticated'], security: 'definer', returns: 'rows',
  async run(env, a) {
    const ids = firstIds(a.p_ids);
    if (!env.ctx.uid || !ids.length) return [];
    return rows(env.tx, `SELECT p.id, p.avatar_path FROM profiles p
      WHERE p.id IN (${inList(ids)}) AND p.status = 'active' AND p.avatar_path IS NOT NULL
        AND (p.id = ? OR @is_admin = 1 OR ${VISIBLE_AUTHOR} OR ${await candidateSql(env)})`, [...ids, env.ctx.uid]);
  }
});

rpc({
  name: 'avatar_submit', args: { p_path: 'text' }, roles: ['authenticated'], security: 'definer', returns: 'value',
  async run(env, a) {
    const me = requireUid(env, 'Sessiya yoxdur');
    const path = a.p_path as string | null;
    if (path == null || !new RegExp(`^${me}/[0-9a-f]{32}\\.(webp|jpg)$`).test(path)) throw new DbRuleError('Yanlış fayl yolu', '22023');
    if (!await one(env.tx, `SELECT 1 AS ok FROM storage_objects WHERE bucket_id = 'avatars' AND name = ? COLLATE utf8mb4_bin`, [path])) {
      throw new DbRuleError('Şəkil faylı tapılmadı. Yenidən yükləyin.', 'P0002');
    }
    const profile = await one<{ avatar_pending_path: string | null; avatar_submit_day: string | null; avatar_submit_count: number }>(env.tx,
      'SELECT avatar_pending_path, avatar_submit_day, avatar_submit_count FROM profiles WHERE id = ? FOR UPDATE', [me]);
    if (!profile) throw new DbRuleError('Profil tapılmadı', 'P0002');
    const today = bakuDate(env.now);
    const count = profile.avatar_submit_day === today ? profile.avatar_submit_count : 0;
    if (count >= 10) throw new DbRuleError('Gün ərzində ən çox 10 şəkil göndərmək olar. Sabah yenidən cəhd edin.', '23514');
    await updateRow(env, 'profiles', { id: me }, {
      avatar_pending_path: path, avatar_requested_at: nowText(env), avatar_attempts: 0, avatar_reason: null,
      avatar_submit_day: today, avatar_submit_count: count + 1
    });
    return { status: 'pending', replaced: profile.avatar_pending_path === path ? null : profile.avatar_pending_path };
  }
});

rpc({
  name: 'avatar_remove', args: {}, roles: ['authenticated'], security: 'definer', returns: 'value',
  async run(env) {
    const me = requireUid(env, 'Sessiya yoxdur');
    const profile = await one<{ avatar_path: string | null; avatar_pending_path: string | null }>(env.tx,
      'SELECT avatar_path, avatar_pending_path FROM profiles WHERE id = ? FOR UPDATE', [me]);
    if (profile) await updateRow(env, 'profiles', { id: me }, { avatar_path: null, avatar_pending_path: null, avatar_reason: null });
    return { files: [profile?.avatar_path, profile?.avatar_pending_path].filter(v => v != null) };
  }
});

const card = (a: unknown) => (Array.isArray(a) ? a.length : null);
/** v = ANY(arr): true, false, or NULL (unknown). */
function anyEq(v: unknown, arr: unknown): boolean | null {
  if (v == null || !Array.isArray(arr)) return null;
  if (arr.includes(v)) return true;
  return arr.some(x => x == null) ? null : false;
}

/** public.match_score: faculty 40, major 40 (15 for the same faculty), skills 20. */
export function matchScore(jobFaculties: unknown, jobMajors: unknown, jobSkills: unknown, faculty: unknown, major: unknown, skills: unknown): number {
  const facultyPart = card(jobFaculties) === 0 || anyEq(faculty, jobFaculties) === true ? 40 : 0;
  const majorPart = card(jobMajors) === 0 || anyEq(major, jobMajors) === true ? 40 : anyEq(faculty, jobFaculties) === true ? 15 : 0;
  const wanted = card(jobSkills);
  // A NULL skill list makes the sum NULL, and least(100, NULL) is 100.
  if (wanted === null) return 100;
  let skillPart = 20;
  if (wanted > 0) {
    const mine = new Set((Array.isArray(skills) ? skills : []).filter(x => x != null).map(x => String(x).toLowerCase()));
    const hits = (jobSkills as unknown[]).filter(x => x != null && mine.has(String(x).toLowerCase())).length;
    skillPart = Math.round((20 * hits) / wanted);
  }
  return Math.min(100, facultyPart + majorPart + skillPart);
}

rpc({
  name: 'ranked_jobs_for', args: {}, roles: ['authenticated'], security: 'definer', returns: 'rows',
  async run(env) {
    const me = env.ctx.uid ? await one<Row>(env.tx, 'SELECT faculty_id, major_id, skills FROM profiles WHERE id = ?', [env.ctx.uid]) : null;
    if (!me) return [];
    const jobs = await rows<Row>(env.tx, `SELECT id, faculty_ids, major_ids, skills, deadline FROM jobs WHERE status = 'approved' ORDER BY id`);
    return jobs.map(j => ({ job_id: j.id, score: matchScore(j.faculty_ids, j.major_ids, j.skills, me.faculty_id, me.major_id, me.skills), deadline: j.deadline as string }))
      .sort((x, y) => y.score - x.score || (x.deadline < y.deadline ? -1 : x.deadline > y.deadline ? 1 : 0))
      .map(({ job_id, score }) => ({ job_id, score }));
  }
});
