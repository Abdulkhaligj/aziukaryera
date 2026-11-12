// The pg_cron jobs: private.avatar_moderation_retry and private.moderation_retry
// (every minute) and private.process_subscription_lifecycle (minute 7 of every hour).
import { rows, toMysqlDatetime, type Row } from '../db.ts';
import { nowText, updateRow, type WriteEnv } from '../write/pipeline.ts';
import { ensureInvoice, money } from '../write/rules/billing.ts';
import { bakuText, notifyAdmins, notifyCompany } from '../write/rules/core.ts';
import { moderationSend } from '../write/rules/moderation.ts';

const MINUTE = 60_000;
const DAY = 86_400_000;

/** private.avatar_moderation_retry: resend photos the moderation function has not decided. */
export async function avatarModerationRetry(env: WriteEnv) {
  const due = await rows<{ id: string; avatar_attempts: number }>(env.tx, `SELECT id, avatar_attempts FROM profiles
     WHERE avatar_pending_path IS NOT NULL AND avatar_requested_at < ? AND avatar_attempts < 5
     ORDER BY avatar_requested_at LIMIT 50`, [toMysqlDatetime(new Date(env.now.getTime() - MINUTE))]);
  for (const r of due) {
    await updateRow(env, 'profiles', { id: r.id }, { avatar_attempts: r.avatar_attempts + 1 });
    await moderationSend(env, 'profiles', r.id);
    if (r.avatar_attempts + 1 === 5) {
      await notifyAdmins(env, 'moderation_stuck', 'AI şəkil yoxlaması cavab vermir',
        'Profil şəkli 5 cəhddən sonra yoxlanılmayıb və gizli qalır. Admin paneldən əllə yoxlayın.', 'profile');
    }
  }
  return { sent: due.length, ran_at: nowText(env) };
}

/** private.moderation_retry: resend posts and comments still pending. */
export async function moderationRetry(env: WriteEnv) {
  const since = toMysqlDatetime(new Date(env.now.getTime() - MINUTE));
  const due = await rows<{ tbl: string; id: string; moderation_attempts: number }>(env.tx, `SELECT * FROM (
      SELECT 'posts' AS tbl, id, moderation_attempts, moderation_requested_at FROM posts
       WHERE moderation_status = 'pending' AND moderation_requested_at < ? AND moderation_attempts < 5
      UNION ALL
      SELECT 'post_comments', id, moderation_attempts, moderation_requested_at FROM post_comments
       WHERE moderation_status = 'pending' AND moderation_requested_at < ? AND moderation_attempts < 5) q
     ORDER BY moderation_requested_at LIMIT 50`, [since, since]);
  for (const r of due) {
    await updateRow(env, r.tbl, { id: r.id }, { moderation_attempts: r.moderation_attempts + 1 });
    await moderationSend(env, r.tbl, r.id);
    if (r.moderation_attempts + 1 === 5) {
      await notifyAdmins(env, 'moderation_stuck', 'AI moderasiyası cavab vermir',
        `${r.tbl === 'posts' ? 'Paylaşım' : 'Şərh'} 5 cəhddən sonra yoxlanılmayıb və gizli qalır. Admin paneldən əllə yoxlayın.`, 'network');
    }
  }
  return { sent: due.length, ran_at: nowText(env) };
}

/** private.process_subscription_lifecycle: reminders a week before the end, then the move to Free. */
export async function processSubscriptionLifecycle(env: WriteEnv) {
  const now = toMysqlDatetime(env.now);
  const expiring = await rows<Row>(env.tx, `SELECT s.id, s.company_id, s.plan_id, s.ends_at, s.requested_plan_id, p.name AS plan_name
      FROM subscriptions s JOIN plans p ON p.id = s.plan_id
     WHERE s.status = 'active' AND s.plan_id <> 'free' AND s.reminder_sent_at IS NULL AND s.ends_at > ? AND s.ends_at <= ?
       FOR UPDATE OF s SKIP LOCKED`, [now, toMysqlDatetime(new Date(env.now.getTime() + 7 * DAY))]);
  for (const r of expiring) {
    await updateRow(env, 'subscriptions', { id: r.id }, {
      reminder_sent_at: nowText(env), requested_plan_id: r.requested_plan_id ?? r.plan_id,
      ...(r.requested_plan_id == null ? { requested_at: nowText(env) } : {})
    });
    const invoice = await ensureInvoice(env, r.company_id as string, (r.requested_plan_id ?? r.plan_id) as string, 1);
    await notifyCompany(env, r.company_id, 'subscription_expiring', `${r.plan_name} paketinin müddəti bitir`,
      `${r.plan_name} paketi ${bakuText(r.ends_at, false)} tarixində bitir.`
      + (invoice ? ` Davam etmək üçün ${invoice.invoice_number} nömrəli hesab-fakturanı (${money(invoice.amount)} ${invoice.currency}) bank köçürməsi ilə ödəyin.` : ''));
  }
  const ended = await rows<Row>(env.tx, `SELECT s.id, s.company_id, s.plan_id, s.requested_plan_id, p.name AS plan_name
      FROM subscriptions s JOIN plans p ON p.id = s.plan_id
     WHERE s.status = 'active' AND s.plan_id <> 'free' AND s.ends_at <= ? FOR UPDATE OF s SKIP LOCKED`, [now]);
  for (const r of ended) {
    // The expired plan stays requested, so its pending invoice still reactivates the company when paid.
    await updateRow(env, 'subscriptions', { id: r.id }, {
      plan_id: 'free', starts_at: nowText(env), ends_at: null, reminder_sent_at: null, requested_plan_id: r.requested_plan_id ?? r.plan_id
    });
    await notifyCompany(env, r.company_id, 'subscription_expired', `${r.plan_name} paketinin müddəti bitdi`,
      `Hesabınız Free paketə keçdi. ${r.plan_name} imkanlarını bərpa etmək üçün hesab-fakturanı ödəyin.`);
  }
  return { reminded: expiring.length, expired: ended.length, ran_at: nowText(env) };
}

export interface Job { name: string; schedule: string; run: (env: WriteEnv) => Promise<Record<string, unknown>> }

/** Same names and schedules as the pg_cron jobs (cron.job). */
export const JOBS: Job[] = [
  { name: 'avatar-moderation-retry', schedule: '* * * * *', run: avatarModerationRetry },
  { name: 'content-moderation-retry', schedule: '* * * * *', run: moderationRetry },
  { name: 'subscription-lifecycle', schedule: '7 * * * *', run: processSubscriptionLifecycle }
];
