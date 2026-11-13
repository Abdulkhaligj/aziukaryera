// public.select_company_plan: a company owner or admin requests a package.
import { one, rows, toMysqlDatetime, type Row } from '../db.ts';
import { DbRuleError } from '../errors.ts';
import { insertRow, nowText, updateRow } from '../write/pipeline.ts';
import { ensureInvoice } from '../write/rules/billing.ts';
import { rpc } from './registry.ts';

rpc({
  name: 'select_company_plan', args: { p_plan_id: 'text' }, roles: ['authenticated'], security: 'definer', returns: 'value',
  async run(env, a) {
    const me = env.ctx.uid;
    const company = me ? await one<{ id: string }>(env.tx, `SELECT c.id FROM companies c
       WHERE c.owner_id = ? OR EXISTS (SELECT 1 FROM company_members m WHERE m.company_id = c.id AND m.profile_id = ?
         AND m.status = 'active' AND m.member_role IN ('owner', 'admin'))
       ORDER BY c.owner_id = ? DESC LIMIT 1`, [me, me, me]) : null;
    if (!company) throw new DbRuleError('Şirkət hesabı tapılmadı', 'P0001');
    if (!await one(env.tx, 'SELECT id FROM plans WHERE id = ? AND active', [a.p_plan_id])) throw new DbRuleError('Paket tapılmadı', 'P0001');
    // ON CONFLICT (company_id) DO NOTHING
    if (!await one(env.tx, 'SELECT id FROM subscriptions WHERE company_id = ? FOR UPDATE', [company.id])) {
      await insertRow(env, 'subscriptions', { company_id: company.id, plan_id: 'free', status: 'active' });
    }
    const sub = (await one<{ id: string }>(env.tx, 'SELECT id FROM subscriptions WHERE company_id = ?', [company.id]))!;
    if (a.p_plan_id === 'free') {
      // A paid plan stays until its end date; the lifecycle job moves it to Free.
      for (const p of await rows<{ id: string; metadata: Row | null }>(env.tx,
        `SELECT id, metadata FROM payments WHERE company_id = ? AND status = 'pending' AND plan_id IS NOT NULL ORDER BY id`, [company.id])) {
        await updateRow(env, 'payments', { id: p.id }, { status: 'cancelled', metadata: { ...(p.metadata ?? {}), cancelled_reason: 'company_selected_free' } });
      }
      const stored = await updateRow(env, 'subscriptions', { id: sub.id }, { requested_plan_id: null });
      return { ...stored, invoice: null };
    }
    // #42: at most three paid-plan requests (invoices) a day per company.
    await one(env.tx, 'SELECT id FROM subscriptions WHERE id = ? FOR UPDATE', [sub.id]);
    const today = Number((await one<{ n: number }>(env.tx, `SELECT COUNT(*) AS n FROM payments WHERE company_id = ? AND plan_id IS NOT NULL AND created_at >= ?`,
      [company.id, toMysqlDatetime(new Date(env.now.getTime() - 86_400_000))]))!.n);
    const reuses = await one(env.tx, `SELECT id FROM payments WHERE company_id = ? AND status = 'pending' AND plan_id = ? AND months = 1`, [company.id, a.p_plan_id]);
    if (!reuses && today >= 3) throw new DbRuleError('Bir gündə ən çox 3 paket sorğusu göndərmək olar. Sabah yenidən cəhd edin.', 'P0001');
    const stored = await updateRow(env, 'subscriptions', { id: sub.id }, { requested_plan_id: a.p_plan_id, requested_at: nowText(env) });
    const invoice = await ensureInvoice(env, company.id, a.p_plan_id, 1);
    return { ...stored, invoice };
  }
});
