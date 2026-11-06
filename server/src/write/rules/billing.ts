// Triggers on subscriptions, payments and company_members: plan
// normalisation, invoices (private.ensure_invoice), package quotas
// (private.apply_company_quota / reserve_company_quota) and usage sync.
import { exec, one, rows, toMysqlDatetime, type Row } from '../../db.ts';
import { DbRuleError } from '../../errors.ts';
import { insertRow, on, updateRow, type WriteEnv } from '../pipeline.ts';
import { audited, isAdmin, notifyAdmins } from './core.ts';

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString();
/** private.quota_month: first day of the UTC month. */
export const quotaMonth = (at: Date) => `${at.toISOString().slice(0, 7)}-01`;

// private.subscriptions_normalize
on('subscriptions', ['insert', 'update'], 'before', (env, row, old) => {
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

// private.subscriptions_request_invoice
on('subscriptions', ['insert', 'update'], 'after', async (env, row, old) => {
  if (row && row.requested_plan_id && row.requested_plan_id !== 'free' && (!old || old.requested_plan_id !== row.requested_plan_id)) {
    await ensureInvoice(env, row.company_id as string, row.requested_plan_id as string, 1);
  }
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

// private.apply_company_quota for company_members (team_members). The jobs
// and posts variants arrive with those tables in the data API milestone.
on('company_members', ['insert', 'update', 'delete'], 'after', async (env, row, old) => {
  const counted = (r: Row | null) => !!r && (r.status === 'invited' || r.status === 'active');
  const deltas = new Map<string, number>();
  if (old && counted(old)) deltas.set(old.company_id as string, (deltas.get(old.company_id as string) ?? 0) - 1);
  if (row && counted(row)) deltas.set(row.company_id as string, (deltas.get(row.company_id as string) ?? 0) + 1);
  const staff = await isAdmin(env);
  for (const [subject, delta] of [...deltas].filter(([, d]) => d !== 0).sort(([a], [b]) => a.localeCompare(b))) {
    let cap: number | null = null;
    const enforce = delta > 0 && !staff;
    if (enforce) {
      const limit = await activeLimit(env, row!.company_id as string, 'team_members');
      cap = limit.found ? limit.cap : 1;
    }
    await reserveCompanyQuota(env, subject, 'team_members', '0001-01-01', delta, cap, enforce);
  }
});

// public.sync_company_subscription_usage for company_members.
on('company_members', ['insert', 'update', 'delete'], 'after', async (env, row, old) => {
  const month = quotaMonth(env.now);
  const end = new Date(Date.UTC(env.now.getUTCFullYear(), env.now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  const companies = [...new Set([old?.company_id, row?.company_id].filter(Boolean) as string[])].sort();
  for (const companyId of companies) {
    const sub = await one<{ id: string }>(env.tx, `SELECT id FROM subscriptions WHERE company_id = ? AND status = 'active' ORDER BY id LIMIT 1`, [companyId]);
    if (!sub) continue;
    const used = await one<{ used_count: number }>(env.tx, `SELECT used_count FROM private_company_quota_counters
      WHERE subject_id = ? AND feature_key = 'team_members' AND period_start = '0001-01-01'`, [companyId]);
    await exec(env.tx, `INSERT INTO subscription_usage (subscription_id, feature_key, period_start, period_end, used_count, updated_at)
        VALUES (?, 'team_members', ?, ?, ?, CURRENT_TIMESTAMP(6)) AS fresh
        ON DUPLICATE KEY UPDATE used_count = fresh.used_count, period_end = fresh.period_end, updated_at = CURRENT_TIMESTAMP(6)`,
      [sub.id, month, end, used?.used_count ?? 0]);
  }
});

audited('company_members');
