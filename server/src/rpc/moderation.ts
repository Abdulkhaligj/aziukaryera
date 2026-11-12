// The moderation function's two calls: moderation_claim (lease a pending row
// and an AI budget) and moderation_finish (apply the verdict if the content is
// unchanged), with private.moderation_snapshot, moderation_apply and
// avatar_moderation_apply.
import { exec, one, toMysqlDatetime, type Row } from '../db.ts';
import { DbRuleError } from '../errors.ts';
import { insertRow, nowText, updateRow, type WriteEnv } from '../write/pipeline.ts';
import { nonEmpty, notify, pgTrim } from '../write/rules/core.ts';
import { aiReserveRequest } from './ai.ts';
import { rpc } from './registry.ts';
import { jsonEqual } from './util.ts';

const LEASE_MS = 5 * 60_000;

/** private.moderation_snapshot: the pending content, locked, or null. */
async function snapshot(env: WriteEnv, table: string, id: string): Promise<Row | null> {
  if (table === 'posts') {
    const r = await one<Row>(env.tx, `SELECT id, body, link_url, tags, moderation_requested_at FROM posts
       WHERE id = ? AND moderation_status = 'pending' FOR UPDATE`, [id]);
    return r && { content_version: 2, id: r.id, body: r.body, link_url: r.link_url, tags: r.tags, moderation_requested_at: r.moderation_requested_at };
  }
  if (table === 'post_comments') {
    const r = await one<Row>(env.tx, `SELECT id, body, moderation_requested_at FROM post_comments
       WHERE id = ? AND moderation_status = 'pending' FOR UPDATE`, [id]);
    return r && { content_version: 2, id: r.id, body: r.body, moderation_requested_at: r.moderation_requested_at };
  }
  if (table === 'profiles') {
    const r = await one<Row>(env.tx, `SELECT id, avatar_pending_path, avatar_requested_at FROM profiles
       WHERE id = ? AND avatar_pending_path IS NOT NULL FOR UPDATE`, [id]);
    return r && { id: r.id, avatar_pending_path: r.avatar_pending_path, avatar_requested_at: r.avatar_requested_at };
  }
  throw new DbRuleError('Unsupported moderation target', '22023');
}

const categories = (list: unknown) => {
  const items = Array.isArray(list) ? list.filter(v => v != null) : [];
  return Array.isArray(list) && list.length > 0 ? ` [${items.join(', ')}]` : '';
};

/** public.moderation_apply → 'visible' | 'hidden' | 'skipped' */
async function moderationApply(env: WriteEnv, table: string, id: string, requestedAt: unknown, allow: boolean, reason: string | null, cats: unknown) {
  if (table !== 'posts' && table !== 'post_comments') throw new DbRuleError(`Unsupported table ${table}`, 'P0001');
  const status = allow ? 'visible' : 'hidden';
  const target = requestedAt == null ? null : await one<{ id: string; author_id: string }>(env.tx, `SELECT id, author_id FROM ${table}
     WHERE id = ? AND moderation_status = 'pending' AND moderation_requested_at = ? FOR UPDATE`, [id, toMysqlDatetime(requestedAt as string)]);
  // The text changed or was decided meanwhile.
  if (!target) return 'skipped';
  await updateRow(env, table, { id }, { moderation_status: status, moderation_reason: reason, moderated_at: nowText(env) });
  if (!allow) {
    const post = table === 'posts';
    await insertRow(env, 'moderation_logs', { target_type: post ? 'post' : 'comment', target_id: id, action: 'hide',
      reason: `AI: ${reason ?? 'davranış qaydalarını pozur'}${categories(cats)}`, actor_id: null });
    await notify(env, target.author_id, 'content_hidden', post ? 'Paylaşımınız dərc olunmadı' : 'Şərhiniz dərc olunmadı',
      `${reason ?? 'Mətn platformanın davranış qaydalarına uyğun deyil.'} Səhv olduğunu düşünürsünüzsə, Karyera Mərkəzinə yazın.`, 'network');
  }
  return status;
}

