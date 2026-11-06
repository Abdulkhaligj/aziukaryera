// Triggers on subscriptions, payments, and the quota-counted tables
// (company_members, jobs, posts): plan normalisation, invoices
// (private.ensure_invoice), payment crediting (private.payments_apply),
// package quotas (private.apply_company_quota / reserve_company_quota) and
// usage sync (public.sync_company_subscription_usage).
import { exec, one, rows, toMysqlDatetime, type Row } from '../../db.ts';
import { DbRuleError } from '../../errors.ts';
import { after, before, insertRow, nowText, updateRow, type Op, type WriteEnv } from '../pipeline.ts';
import { audited, bakuText, changed, companyHasFeature, isAdmin, notifyAdmins, notifyCompany } from './core.ts';

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString();
/** private.quota_month: first day of the UTC month. */
export const quotaMonth = (at: Date) => `${at.toISOString().slice(0, 7)}-01`;
const FOREVER = '0001-01-01';

// subscriptions_normalize → private.subscriptions_normalize
before('subscriptions', 'subscriptions_normalize', ['insert', 'update'], (env, row, old) => {
  if (row.status === 'pending' && row.plan_id !== 'free') {
    row.requested_plan_id = row.plan_id;
    row.requested_at = iso(env.now);
    if (old && old.status === 'active') {
      row.plan_id = old.plan_id; row.status = old.status; row.starts_at = old.starts_at; row.ends_at = old.ends_at;
    } else {
      row.plan_id = 'free'; row.status = 'active'; row.starts_at = iso(env.now); row.ends_at = null;
    }
  }
  if (row.status === 'active' && row.plan_id !== 'free' && row.ends_at == null) {
    if (old && old.plan_id !== row.plan_id) row.starts_at = iso(env.now);
    row.ends_at = iso(new Date(new Date((row.starts_at as string) || env.now).getTime() + 30 * DAY));
  }
  if (row.plan_id === 'free') { row.ends_at = null; row.reminder_sent_at = null; }
  if (row.requested_plan_id === row.plan_id && row.status === 'active' && (!old || old.plan_id !== row.plan_id)) {
    row.requested_plan_id = null;
  }
});

/** private.ensure_invoice: one pending invoice per requested plan. */
export async function ensureInvoice(env: WriteEnv, companyId: string, planId: string, months: number): Promise<Row | null> {
  const plan = await one<{ id: string; name: string; monthly_price: number; currency: string }>(env.tx, 'SELECT * FROM plans WHERE id = ?', [planId]);
  if (!plan || plan.monthly_price <= 0) return null;
  const existing = await one(env.tx, `SELECT * FROM payments WHERE company_id = ? AND status = 'pending' AND plan_id = ? AND months = ?
    ORDER BY created_at DESC LIMIT 1`, [companyId, planId, months]);
  if (existing) return existing;
  for (const stale of await rows<{ id: string; metadata: Record<string, unknown> }>(env.tx,
    `SELECT id, metadata FROM payments WHERE company_id = ? AND status = 'pending' AND plan_id IS NOT NULL`, [companyId])) {
    await updateRow(env, 'payments', { id: stale.id }, { status: 'cancelled', metadata: { ...stale.metadata, cancelled_reason: 'replaced' } });
  }
  const sub = await one<{ id: string }>(env.tx, 'SELECT id FROM subscriptions WHERE company_id = ? LIMIT 1', [companyId]);
  const company = await one<{ name: string }>(env.tx, 'SELECT name FROM companies WHERE id = ?', [companyId]);
  await exec(env.tx, `UPDATE private_sequences SET value = LAST_INSERT_ID(value + 1) WHERE name = 'invoice_seq'`);
  const seq = await one<{ n: number }>(env.tx, 'SELECT LAST_INSERT_ID() AS n');
  const bakuYear = new Date(env.now.getTime() + 4 * 3_600_000).getUTCFullYear();
  const invoice = await insertRow(env, 'payments', {
    company_id: companyId, subscription_id: sub?.id ?? null, provider: 'bank_transfer',
    amount: Math.round(plan.monthly_price * months * 100) / 100, currency: plan.currency, status: 'pending',
    plan_id: planId, months, invoice_number: `KM-${bakuYear}-${String(seq!.n).padStart(5, '0')}`,
    due_at: iso(new Date(env.now.getTime() + 10 * DAY)),
    metadata: { plan_name: plan.name, company_name: company?.name ?? null }
  });
  await notifyAdmins(env, 'invoice_created', `Yeni hesab-faktura: ${invoice.invoice_number}`,
    `${company?.name || 'Şirkət'} — ${plan.name}, ${invoice.amount} ${invoice.currency}. Ödəniş daxil olanda fakturanı "ödənildi" kimi qeyd edin.`);
  return invoice;
}

