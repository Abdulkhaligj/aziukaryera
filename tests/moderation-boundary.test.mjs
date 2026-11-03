import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const functions = new URL('../supabase/functions/', import.meta.url);
const strip = source => stripTypeScriptTypes(source.replace(/^import .*;\r?\n/gm, ''), { mode: 'strip' }).replace(/^export /gm, '');
const shared = strip(readFileSync(new URL('_shared/limits.ts', functions), 'utf8'));
const source = strip(readFileSync(new URL('content-moderation/index.ts', functions), 'utf8'));
const secret = 'x'.repeat(40);
function load(row, options = {}) {
  const state = { finishes: [], prompts: [], attempts: 0 };
  let handler;
  const db = {
    rpc: async (name, args) => {
      if (name === 'moderation_claim') return { data: { claimed: true, claim_id: 'claim', reservation_id: 'reservation', row }, error: null };
      if (name === 'ai_consume_provider_attempt') { state.attempts++; return { data: true, error: null }; }
      if (name === 'moderation_finish') {
        assert.equal(args.p_content_version, 2);
        state.finishes.push(args);
        return { data: { status: args.p_allow ? 'visible' : 'hidden' }, error: options.finishError ? { message: 'unavailable' } : null };
      }
      throw Error('Unexpected RPC ' + name);
    },
    from: () => ({ insert: async () => ({ error: null }) })
  };
  const context = {
    createClient: () => db, Response, Request, Headers, TextDecoder, Uint8Array, AbortSignal,
    Deno: { serve: fn => { handler = fn; }, env: { get: key => ({ SUPABASE_URL: 'https://offline.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture', GEMINI_API_KEY: 'fixture', MODERATION_WEBHOOK_SECRET: secret })[key] } },
    fetch: async (url, init) => {
      assert.match(url, /^https:\/\/generativelanguage\.googleapis\.com\//);
      const body = JSON.parse(init.body);
      state.prompts.push(body.contents[0].parts[0].text);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"verdict":"allow","categories":[],"reason":""}' }] } }] }));
    },
    console: { error() {} }
  };
  vm.runInNewContext(shared + '\n' + source + '\nglobalThis.formatText = moderationText;', context);
  return { handler, state, formatText: context.formatText };
}
const row = values => ({ content_version: 2, body: 'Normal post', link_url: null, tags: [], ...values });
const request = table => new Request('https://offline.invalid/moderation', { method: 'POST', headers: { 'x-moderation-secret': secret, 'content-type': 'application/json' }, body: JSON.stringify({ table, id: '11111111-1111-4111-8111-111111111111' }) });

test('normal full body, link and tags reach provider unchanged', async () => {
  const input = row({ body: 'Normal body', link_url: 'https://example.invalid/full', tags: ['first', null, '', 'last'] });
  const { handler, state } = load(input);
  const result = await (await handler(request('posts'))).json();
  assert.equal(result.status, 'visible');
  assert.equal(state.prompts.length, 1);
  assert.ok(state.prompts[0].endsWith('TEXT:\nNormal body\nhttps://example.invalid/full\nfirst\n\nlast'));
  assert.equal(state.finishes[0].p_allow, true);
});

test('unchecked suffix and overflowing link or tags never invoke the provider or publish', async () => {
  for (const input of [row({ body: 'A'.repeat(6000) + 'UNEXAMINED' }), row({ body: 'A'.repeat(6000), link_url: 'https://example.invalid/suffix' }), row({ body: 'A'.repeat(6000), tags: ['suffix'] })]) {
    const { handler, state } = load(input);
    const response = await (await handler(request('posts'))).json();
    assert.equal(response.status, 'hidden');
    assert.equal(response.code, 'invalid_content');
    assert.equal(state.prompts.length, 0);
    assert.equal(state.attempts, 0);
    assert.equal(state.finishes[0].p_allow, false);
  }
});

test('exact limit counts Unicode code points and separators, without dropping content', async () => {
  for (const text of ['A'.repeat(6000), '😀'.repeat(6000), 'e\u0301'.repeat(3000)]) {
    const { handler, state } = load(row({ body: text }));
    assert.equal((await (await handler(request('posts'))).json()).status, 'visible');
    assert.ok(state.prompts[0].endsWith('TEXT:\n' + text));
  }
  const { formatText } = load(row({}));
  assert.equal(formatText(row({ body: 'A'.repeat(5998), link_url: 'B' }), 'posts').length, 6000);
  assert.throws(() => formatText(row({ body: '😀'.repeat(6001) }), 'posts'), /too_long/);
  assert.throws(() => formatText(row({ body: 'A'.repeat(5999), link_url: 'B' }), 'posts'), /too_long/);
});

test('legacy snapshot and malformed content fail closed; finish errors stay explicit', async () => {
  for (const input of [{ body: 'Old snapshot' }, row({ body: null }), row({ tags: ['valid', 1] }), row({ link_url: 123 })]) {
    const { handler, state } = load(input);
    assert.equal((await (await handler(request('posts'))).json()).status, 'hidden');
    assert.equal(state.prompts.length, 0);
  }
  const { handler, state } = load(row({ body: 'A'.repeat(6001) }), { finishError: true });
  assert.equal((await handler(request('posts'))).status, 503);
  assert.equal(state.prompts.length, 0);
});

test('comment body uses the same full-input bound without post-only fields', async () => {
  const { handler, state } = load({ content_version: 2, body: 'Complete comment' });
  assert.equal((await (await handler(request('post_comments'))).json()).status, 'visible');
  assert.ok(state.prompts[0].endsWith('TEXT:\nComplete comment'));
  const long = load({ content_version: 2, body: '😀'.repeat(6001) });
  assert.equal((await (await long.handler(request('post_comments'))).json()).status, 'hidden');
  assert.equal(long.state.prompts.length, 0);
});