/** public.avatar_moderation_apply */
async function avatarModerationApply(env: WriteEnv, profileId: string, path: string, requestedAt: unknown, allow: boolean, reason: string | null, cats: unknown): Promise<Row> {
  const current = requestedAt == null ? null : await one<{ avatar_path: string | null }>(env.tx, `SELECT avatar_path FROM profiles
     WHERE id = ? AND avatar_pending_path = ? COLLATE utf8mb4_bin AND avatar_requested_at = ? FOR UPDATE`, [profileId, path, toMysqlDatetime(requestedAt as string)]);
  // The photo was replaced or removed meanwhile.
  if (!current) return { status: 'skipped' };
  if (allow) {
    await updateRow(env, 'profiles', { id: profileId }, { avatar_path: path, avatar_pending_path: null, avatar_reason: null, avatar_moderated_at: nowText(env) });
    return { status: 'visible', previous_path: current.avatar_path === path ? null : current.avatar_path };
  }
  const why = reason ?? 'Şəkil platformanın qaydalarına uyğun deyil.';
  await updateRow(env, 'profiles', { id: profileId }, { avatar_pending_path: null, avatar_reason: why, avatar_moderated_at: nowText(env) });
  // The rejected file is kept for admin review; its path is in the log.
  await insertRow(env, 'moderation_logs', { target_type: 'avatar', target_id: profileId, action: 'hide',
    reason: `AI: ${why}${categories(cats)} · avatars/${path}`, actor_id: null });
  await notify(env, profileId, 'avatar_hidden', 'Profil şəkliniz qəbul edilmədi', `${why} Başqa şəkil yükləyə bilərsiniz.`, 'profile');
  return { status: 'hidden' };
}

rpc({
  name: 'moderation_claim', args: { p_table: 'text', p_id: 'uuid' }, roles: [], security: 'definer', returns: 'value',
  async run(env, a) {
    const snap = await snapshot(env, a.p_table, a.p_id);
    if (!snap) return { claimed: false };
    const old = await one<Row>(env.tx, 'SELECT * FROM private_moderation_claims WHERE target_table = ? AND target_id = ? FOR UPDATE', [a.p_table, a.p_id]);
    let attempts = 1;
    if (old && jsonEqual(old.snapshot, snap)) {
      if (old.finished || new Date(old.claimed_until as string).getTime() > Date.now() || (old.attempts as number) >= 5) return { claimed: false };
      attempts = (old.attempts as number) + 1;
    }
    const budget = await aiReserveRequest(env, null, a.p_table === 'profiles' ? 'avatar_moderation' : 'content_moderation', null, null);
    if (budget.allowed !== true) return { claimed: false, reason: 'quota_exceeded' };
    const claimId = crypto.randomUUID();
    await exec(env.tx, `INSERT INTO private_moderation_claims (target_table, target_id, snapshot, claim_id, reservation_id, claimed_until, attempts)
        VALUES (?, ?, ?, ?, ?, ?, ?) AS fresh ON DUPLICATE KEY UPDATE snapshot = fresh.snapshot, claim_id = fresh.claim_id,
        reservation_id = fresh.reservation_id, claimed_until = fresh.claimed_until, attempts = fresh.attempts, finished = 0`,
      [a.p_table, a.p_id, JSON.stringify(snap), claimId, budget.reservation_id, toMysqlDatetime(new Date(Date.now() + LEASE_MS)), attempts]);
    return { claimed: true, claim_id: claimId, reservation_id: budget.reservation_id, row: snap };
  }
});

rpc({
  name: 'moderation_finish', args: { p_claim_id: 'uuid', p_allow: 'bool', p_reason: 'text', p_categories: 'text[]', p_content_version: 'int' },
  roles: [], security: 'definer', returns: 'value',
  async run(env, a) {
    const first = await one<Row>(env.tx, 'SELECT * FROM private_moderation_claims WHERE claim_id = ?', [a.p_claim_id]);
    if (!first) return { status: 'skipped' };
    const snap = await snapshot(env, first.target_table as string, first.target_id as string);
    const claim = await one<Row>(env.tx, 'SELECT * FROM private_moderation_claims WHERE claim_id = ? FOR UPDATE', [a.p_claim_id]);
    if (!claim || claim.finished || new Date(claim.claimed_until as string).getTime() <= Date.now()) return { status: 'skipped' };
    const mark = (sql: string) => exec(env.tx, `UPDATE private_moderation_claims SET ${sql} WHERE claim_id = ?`, [a.p_claim_id]);
    const release = () => exec(env.tx, 'UPDATE private_moderation_claims SET claimed_until = ? WHERE claim_id = ?', [toMysqlDatetime(new Date()), a.p_claim_id]);
    if (a.p_allow == null) { await release(); return { status: 'retry' }; }
    if (!jsonEqual(snap, claim.snapshot)) { await mark('finished = 1'); return { status: 'skipped' }; }
    if (a.p_allow && claim.target_table !== 'profiles' && (a.p_content_version !== 2 || String(snap!.content_version) !== '2')) {
      await release();
      return { status: 'retry', code: 'content_version_required' };
    }
    const reason = nonEmpty(pgTrim(a.p_reason ?? ''));
    const result = claim.target_table === 'profiles'
      ? await avatarModerationApply(env, claim.target_id as string, snap!.avatar_pending_path as string, snap!.avatar_requested_at, a.p_allow, reason, a.p_categories)
      : { status: await moderationApply(env, claim.target_table as string, claim.target_id as string, snap!.moderation_requested_at, a.p_allow, reason, a.p_categories) };
    await mark('finished = 1');
    return result;
  }
});
