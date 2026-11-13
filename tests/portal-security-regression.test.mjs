import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// Actual application functions execute with browser/React/Auth I/O boundaries
// mocked. No production requests, token, personal record, payment or AI use.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const portal = fs.existsSync(path.join(repo, 'student-web'))
  ? path.join(repo, 'student-web') : path.resolve(repo, '../esas-sayt-student-web');
const read = name => fs.readFileSync(path.join(portal, name), 'utf8');
const backendSource = read('assets/js/backend.js');
const authSource = read('assets/js/auth.js');
const appSource = read('assets/js/app.js');
const draftsSource = read('assets/js/cv-drafts.js');
const cvSource = read('cv-builder.html');
const settle = async () => { await new Promise(resolve => setTimeout(resolve, 5)); };
function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key), values
  };
}
function makeMain(storage, behavior = async () => ({ error: null })) {
  const notices = [];
  let calls = 0, purges = 0;
  const sdk = { auth: { signOut: async () => { calls++; return behavior(); } } };
  const context = vm.createContext({
    USE_BACKEND: true, API_URL: 'https://test.invalid', API_KEY: 'public',
    window: { ApiClient: { createClient: () => sdk }, CVDrafts: { clear() { purges++; }, connect: async () => null } },
    localStorage: storage, document: { getElementById: () => null },
    Store: { mode: 'remote', state: { session: { userId: 'student-A' } }, bind() {}, save() {} },
    UI: {}, Landing: { load: () => Promise.resolve() },
    stopNotificationUpdates() {}, resetAuthForm() {}, rerender() {},
    toast: value => notices.push(value), console
  });
  const clearStart = appSource.indexOf('function clearPrivateSessionUI() {');
  const clearEnd = appSource.indexOf('window.CVDrafts?.subscribe', clearStart);
  vm.runInContext(appSource.slice(clearStart, clearEnd), context);
  vm.runInContext(backendSource + '\nglobalThis.Backend = Backend;', context);
  context.Backend.sb = sdk;
  vm.runInContext(authSource + '\nglobalThis.Auth = Auth;', context);
  const start = appSource.indexOf("case 'logout':");
  const end = appSource.indexOf("case 'auth-tab':", start);
  const runLogout = () => vm.runInContext("switch ('logout') {\n" + appSource.slice(start, end) + '\n}', context);
  return { context, notices, runLogout, get calls() { return calls; }, get purges() { return purges; } };
}

function makeBuilder(storage, owner = null) {
  const state = [], refs = [], effectSlots = [], listeners = new Map();
  let cursor = 0, refCursor = 0, effectCursor = 0, pending = [], dirty = false, capturedRoot, tree;
  const React = {
    createContext: initial => ({ initial }),
    useContext: context => context.initial,
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat() }),
    forwardRef: fn => fn,
    useState(initial) {
      const i = cursor++;
      if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial;
      return [state[i], value => {
        const next = typeof value === 'function' ? value(state[i]) : value;
        if (!Object.is(next, state[i])) { state[i] = next; dirty = true; }
      }];
    },
    useRef(initial) { const i = refCursor++; return refs[i] ||= { current: initial }; },
    useEffect(fn, deps) {
      const i = effectCursor++;
      const old = effectSlots[i];
      if (!old || !deps || deps.some((dep, j) => !Object.is(dep, old.deps[j]))) {
        pending.push(() => {
          if (old?.cleanup) old.cleanup();
          effectSlots[i] = { deps, cleanup: fn() };
        });
      }
    },
    useMemo: fn => fn(), useCallback: fn => fn
  };
  const window = {
    addEventListener(name, fn) { const set = listeners.get(name) || new Set(); set.add(fn); listeners.set(name, set); },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn); }
  };
  window.parent = window;
  let currentOwner = owner;
  const callbacks = [];
  window.ApiClient = { createClient: () => ({ auth: {
    getUser: async () => ({ data: { user: currentOwner ? { id: currentOwner } : null }, error: null }),
    onAuthStateChange: callback => { callbacks.push(callback); return { data: { subscription: { unsubscribe() {} } } }; }
  } }) };
  const context = vm.createContext({
    React, ReactDOM: { createRoot: () => ({ render: value => { capturedRoot = value; } }) },
    window, document: { getElementById: () => ({}) },
    location: { origin: 'https://staging.invalid' }, localStorage: storage,
    setTimeout, clearTimeout, console, URL, Blob, crypto,
    USE_BACKEND: true, CAREER_DEMO_MODE: false,
    API_URL: "https://test.invalid", API_KEY: "public",
  });
  vm.runInContext(draftsSource, context);
  const start = cvSource.indexOf('function __RUN_APP__() {');
  const end = cvSource.indexOf('</script>', start);
  assert.ok(start > 0 && end > start, 'Original CV factory must exist');
  vm.runInContext(cvSource.slice(start, end) + '\n__RUN_APP__();', context);
  const component = capturedRoot.children[0].type;
  function render() {
    let rounds = 0;
    do {
      dirty = false; cursor = refCursor = effectCursor = 0; pending = [];
      tree = component();
      for (const effect of pending) effect();
      assert.ok(++rounds < 10, 'Mock hook render should settle');
    } while (dirty);
    return tree;
  }
  function find(node, predicate) {
    if (!node || typeof node !== 'object') return null;
    if (predicate(node)) return node;
    for (const child of node.children || []) { const found = find(child, predicate); if (found) return found; }
    return null;
  }
  return {
    render, listeners, context,
    emit(name, event = {}) { for (const fn of listeners.get(name) || []) fn(event); },
    async owner(value) {
      currentOwner = value;
      for (const callback of callbacks) callback(value ? 'SIGNED_IN' : 'SIGNED_OUT', value ? { user: { id: value } } : null);
      await settle();
      render();
    },
    form: () => find(tree, node => node.type?.name === 'ResumeForm'),
    action: name => find(tree, node => node.props?.onClick?.name === name),
    data: () => state[2]
  };
}


