// Ads and student benefits: active_ads, ad_track, claim_benefit, redeem_benefit_code.
import { randomUUID } from 'node:crypto';
import { codeHash, decryptField, encryptField } from '../crypto.ts';
import { exec, one, rows, toMysqlDatetime, type Row } from '../db.ts';
import { DbRuleError } from '../errors.ts';
import { insertRow, nowText, updateRow } from '../write/pipeline.ts';
import { isAdmin, pgTrim } from '../write/rules/core.ts';
import { rpc } from './registry.ts';
import { bakuDate, requireUid, utcDate } from './util.ts';

rpc({
  name: 'active_ads', readOnly: true, args: { p_placement: 'text' }, roles: ['anon', 'authenticated'], security: 'definer', returns: 'rows',
  run: (env, a) => rows(env.tx, `SELECT id, title, advertiser, description, image_url, link_url, cta_label, placement, priority
      FROM ads WHERE status = 'active' AND ? BETWEEN starts_on AND ends_on AND (? IS NULL OR placement = ?)
     ORDER BY priority DESC, created_at DESC LIMIT 20`, [bakuDate(env.now), a.p_placement, a.p_placement])
});

rpc({
  name: 'ad_track', args: { p_id: 'uuid', p_kind: 'text' }, roles: ['anon', 'authenticated'], security: 'definer', returns: 'void',
  // H-11: a visitor counts once per ad and kind every 30 minutes, and at most
  // 300 times an hour; more calls are accepted and not counted.
  limits: [
    { name: 'per-ad', count: 1, windowMs: 30 * 60_000, key: a => `${a.p_id}|${a.p_kind}`, silent: true },
    { name: 'per-client', count: 300, windowMs: 3_600_000, silent: true }
  ],
  async run(env, a) {
    if (a.p_kind !== 'view' && a.p_kind !== 'click') return;
    // A counter, not content: one UPDATE without an audit row per view.
    await exec(env.tx, `UPDATE ads SET ${a.p_kind === 'view' ? 'impressions = impressions + 1' : 'clicks = clicks + 1'}
       WHERE id = ? AND status = 'active' AND ? BETWEEN starts_on AND ends_on`, [a.p_id, bakuDate(env.now)]);
  }
});

/** public.new_claim_code */
const newClaimCode = () => `ASOIU-${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;

rpc({
  name: 'claim_benefit', args: { p_benefit: 'uuid' }, roles: ['authenticated'], security: 'definer', returns: 'row',
  async run(env, a) {
    const me = requireUid(env, 'Giriş tələb olunur');
    // Benefits are for active students and graduates (#65).
    const who = await one<{ role: string; status: string }>(env.tx, 'SELECT role, status FROM profiles WHERE id = ?', [me]);
    if (!who || who.status !== 'active' || !['student', 'graduate'].includes(who.role)) throw new DbRuleError('Güzəştlər yalnız aktiv tələbə və məzunlar üçündür', '42501');
    // The benefit row is locked, so two claims at once cannot both create a code (#65).
    const benefit = await one<{ valid_to: string | null }>(env.tx, 'SELECT valid_to FROM benefits WHERE id = ? AND active = 1 FOR UPDATE', [a.p_benefit]);
    if (!benefit) throw new DbRuleError('Güzəşt tapılmadı və ya aktiv deyil', 'P0002');
    if (benefit.valid_to != null && benefit.valid_to < utcDate(env.now)) throw new DbRuleError('Güzəştin müddəti bitib', '23514');
    const existing = await one(env.tx, `SELECT * FROM benefit_claims WHERE benefit_id = ? AND profile_id = ?
       AND redeemed_at IS NULL AND expires_at > ? LIMIT 1`, [a.p_benefit, me, toMysqlDatetime(env.now)]);
    if (existing) return { ...existing, code: decryptField(existing.code) };
    // The code is stored encrypted and found by its hash (#73).
    const code = newClaimCode();
    const stored = await insertRow(env, 'benefit_claims', { benefit_id: a.p_benefit, profile_id: me, code: encryptField(code), code_hash: codeHash(code) });
    return { ...stored, code };
  }
});

rpc({
  name: 'redeem_benefit_code', args: { p_code: 'text' }, roles: ['authenticated'], security: 'definer', returns: 'rows',
  async run(env, a) {
    const me = requireUid(env, 'Giriş tələb olunur');
    const code = a.p_code == null ? null : (pgTrim(a.p_code) as string).toUpperCase();
    // Locked: a code is redeemed once even when two partners try at the same time (#65).
    const claim = code == null ? null : await one<Row>(env.tx, 'SELECT * FROM benefit_claims WHERE code_hash = ? FOR UPDATE', [codeHash(code)]);
    const result = (status: string, student: unknown = null, faculty: unknown = null, benefit: unknown = null, partner: unknown = null, at: unknown = null) =>
      [{ status, student_name: student, faculty, benefit, partner, redeemed_at: at }];
    if (!claim) return result('tapilmadi');
    const benefit = await one<{ title: string; partner_id: string | null }>(env.tx, 'SELECT title, partner_id FROM benefits WHERE id = ?', [claim.benefit_id]);
    const partner = benefit?.partner_id ? await one<{ name: string; owner_id: string | null }>(env.tx,
      'SELECT name, owner_id FROM benefit_partners WHERE id = ?', [benefit.partner_id]) : null;
    if (!(await isAdmin(env) || (partner?.owner_id != null && partner.owner_id === me))) {
      throw new DbRuleError('Bu kodu təsdiqləmək icazəniz yoxdur', '42501');
    }
    const student = await one<{ full_name: string; faculty_id: string | null }>(env.tx, 'SELECT full_name, faculty_id FROM profiles WHERE id = ?', [claim.profile_id]);
    const faculty = student?.faculty_id ? (await one<{ name: string }>(env.tx, 'SELECT name FROM faculties WHERE id = ?', [student.faculty_id]))?.name : null;
    const details = [student?.full_name ?? null, faculty ?? '—', benefit?.title ?? null, partner?.name ?? null] as const;
    if (claim.redeemed_at != null) return result('istifade_olunub', ...details, claim.redeemed_at);
    if (new Date(claim.expires_at as string).getTime() < env.now.getTime()) return result('muddeti_bitib', ...details, null);
    await updateRow(env, 'benefit_claims', { id: claim.id }, { redeemed_at: nowText(env), redeemed_by: me });
    return result('tesdiqlendi', ...details, nowText(env));
  }
});
