// Content moderation triggers: private.moderation_guard / moderation_request on
// posts and post_comments, profile avatar requests, term normalisation,
// the post media plan check, and private.moderation_send (the webhook to the
// moderation function, sent after commit as pg_net did).
import { onCommit, one, rows } from '../../db.ts';
import { DbRuleError } from '../../errors.ts';
import { blockedTerm, moderationText, normaliseTerm, type Allowed, type Term } from '../moderation-text.ts';
import { after, before, type WriteEnv } from '../pipeline.ts';
import { distinct, timestampText } from '../../values.ts';
import { audited, changed, companyHasFeature, privileged } from './core.ts';

const MAX_TEXT = 6000;
const MODERATION_FIELDS = ['moderation_status', 'moderation_reason', 'moderated_at', 'moderation_requested_at', 'moderation_attempts'];

/** The webhook secret, from the API environment (not the database: #73). */
let webhookSecret: string | null = null;
export function setModerationSecret(secret: string | undefined) { webhookSecret = secret || null; }

/** private.moderation_send: POST {table, id} to the configured endpoint once committed. */
export async function moderationSend(env: WriteEnv, tableName: string, id: unknown) {
  const config = await one<{ endpoint: string; secret: string }>(env.tx,
    'SELECT endpoint, secret FROM private_moderation_webhook_config WHERE singleton AND enabled');
  // Unconfigured: content stays pending and no external system is called.
  if (!config) return;
  onCommit(env.tx, async () => {
    const response = await fetch(config.endpoint, {
      method: 'POST', signal: AbortSignal.timeout(30_000),
      headers: { 'Content-Type': 'application/json', 'x-moderation-secret': webhookSecret ?? config.secret },
      body: JSON.stringify({ table: tableName, id })
    });
    await response.body?.cancel();
  });
}

/** True when the text contains an active moderation term (the word filter). */
export async function blocked(env: WriteEnv, text: string): Promise<boolean> {
  const terms = await rows<Term>(env.tx, 'SELECT term, `match`, script, tier FROM moderation_terms WHERE active');
  const allowed = await rows<Allowed>(env.tx, 'SELECT word, script FROM moderation_allow');
  return blockedTerm(text, terms, allowed) !== null;
}

for (const tableName of ['posts', 'post_comments']) {
  // posts_moderation_guard / post_comments_moderation_guard → private.moderation_guard
  before(tableName, `${tableName}_moderation_guard`, ['insert', 'update'], async (env, row, old) => {
    const trusted = await privileged(env);
    const isPost = tableName === 'posts';
    const text = isPost ? moderationText(row.body, row.link_url, row.tags) : moderationText(row.body);
    const edited = !old || changed(row, old, 'body') || (isPost && changed(row, old, 'link_url', 'tags'));
    if ([...text].length > MAX_TEXT) {
      // A trusted verdict may still hide an over-long legacy row; new or edited text is refused.
      if (!(old && !edited && trusted && row.moderation_status === 'hidden')) {
        throw new DbRuleError('Məzmun keçid və teqlərlə birlikdə ən çox 6000 simvol ola bilər.', '23514');
      }
    }
    if (!edited) {
      if (!trusted) for (const field of MODERATION_FIELDS) row[field] = old![field];
      else if (row.moderation_status === 'pending' && distinct(old!.moderation_status, 'pending')) {
        row.moderation_requested_at = timestampText(new Date());
        row.moderation_attempts = 0;
      }
      return;
    }
    if (!trusted && await blocked(env, text)) {
      throw new DbRuleError('Mətndə nalayiq ifadə var. Zəhmət olmasa, mətni düzəldib yenidən göndərin.', '23514');
    }
    // Every body/link/tag change starts a new moderation round, privileged edits included.
    row.moderation_status = 'pending';
    row.moderation_reason = null;
    row.moderated_at = null;
    row.moderation_requested_at = timestampText(new Date()); // clock_timestamp()
    row.moderation_attempts = 0;
  });

  // posts_moderation_request / post_comments_moderation_request → private.moderation_request
  after(tableName, `${tableName}_moderation_request`, ['insert', 'update'], async (env, row, old) => {
    if (row && row.moderation_status === 'pending' && (!old || changed(row, old, 'moderation_requested_at'))) {
      await moderationSend(env, tableName, row.id);
    }
  });
}

// profiles_avatar_request → private.profile_avatar_request
after('profiles', 'profiles_avatar_request', ['update'], async (env, row, old) => {
  if (row && row.avatar_pending_path != null && changed(row, old, 'avatar_requested_at')) await moderationSend(env, 'profiles', row.id);
}, ['avatar_pending_path', 'avatar_requested_at']);

// moderation_terms_normalize / moderation_allow_normalize → private.moderation_terms_normalize
for (const [tableName, column, trigger] of [['moderation_terms', 'term', 'moderation_terms_normalize'], ['moderation_allow', 'word', 'moderation_allow_normalize']]) {
  before(tableName, trigger, ['insert', 'update'], (_env, row) => {
    const normal = normaliseTerm(row[column] == null ? null : String(row[column]));
    if (!normal) throw new DbRuleError('Söz tanınmadı: bir əlifbada yazılmış söz və ya söz birləşməsi əlavə edin', '23514');
    row[column] = normal.term;
    row.script = normal.script;
  }, [column]);
}

// post_media_plan_limit → public.enforce_post_media_plan
before('post_media', 'post_media_plan_limit', ['insert'], async (env, row) => {
  const company = await one<{ id: string }>(env.tx,
    'SELECT c.id FROM posts p JOIN companies c ON c.owner_id = p.author_id WHERE p.id = ? LIMIT 1', [row.post_id]);
  if (company && !await companyHasFeature(env, company.id, 'post_media')) {
    throw new DbRuleError('Paketiniz şəkil və sənəd paylaşımını dəstəkləmir', 'P0001');
  }
});

audited('posts');