// subscriptions_request_invoice → private.subscriptions_request_invoice
// (AFTER INSERT OR UPDATE OF requested_plan_id)
after('subscriptions', 'subscriptions_request_invoice', ['insert', 'update'], async (env, row, old) => {
  if (row && row.requested_plan_id && row.requested_plan_id !== 'free' && (!old || old.requested_plan_id !== row.requested_plan_id)) {
    await ensureInvoice(env, row.company_id as string, row.requested_plan_id as string, 1);
  }
}, ['requested_plan_id']);

// payments_apply → private.payments_apply: a paid invoice credits its plan once.
before('payments', 'payments_apply', ['insert', 'update'], async (env, row, old) => {
  if (changed(row, old, 'id')) throw new DbRuleError('Invoice identifiers are immutable');
  const credited = await one<{ company_id: string; plan_id: string; months: number; credited_at: string }>(env.tx,
    'SELECT * FROM private_payment_entitlements WHERE payment_id = ?', [row.id]);
  if (credited) {
    if (row.company_id !== credited.company_id || row.plan_id !== credited.plan_id || row.months !== credited.months) {
      throw new DbRuleError('Credited invoice identity and period are immutable');
    }
    row.paid_at = credited.credited_at;
    return;
  }
  if (row.status !== 'paid') return;
  row.paid_at ??= nowText(env);
  if (row.plan_id == null) return;
  const plan = await one<{ name: string }>(env.tx, 'SELECT name FROM plans WHERE id = ?', [row.plan_id]);
  const months = Number(row.months);
  if (!plan || !(months >= 1 && months <= 12)) throw new DbRuleError('Invalid invoice plan or period');
  const claim = await exec(env.tx, `INSERT INTO private_payment_entitlements (payment_id, company_id, plan_id, months, credited_at)
      VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE payment_id = payment_id`,
    [row.id, row.company_id, row.plan_id, months, toMysqlDatetime(env.now)]);
  if (claim.affectedRows !== 1) return;
  if (!await one(env.tx, 'SELECT id FROM subscriptions WHERE company_id = ? FOR UPDATE', [row.company_id])) {
    await insertRow(env, 'subscriptions', { company_id: row.company_id, plan_id: 'free', status: 'active' });
  }
  const sub = (await one<Row>(env.tx, 'SELECT * FROM subscriptions WHERE company_id = ? FOR UPDATE', [row.company_id]))!;
  const extend = sub.plan_id === row.plan_id && sub.status === 'active' && sub.ends_at != null
    && new Date(sub.ends_at as string).getTime() > env.now.getTime();
  const base = extend ? new Date(sub.ends_at as string) : env.now;
  const updated = (await updateRow(env, 'subscriptions', { id: sub.id }, {
    plan_id: row.plan_id, status: 'active',
    starts_at: extend ? sub.starts_at : iso(env.now),
    ends_at: iso(new Date(base.getTime() + 30 * months * DAY)),
    requested_plan_id: sub.requested_plan_id === row.plan_id ? null : sub.requested_plan_id,
    approved_by: env.ctx.uid ?? sub.approved_by, reminder_sent_at: null
  }))!;
  row.subscription_id = updated.id;
  await notifyCompany(env, row.company_id, 'subscription_active', `${plan.name} paketi aktivdir`,
    `Ödəniş qəbul edildi. Paket ${bakuText(updated.ends_at, false)} tarixinədək aktivdir.`);
});