// Audit 2026-11-13, #80: a failed server call no longer leaves the device signed
// in; the session is forgotten locally and the person is told the server was not reached.
test('without a connection logout still forgets the session on this device and says so', async () => {
  for (const behavior of [async () => ({ error: { message: 'network error' } }), async () => { throw new Error('offline'); }]) {
    const main = makeMain(memoryStorage(), behavior);
    let removed = 0;
    main.context.Backend.sb.auth._removeSession = async () => { removed++; };
    const result = await main.context.Backend.signOut();
    assert.equal(result.ok, false);
    main.runLogout();
    await settle();
    assert.equal(main.context.Store.state.session, null);
    assert.equal(removed, 1);
    assert.equal(main.purges, 1);
    assert.ok(main.notices.includes('Serverə çıxış bildirilmədi, amma bu cihazda sessiya bağlandı.'));
    assert.ok(!main.notices.includes('Sistemdən çıxdınız'));
  }
});

test('logout waits for SDK success, prevents duplicate clicks, then clears local state', async () => {
  let resolve;
  const main = makeMain(memoryStorage(), () => new Promise(done => { resolve = done; }));
  main.runLogout(); main.runLogout();
  assert.equal(main.calls, 1);
  assert.ok(main.context.Store.state.session);
  assert.equal(main.notices.length, 0);
  resolve({ error: null });
  await settle();
  assert.equal(main.context.Store.state.session, null);
  assert.equal(main.purges, 1);
  assert.ok(main.notices.includes('Sistemdən çıxdınız'));
});

test('anonymous CV never restores old global data or persists newly entered PII', async () => {
  const storage = memoryStorage({ 'asoiu-cv-builder-draft': JSON.stringify({ name: 'Old student' }) });
  const editor = makeBuilder(storage);
  editor.render(); await settle(); editor.render();
  assert.notEqual(editor.data().name, 'Old student');
  const scope = editor.context.window.CVDrafts.snapshot();
  assert.equal(scope, null);
  assert.equal(editor.context.window.CVDrafts.put('draft', { name: 'Anonymous private' }, scope), false);
  assert.ok(![...storage.values.values()].some(value => value.includes('Anonymous private')));
});

test('verified owner restores only its versioned draft and keeps normal edits', async () => {
  const storage = memoryStorage();
  const editor = makeBuilder(storage, 'student-A');
  editor.render(); await settle(); editor.render();
  const drafts = editor.context.window.CVDrafts;
  const scope = drafts.snapshot();
  assert.equal(scope.ownerId, 'student-A');
  assert.equal(drafts.put('profile', { name: 'Student A', contact: { email: 'a@example.invalid' } }, scope), true);
  // Refresh the editor as a real new tab would do.
  const reopened = makeBuilder(storage, 'student-A');
  reopened.render(); await settle(); reopened.render();
  assert.equal(reopened.data().name, 'Student A');
  reopened.form().props.setData(previous => ({ ...previous, name: 'Edited A' }));
  reopened.render();
  assert.equal(reopened.context.window.CVDrafts.get('draft').name, 'Edited A');
});

