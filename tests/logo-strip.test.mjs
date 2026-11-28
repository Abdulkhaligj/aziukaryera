import test from 'node:test';
import assert from 'node:assert/strict';
import { readSource as read } from './read-source.mjs';

test('the landing logo strip keeps one width: every logo is sized before it loads, none is lazy', () => {
  const landing = read('student-web/assets/js/landing.js');
  const responsive = read('student-web/assets/js/responsive.js');
  const app = read('student-web/assets/js/app.js');
  const css = read('student-web/assets/css/landing.css');
  const strip = landing.slice(landing.indexOf('const logoImg ='), landing.indexOf('const logoTilesCopy'));
  assert.doesNotMatch(strip, /loading="lazy"/, 'lazy pictures left white tiles and changed the strip width while it moved');
  assert.match(strip, /width="\$\{size\[0\]\}" height="\$\{size\[1\]\}"/);
  assert.match(responsive, /const w = Number\(img\.getAttribute\('width'\)\), h = Number\(img\.getAttribute\('height'\)\);/);
  assert.doesNotMatch(responsive, /addEventListener\('load'/, 'no resizing when a picture arrives');
  assert.doesNotMatch(css, /\.lp-logos:hover \.lp-track \{ animation-play-state: paused; \}/);
  // Every file in assets/logos has its size listed.
  const { readdirSync } = process.getBuiltinModule('node:fs');
  for (const file of readdirSync(new URL('../student-web/assets/logos/', import.meta.url))) {
    assert.match(app, new RegExp(`'${file.replace('.', '\\.')}': \\[\\d+, \\d+\\]`), file);
  }
});