audited('subscriptions');
audited('payments');
audited('notifications', ['delete']);

/** private.reserve_company_quota: atomic counter with an optional cap. */
export async function reserveCompanyQuota(env: WriteEnv, subject: string, feature: string, period: string, delta: number, limit: number | null, enforce: boolean) {
  if (limit !== null && limit < 0) throw new DbRuleError('Invalid negative quota limit');
  await exec(env.tx, `INSERT IGNORE INTO private_company_quota_counters (subject_id, feature_key, period_start, used_count) VALUES (?, ?, ?, 0)`,
    [subject, feature, period]);
  const result = await exec(env.tx, `UPDATE private_company_quota_counters SET used_count = used_count + ?
      WHERE subject_id = ? AND feature_key = ? AND period_start = ? AND used_count + ? >= 0
        AND (? <= 0 OR NOT ? OR ? IS NULL OR used_count + ? <= ?)`,
    [delta, subject, feature, period, delta, delta, enforce, limit, delta, limit]);
  if (result.affectedRows === 0) {
    if (delta > 0) throw new DbRuleError('Paketinizin limiti dolub');
    throw new DbRuleError('Quota accounting is inconsistent; operation rolled back');
  }
}

async function activeLimit(env: WriteEnv, companyId: string, feature: string): Promise<{ found: boolean; cap: number | null }> {
  const row = await one<{ limit_value: number | null }>(env.tx, `SELECT pf.limit_value FROM subscriptions s
      JOIN plan_features pf ON pf.plan_id = s.plan_id
     WHERE s.company_id = ? AND s.status = 'active' AND (s.starts_at IS NULL OR s.starts_at <= ?)
       AND (s.plan_id = 'free' OR s.ends_at > ?) AND pf.feature_key = ? AND pf.enabled
     ORDER BY s.starts_at IS NULL, s.starts_at DESC, s.id LIMIT 1`,
    [companyId, toMysqlDatetime(env.now), toMysqlDatetime(env.now), feature]);
  return row ? { found: true, cap: row.limit_value } : { found: false, cap: null };
}

type QuotaTable = 'company_members' | 'jobs' | 'posts';
const FEATURE: Record<QuotaTable, string> = { company_members: 'team_members', jobs: 'active_vacancies', posts: 'monthly_network_posts' };
const COUNTED: Record<'company_members' | 'jobs', string[]> = {
  company_members: ['invited', 'active'], jobs: ['pending', 'pending_approval', 'approved', 'published']
};

