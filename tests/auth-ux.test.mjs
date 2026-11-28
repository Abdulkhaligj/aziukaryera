import test from 'node:test';
import assert from 'node:assert/strict';
import { readSource as read } from './read-source.mjs';

test('password and untyped inputs share the base form styling', () => {
  const css = read('student-web/assets/css/styles.css');
  assert.match(css, /input\[type="password"\], input:not\(\[type\]\)/);
});

test('auth screen loads the professional stylesheet and clips the brand decoration on phones', () => {
  const index = read('student-web/index.html');
  const css = read('student-web/assets/css/auth-pro.css');
  assert.match(index, /auth-pro\.css\?v=20261128a/);
  assert.match(index, /styles\.css\?v=20261126e/);
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

test('Outlook sign-in is always on the sign-in form with its logo, "coming soon" until the server has it', () => {
  const app = read('student-web/assets/js/app.js');
  const dict = read('student-web/assets/js/i18n-dict.js');
  const sso = app.slice(app.indexOf('function ssoButtons('), app.indexOf('const AUTH_ICONS'));
  assert.match(app, /const OUTLOOK_LOGO = `<svg/);
  assert.match(sso, /const outlookReady = UI\.providers\.azure === true;/);
  assert.match(sso, /data-act="azure" \$\{busy \|\| !outlookReady \? 'disabled' : ''\}/);
  assert.match(sso, /\$\{OUTLOOK_LOGO\}/);
  assert.match(sso, /outlookReady \? '' : '<em class="sso-soon">Tezliklə<\/em>'/);
  assert.doesNotMatch(sso, /if \(UI\.providers\.azure === true\)/);
  for (const key of ['Outlook ilə daxil ol', 'Outlook ilə qeydiyyatdan keç', 'Tezliklə']) {
    assert.equal(dict.split(`"${key}":`).length - 1, 2, key);   // English and Russian
  }
});
