import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('password and untyped inputs share the base form styling', () => {
  const css = read('student-web/assets/css/styles.css');
  assert.match(css, /input\[type="password"\], input:not\(\[type\]\)/);
});

test('auth screen loads the professional stylesheet and clips the brand decoration on phones', () => {
  const index = read('student-web/index.html');
  const css = read('student-web/assets/css/auth-pro.css');
  assert.match(index, /auth-pro\.css\?v=20261029a/);
  assert.match(index, /styles\.css\?v=20261029a/);
  assert.match(css, /\.auth-pane\[hidden\] \{ display: none; \}/);
  assert.match(css, /@media \(max-width: 860px\) \{\s*\.auth-brand \{ position: relative; overflow: hidden; \}/);
});

test('registration is a three-step form that validates each step before moving on', () => {
  const app = read('student-web/assets/js/app.js');
  const form = app.slice(app.indexOf('function authRegisterForm('), app.indexOf('function validateAuthPane('));
  assert.match(app, /const AUTH_STEPS = \{/);
  assert.match(form, /data-act="auth-step-prev"/);
  assert.match(form, /data-act="auth-level"/);
  assert.doesNotMatch(form, /name="avatarUrl"/);
  assert.match(form, /Profil<\/b> bölməsindən yükləyə bilərsiniz/);
  assert.match(app, /if \(!validateAuthPane\(form\.querySelector\(`\.auth-pane\[data-step="\$\{step\}"\]`\)\)\) return;/);
  assert.match(app, /Auth\.validateEmail\(el\.value, UI\.auth\.role\)/);
  assert.match(app, /Auth\.validatePassword\(el\.value\)/);
});

test('Microsoft sign-in uses the four-square logo instead of a plain letter', () => {
  const app = read('student-web/assets/js/app.js');
  assert.match(app, /fill="#F25022"/);
  assert.doesNotMatch(app, /font-weight:800;color:#0078d4">M</);
});