/** private.apply_company_quota (trigger 000_atomic_company_quota). */
async function applyCompanyQuota(env: WriteEnv, tableName: QuotaTable, row: Row | null, old: Row | null) {
  const feature = FEATURE[tableName];
  const staff = await isAdmin(env);
  const entries: { subject: string; period: string; delta: number }[] = [];
  let company: string | null = null;
  if (tableName !== 'posts') {
    const counted = (r: Row) => COUNTED[tableName].includes(r.status as string);
    if (old && counted(old)) entries.push({ subject: old.company_id as string, period: FOREVER, delta: -1 });
    if (row && counted(row)) entries.push({ subject: row.company_id as string, period: FOREVER, delta: 1 });
    company = (row?.company_id as string | undefined) ?? null;
  } else {
    if (old) entries.push({ subject: old.author_id as string, period: quotaMonth(new Date(old.created_at as string)), delta: -1 });
    if (row) {
      if (row.author_id == null || row.created_at == null) throw new DbRuleError('Post author and creation time are required');
      // Browser createPost omits created_at (its default is now()). An ordinary
      // author may neither backdate an INSERT nor move a post to another
      // owner's or month's bucket; trusted imports can.
      if ((env.ctx.role === 'authenticated' || env.ctx.role === 'anon') && !staff) {
        const backdated = !old && new Date(row.created_at as string).getTime() !== env.now.getTime();
        if (backdated || changed(row, old, 'author_id', 'created_at')) {
          throw new DbRuleError('Post author and creation time are server-owned', '42501');
        }
      }
      entries.push({ subject: row.author_id as string, period: quotaMonth(new Date(row.created_at as string)), delta: 1 });
      company = (await one<{ id: string }>(env.tx, `SELECT id FROM companies WHERE owner_id = ? AND status = 'active' ORDER BY id LIMIT 1`,
        [row.author_id]))?.id ?? null;
      if (company && row.attachment_url != null && (!old || changed(row, old, 'attachment_url', 'author_id'))
        && !await companyHasFeature(env, company, 'post_media')) {
        throw new DbRuleError('Paketiniz şəkil və sənəd paylaşımını dəstəkləmir');
      }
    }
  }
  // An edit or invited→active move has delta zero and stays usable at the cap;
  // a deterministic key order also covers moves between subjects.
  const sums = new Map<string, { subject: string; period: string; delta: number }>();
  for (const e of entries) {
    const key = `${e.subject}\u0000${e.period}`;
    sums.set(key, { ...e, delta: (sums.get(key)?.delta ?? 0) + e.delta });
  }
  const deltas = [...sums.values()].filter(d => d.delta !== 0)
    .sort((a, b) => (a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : a.period < b.period ? -1 : a.period > b.period ? 1 : 0));
  for (const d of deltas) {
    let cap: number | null = null;
    let enforce = false;
    if (d.delta > 0) {
      // Historical imports keep their bucket; the current month is governed by the current package.
      enforce = feature === 'monthly_network_posts' ? company !== null && d.period === quotaMonth(env.now) : !staff;
      if (enforce) {
        const limit = await activeLimit(env, company!, feature);
        if (!limit.found) {
          if (feature === 'monthly_network_posts') throw new DbRuleError('Aktiv şirkət paketiniz yoxdur');
          cap = 1;
        } else cap = limit.cap;
      }
    }
    await reserveCompanyQuota(env, d.subject, feature, d.period, d.delta, cap, enforce);
  }
}

/** public.sync_company_subscription_usage */
async function syncUsage(env: WriteEnv, tableName: QuotaTable, row: Row | null, old: Row | null) {
  const feature = FEATURE[tableName];
  const month = quotaMonth(env.now);
  const end = new Date(Date.UTC(env.now.getUTCFullYear(), env.now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  const posts = tableName === 'posts';
  const ids = [...new Set([old, row].map(r => r?.[posts ? 'author_id' : 'company_id']).filter(v => v != null))];
  if (!ids.length) return;
  const companies = await rows<{ id: string; owner_id: string }>(env.tx,
    `SELECT id, owner_id FROM companies WHERE ${posts ? 'owner_id' : 'id'} IN (${ids.map(() => '?').join(', ')}) ORDER BY id`, ids);
  for (const company of companies) {
    const sub = await one<{ id: string }>(env.tx, `SELECT id FROM subscriptions WHERE company_id = ? AND status = 'active' ORDER BY id LIMIT 1`, [company.id]);
    if (!sub) continue;
    const used = await one<{ used_count: number }>(env.tx, `SELECT used_count FROM private_company_quota_counters
      WHERE subject_id = ? AND feature_key = ? AND period_start = ?`, [posts ? company.owner_id : company.id, feature, posts ? month : FOREVER]);
    await exec(env.tx, `INSERT INTO subscription_usage (subscription_id, feature_key, period_start, period_end, used_count, updated_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP(6)) AS fresh
        ON DUPLICATE KEY UPDATE used_count = fresh.used_count, period_end = fresh.period_end, updated_at = CURRENT_TIMESTAMP(6)`,
      [sub.id, feature, month, end, used?.used_count ?? 0]);
  }
}

const ALL: Op[] = ['insert', 'update', 'delete'];
const SYNC_TRIGGER: Record<QuotaTable, string> = { company_members: 'members_sync_usage', jobs: 'jobs_sync_usage', posts: 'posts_sync_usage' };
for (const tableName of ['company_members', 'jobs', 'posts'] as QuotaTable[]) {
  after(tableName, '000_atomic_company_quota', ALL, (env, row, old) => applyCompanyQuota(env, tableName, row, old));
  after(tableName, SYNC_TRIGGER[tableName], ALL, (env, row, old) => syncUsage(env, tableName, row, old));
}

audited('company_members');
