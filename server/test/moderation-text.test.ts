// The word filter port, on behaviour read from the Postgres functions.
// Terms here are made up ("qwxz"); the real list lives in moderation_terms.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockedTerm, candidates, mask, moderationText, normaliseTerm, phraseLines, scripts, skel, tokens, type Term } from '../src/write/moderation-text.ts';

const term = (t: string, match = 'stem', script = 'latin', tier = 'A'): Term => ({ term: t, match, script, tier });

test('tokens: NFKC, lower case, accents removed, split on spaces and punctuation', () => {
  assert.deepEqual(tokens('Salam, Dünya!'), ['salam', 'dunya']);
  assert.deepEqual(tokens('  «Neft»  və\u{200b}Sənaye; ＡＢＣ '), ['neft', 'vəsənaye', 'abc']);
  assert.deepEqual(tokens('İŞIQ'), ['isiq'], 'dotted capital I and cedillas lose their marks');
  assert.deepEqual(tokens('...'), []);
});

test('scripts: latin by default, cyrillic and arabic by letters', () => {
  assert.deepEqual(scripts('salam'), ['latin']);
  assert.deepEqual(scripts('привет'), ['cyrillic']);
  assert.deepEqual(scripts('مرحبا'), ['arabic']);
  assert.deepEqual(scripts('123'), ['latin']);
  assert.deepEqual(scripts('aпривет'), ['latin', 'cyrillic']);
});

test('skeletons map look-alikes and collapse long repeats', () => {
  assert.equal(skel('heeeeey', 'latin'), 'hey');
  assert.equal(skel('h3ll0', 'latin'), 'heiio', 'digits become letters; l reads as i');
  assert.equal(skel('qwхz', 'latin'), 'qwxz', 'cyrillic х inside a latin word');
  assert.equal(skel('привет', 'cyrillic'), 'привет');
});

test('masks keep the visible letters and turn the rest into wildcards', () => {
  assert.equal(mask('q*xz', 'latin'), 'q.xz');
  assert.equal(mask('qw##', 'latin'), 'qw..');
  assert.equal(mask('***', 'latin'), null);
  assert.equal(mask('q***', 'latin'), null, 'more masks than letters');
});

test('candidates include tokens, masks, letter runs and short pairs', () => {
  const kinds = (s: string) => candidates(s).map(c => `${c.kind}:${c.cand}`);
  assert.ok(kinds('q w x z').includes('run:qwxz'));
  assert.ok(kinds('qw xz').includes('bigram:qwxz'));
  assert.ok(kinds('q*xz').includes('mask:q.xz'));
  assert.deepEqual(phraseLines('Bu QW xz idi'), [{ script: 'latin', line: ' bu qw xz idi ' }]);
});

test('normaliseTerm gives one script and a skeleton, or null', () => {
  assert.deepEqual(normaliseTerm(' QWXZ! '), { script: 'latin', term: 'qwxz' });
  assert.deepEqual(normaliseTerm('Qw  Xz'), { script: 'latin', term: 'qw xz' });
  assert.equal(normaliseTerm('qwxz привет'), null);
  assert.equal(normaliseTerm('!!!'), null);
});

test('moderationText joins body, link and tags', () => {
  assert.equal(moderationText('Salam', '', ['a', null, 'b']), 'Salam\na\nb');
  assert.equal(moderationText('', null, []), '');
});

test('blockedTerm: words, stems, roots, masks, phrases and the allow list', () => {
  assert.equal(blockedTerm('bu qwxz idi', [term('qwxz', 'word')], []), 'qwxz');
  assert.equal(blockedTerm('qwxzlar', [term('qwxz', 'word')], []), null, 'word terms need the whole word');
  assert.equal(blockedTerm('QWXZlar', [term('qwxz', 'stem')], []), 'qwxz');
  assert.equal(blockedTerm('aqwxzb', [term('wxz', 'infix')], []), 'wxz');
  assert.equal(blockedTerm('bu q*xz', [term('qwxz', 'word')], []), 'qwxz');
  assert.equal(blockedTerm('q w x z', [term('qwxz', 'word')], []), 'qwxz');
  assert.equal(blockedTerm('qw xz', [term('qwxz', 'word', 'latin', 'B')], []), null, 'split pairs only for tier A');
  assert.equal(blockedTerm('ah qw xz ah', [term('qw xz', 'word')], []), 'qw xz');
  assert.equal(blockedTerm('bu qwxz idi', [term('qwxz', 'word')], [{ word: 'qwxz', script: 'latin' }]), null);
  assert.equal(blockedTerm('salam \u{1f595}', [], []), '\u{1f595}');
  assert.equal(blockedTerm('Salam, necəsən?', [term('qwxz')], []), null);
});