test('same-document logout clears the open editor and rejects old render callbacks', async () => {
  const storage = memoryStorage();
  const first = makeBuilder(storage, 'student-A');
  first.render(); await settle(); first.render();
  const scope = first.context.window.CVDrafts.snapshot();
  first.context.window.CVDrafts.put('profile', { name: 'Private A' }, scope);
  const editor = makeBuilder(storage, 'student-A');
  editor.render(); await settle(); editor.render();
  const staleForm = editor.form();
  assert.equal(editor.data().name, 'Private A');
  await editor.owner(null);
  assert.notEqual(editor.data().name, 'Private A');
  assert.equal(editor.form(), null);
  staleForm.props.setData(previous => ({ ...previous, name: 'Recreated A' }));
  editor.render();
  assert.notEqual(editor.data().name, 'Recreated A');
  assert.equal(editor.context.window.CVDrafts.put('draft', { name: 'Recreated A' }, scope), false);
  assert.ok(![...storage.values.values()].some(value => value.includes('Private A') || value.includes('Recreated A')));
});

test('cross-tab logout invalidates writes immediately and storage event purges memory', async () => {
  const storage = memoryStorage();
  const writer = makeBuilder(storage, 'student-A');
  writer.render(); await settle(); writer.render();
  const scope = writer.context.window.CVDrafts.snapshot();
  writer.context.window.CVDrafts.put('profile', { name: 'Private A' }, scope);
  const editor = makeBuilder(storage, 'student-A');
  editor.render(); await settle(); editor.render();
  assert.equal(editor.data().name, 'Private A');
  writer.context.window.CVDrafts.clear();
  // No stale re-save even before the browser dispatches the storage event.
  assert.equal(editor.context.window.CVDrafts.put('draft', { name: 'Stale A' }, scope), false);
  editor.emit('storage', { key: 'asoiu-cv-session-v2' }); editor.render();
  assert.notEqual(editor.data().name, 'Private A');
  assert.equal(editor.form(), null);
  const anonymous = makeBuilder(storage);
  anonymous.render(); await settle(); anonymous.render();
  assert.notEqual(anonymous.data().name, 'Private A');
});

test('account replacement cannot put old data under the new owner', async () => {
  const storage = memoryStorage();
  const editor = makeBuilder(storage, 'student-A');
  editor.render(); await settle(); editor.render();
  const oldScope = editor.context.window.CVDrafts.snapshot();
  editor.context.window.CVDrafts.put('profile', { name: 'Student A' }, oldScope);
  await editor.owner('student-B');
  const newScope = editor.context.window.CVDrafts.snapshot();
  assert.equal(newScope.ownerId, 'student-B');
  assert.notEqual(newScope.revision, oldScope.revision);
  assert.equal(editor.context.window.CVDrafts.put('draft', { name: 'Student A' }, oldScope), false);
  assert.equal(editor.context.window.CVDrafts.get('draft', newScope), null);
  assert.ok(![...storage.values.values()].some(value => value.includes('Student A')));
});

test('unconfigured default does not point at the sender project or enable implicit demo auth', () => {
  const context = vm.createContext({ window: {} });
  vm.runInContext(read('assets/js/config.js') + '\nglobalThis.config = { API_URL, USE_BACKEND, CAREER_DEMO_MODE };', context);
  assert.equal(context.config.API_URL, '');
  assert.equal(context.config.USE_BACKEND, false);
  assert.equal(context.config.CAREER_DEMO_MODE, false);
});

test('external executable dependencies are exact versions with SHA384 integrity', () => {
  const index = read('index.html');
  // The data client library ships with the site (same origin), pinned to one version.
  assert.match(index, /<script src="assets\/vendor\/api-client\.min\.js\?v=[0-9a-z]+" integrity="sha384-[A-Za-z0-9+\/=]+"><\/script>/);
  assert.match(read('assets/vendor/api-client.min.js'), /^\/\*! Data client library \(MIT\), v2\.58\.0/);
  assert.match(cvSource, /react@18\.3\.1/);
  assert.match(cvSource, /react-dom@18\.3\.1/);
  assert.doesNotMatch(cvSource, /react(?:-dom)?@18\//);
  assert.match(cvSource, /s\.integrity = srcs\[i\]\.integrity/);
  assert.match(appSource, /s\.integrity = 'sha384-[^']+'/);
  assert.doesNotMatch(cvSource, /s\.src = 'https:\/\/gumroad/);
});


test('anonymous manual CV workflow still edits in memory', async () => {
  const editor = makeBuilder(memoryStorage());
  editor.render(); await settle(); editor.render();
  const sample = editor.action('handleSample');
  assert.ok(sample, 'sample/manual entry remains available');
  sample.props.onClick(); editor.render();
  assert.ok(editor.form());
  editor.form().props.setData(previous => ({ ...previous, name: 'Manual resume' }));
  editor.render();
  assert.equal(editor.data().name, 'Manual resume');
});

test('shipped CSP hashes match every actual inline script and no inline handlers remain', () => {
  for (const html of [read('index.html'), cvSource]) {
    const policy = /http-equiv="Content-Security-Policy" content="([^"]+)"/i.exec(html)?.[1];
    assert.ok(policy);
    assert.doesNotMatch(policy, /script-src[^;]*unsafe-inline|unsafe-eval/);
    assert.doesNotMatch(html, /\son(?:click|load|error|change|submit)=/i);
    for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (/\bsrc\s*=/i.test(match[1]) || !match[2].trim()) continue;
      const hash = 'sha256-' + createHash('sha256').update(match[2]).digest('base64');
      assert.ok(policy.includes(hash), 'CSP must be regenerated after script edits');
    }
  }
});

