// The AIDA guest challenge solver (audit v4, M-04) against Node's SHA-256.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const pow = createRequire(import.meta.url)('../student-web/assets/js/aida-pow.js');

test('the browser SHA-256 matches Node for short, block-edge and long inputs', () => {
  for (const text of ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'ə'.repeat(100), '0123456789abcdef0123456789abcdef:262143']) {
    const bytes = new TextEncoder().encode(text);
    assert.equal(Buffer.from(pow.sha256(bytes)).toString('hex'), createHash('sha256').update(bytes).digest('hex'), JSON.stringify(text.slice(0, 20)));
  }
});

test('a solved challenge has the asked zero bits, checked with Node', async () => {
  const salt = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
  const nonce = await pow.solve(salt, 12);
  const hash = createHash('sha256').update(`${salt}:${nonce}`).digest();
  assert.ok(pow.zeroBits(hash) >= 12);
  assert.equal(pow.zeroBits(Uint8Array.from([0, 0, 0x0f])), 20);
});
