// Published content → broadcast notifications (private.publish_content_notification),
// updated_at touches, and the remaining audited tables.
import { one } from '../../db.ts';
import { after, before, columnDefault, insertRow, nowText, updateRow, type WriteEnv } from '../pipeline.ts';
import type { Row } from '../../db.ts';
import { audited, bakuText, changed, concatWs, left, nonEmpty, pgTrim } from './core.ts';

interface Broadcast { kind: string; title: string; body: string | null; link: string }

async function publish(env: WriteEnv, sourceType: string, sourceId: unknown, b: Broadcast) {
  const values = { kind: b.kind, title: b.title, body: b.body ?? '', link: b.link, created_by: env.ctx.uid ?? null };
  const existing = await one<{ id: string }>(env.tx, 'SELECT id FROM broadcast_notifications WHERE source_type = ? AND source_id = ? FOR UPDATE',
    [sourceType, sourceId]);
  if (existing) await updateRow(env, 'broadcast_notifications', { id: existing.id }, { ...values, created_at: nowText(env), updated_at: nowText(env) });
  else await insertRow(env, 'broadcast_notifications', { ...values, source_type: sourceType, source_id: sourceId });
}

const JOB_KIND: Record<string, [string, string]> = {
  tecrube: ['new_internship', 'Yeni təcrübə imkanı'],
  konullu: ['new_volunteer', 'Yeni könüllülük imkanı'],
  graduate: ['new_graduate_program', 'Yeni graduate proqramı']
};

/** Becomes published now: on INSERT, or when the column changed on UPDATE. */
const becomes = (row: Row, old: Row | null, column: string, published: boolean) => published && (!old || changed(row, old, column));

after('events', 'events_broadcast_notification', ['insert'], (env, row) => publish(env, 'events', row!.id, {
  kind: 'new_event', title: `Yeni tədbir: ${row!.title}`, link: 'events',
  body: concatWs(' · ', nonEmpty(row!.kind), nonEmpty(row!.place), bakuText(row!.starts_at))
}));

after('jobs', 'jobs_broadcast_notification', ['insert', 'update'], async (env, row, old) => {
  if (!row || !becomes(row, old, 'status', row.status === 'approved' || row.status === 'published')) return;
  const [kind, title] = JOB_KIND[row.type as string] ?? ['new_job', 'Yeni vakansiya'];
  await publish(env, 'jobs', row.id, { kind, title, body: row.title as string, link: 'jobs' });
}, ['status']);

after('benefits', 'benefits_broadcast_notification', ['insert', 'update'], async (env, row, old) => {
  if (!row || !becomes(row, old, 'active', row.active === true)) return;
  await publish(env, 'benefits', row.id, { kind: 'new_benefit', title: 'Yeni tələbə güzəşti', link: 'benefits',
    body: concatWs(' · ', row.title, nonEmpty(row.discount_label)) });
}, ['active']);

after('site_content', 'site_content_broadcast_notification', ['insert', 'update'], async (env, row, old) => {
  if (!row || !becomes(row, old, 'status', row.status === 'Aktiv')) return;
  await publish(env, 'site_content', row.id, { kind: 'new_content', title: row.title as string, link: 'dashboard',
    body: nonEmpty(row.summary) ?? left(row.body, 240) });
}, ['status']);

after('posts', 'posts_broadcast_notification', ['insert', 'update'], async (env, row, old) => {
  if (!row) return;
  const author = await one<{ role: string }>(env.tx, 'SELECT role FROM profiles WHERE id = ?', [row.author_id]);
  if (!becomes(row, old, 'moderation_status', author?.role === 'admin' && row.moderation_status === 'visible')) return;
  await publish(env, 'posts', row.id, { kind: 'new_post', title: 'Karyera Mərkəzindən yeni paylaşım', link: 'network',
    body: left(row.body, 240) });
}, ['moderation_status']);

// ads_touch → private.ads_touch; set_site_content_updated_at → touch_site_content_updated_at
before('ads', 'ads_touch', ['update'], (env, row) => { row.updated_at = nowText(env); });
before('site_content', 'set_site_content_updated_at', ['update'], (env, row) => { row.updated_at = nowText(env); });

// company_awards_touch → private.company_awards_touch
before('company_awards', 'company_awards_touch', ['insert', 'update'], (env, row) => {
  row.updated_at = nowText(env);
  row.nomination = pgTrim(row.nomination);
  row.company_name = pgTrim(row.company_name);
});

// DEFAULT auth.uid() (schema-followups.md).
for (const tableName of ['ads', 'company_awards']) columnDefault(tableName, 'created_by', env => env.ctx.uid ?? null);

for (const tableName of ['ads', 'benefit_partners', 'benefits', 'broadcast_notifications', 'company_awards', 'content',
  'events', 'moderation_logs', 'plan_features', 'plans', 'site_content']) audited(tableName);
for (const tableName of ['ai_usage', 'cv_documents', 'interview_sessions']) audited(tableName, ['delete']);