test('audit 2026-11-13: the data client carries the integrity of the shipped file (#85)', () => {
  const expected = 'sha384-' + createHash('sha384').update(fs.readFileSync(path.join(portal, 'assets/vendor/api-client.min.js'))).digest('base64');
  for (const html of [read('index.html'), cvSource]) {
    assert.ok(html.includes(`integrity="${expected}"`), 'run scripts/update-security-policy.mjs after updating the client');
  }
});

test('audit 2026-11-13: every inline script is in the reviewed list (#85)', () => {
  const reviewed = JSON.parse(read('scripts/inline-scripts.json')).map(entry => entry.hash);
  for (const html of [read('index.html'), cvSource]) {
    for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (/\bsrc\s*=/i.test(match[1]) || !match[2].trim()) continue;
      assert.ok(reviewed.includes('sha256-' + createHash('sha256').update(match[2]).digest('base64')), 'an unreviewed inline script');
    }
  }
  const generator = read('scripts/update-security-policy.mjs');
  assert.match(generator, /inline-scripts\.json/);
  assert.match(generator, /process\.exit\(1\)/, 'the generator refuses an unreviewed inline script');
});

test('audit 2026-11-13: images come from the site (and the API at the cutover), not any https: address (#81)', () => {
  for (const html of [read('index.html'), cvSource]) {
    const policy = /http-equiv="Content-Security-Policy" content="([^"]+)"/i.exec(html)[1];
    assert.match(policy, /img-src 'self' data: blob:(;| https:\/\/[a-z0-9.-]+;)/);
  }
});

test('audit 2026-11-13: the CV builder has no third-party parser and prints in a sandbox (#82)', () => {
  assert.doesNotMatch(cvSource, /api\.anthropic\.com/);
  assert.match(cvSource, /setAttribute\('sandbox', 'allow-same-origin allow-modals'\)/);
});

test('audit 2026-11-13: job ids in attributes are escaped (H-05)', () => {
  assert.doesNotMatch(appSource, /="\$\{(?:[A-Za-z_][\w.]*\.id|jobId)\}"/);
});

test('audit 2026-11-13: an error text in the address bar is shown only when it is known (#79)', () => {
  const source = read('assets/js/backend.js');
  const context = vm.createContext({ window: { location: { hash: '#error=x&error_description=Hesab%C4%B1n%C4%B1z+bloklan%C4%B1b%2C+evil.example-a+yaz%C4%B1n', search: '', pathname: '/' } },
    history: { replaceState() {} }, URLSearchParams, decodeURIComponent, UNI_DOMAIN: 'asoiu.edu.az', USE_BACKEND: false, API_URL: '', API_KEY: '' });
  vm.runInContext(source + '\nglobalThis.B = Backend;', context);
  const message = context.B.readOAuthError();
  assert.doesNotMatch(message, /evil/);
  assert.equal(message, 'Giriş tamamlanmadı. Yenidən cəhd edin.');
});

test('audit 2026-11-13: logout forgets the session on this device even offline (#80)', () => {
  const auth = read('assets/js/auth.js');
  assert.match(auth, /await Backend\.forgetLocalSession\(\)/);
  assert.match(read('assets/js/backend.js'), /async forgetLocalSession\(\)/);
});

test('audit 2026-11-13: recovery links and temporary passwords lead to the new-password screen (#15, #32)', () => {
  assert.match(read('index.html'), /<script src="assets\/js\/password-required\.js\?v=[0-9a-z]+"><\/script>/);
  const screen = read('assets/js/password-required.js');
  assert.match(screen, /PASSWORD_RECOVERY/);
  assert.match(screen, /must_change_password/);
  assert.match(screen, /restricted === true/);
  assert.match(read('assets/js/backend.js'), /current_password: currentPassword/);
});

test('audit 2026-11-13: AI tools ask for consent before CV text leaves (#52)', () => {
  const ai = read('assets/js/ai.js');
  assert.match(ai, /consent_required/);
  assert.match(ai, /Backend\.giveAiConsent\(\)/);
});
