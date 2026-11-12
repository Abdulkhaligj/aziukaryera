/* Owner-scoped CV drafts. This is a browser privacy control, not server authorization. */
(() => {
  'use strict';
  const SESSION_KEY = 'asoiu-cv-session-v2';
  const PREFIX = 'asoiu-cv-v2:';
  const legacy = ['asoiu-cv-profile-data', 'asoiu-cv-builder-draft'];
  // Old drafts have no trustworthy owner and cannot be safely migrated.
  try { legacy.forEach(name => localStorage.removeItem(name)); } catch {}
  let scope = null, client = null, connected = null, epoch = 0;
  let verifyUser = async () => snapshot();
  const listeners = new Set();
  const readSession = () => {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
  };
  const equal = (a, b) => !!a && !!b && a.ownerId === b.ownerId && a.revision === b.revision;
  const key = (owner, kind) => PREFIX + encodeURIComponent(owner) + ':' + kind;
  const notify = () => listeners.forEach(fn => fn(snapshot()));
  function snapshot() { return equal(scope, readSession()) ? { ...scope } : null; }
  function removeOwner(owner) {
    if (!owner) return;
    for (const kind of ['profile', 'draft']) localStorage.removeItem(key(owner, kind));
  }
  function clear() {
    epoch++;
    const old = scope || readSession();
    scope = null;
    try {
      removeOwner(old?.ownerId);
      legacy.forEach(name => localStorage.removeItem(name));
      localStorage.removeItem(SESSION_KEY);
    } catch { /* No persistence is safer than retaining a shared draft. */ }
    notify();
  }
  function bindOwner(ownerId) {
    epoch++;
    if (!ownerId || typeof ownerId !== 'string') { clear(); return; }
    const previous = readSession();
    try {
      legacy.forEach(name => localStorage.removeItem(name));
      if (previous?.ownerId !== ownerId) removeOwner(previous?.ownerId);
      scope = previous?.ownerId === ownerId && typeof previous.revision === 'string'
        ? previous : { ownerId, revision: crypto.randomUUID() };
      localStorage.setItem(SESSION_KEY, JSON.stringify(scope));
    } catch { scope = null; }
    notify();
  }
  function get(kind, expected = snapshot()) {
    if (!['profile', 'draft'].includes(kind) || !equal(expected, snapshot())) return null;
    try {
      const entry = JSON.parse(localStorage.getItem(key(expected.ownerId, kind)) || 'null');
      return entry?.version === 2 && equal(entry, expected) ? entry.payload : null;
    } catch { return null; }
  }
  function put(kind, payload, expected) {
    // The editor must provide the scope captured when its data was loaded.
    // Re-reading the new owner's scope here would let stale callbacks save A as B.
    if (!['profile', 'draft'].includes(kind) || !equal(expected, snapshot())) return false;
    try {
      localStorage.setItem(key(expected.ownerId, kind), JSON.stringify({ version: 2, ...expected, payload }));
      return true;
    } catch { return false; }
  }
  function remove(kind, expected) {
    if (!equal(expected, snapshot())) return;
    try { localStorage.removeItem(key(expected.ownerId, kind)); } catch {}
  }
  function connect(authClient) {
    if (connected) return connected.then(() => snapshot());
    if (typeof USE_BACKEND === 'undefined' || !USE_BACKEND || !window.ApiClient) {
      if (typeof CAREER_DEMO_MODE !== 'undefined' && CAREER_DEMO_MODE) {
        const saved = readSession();
        if (saved?.ownerId) scope = saved;
      }
      return Promise.resolve(snapshot());
    }
    client = authClient || window.ApiClient.createClient(API_URL, API_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });
    // Never restore private drafts from an unverified localStorage user object.
    // Auth callbacks stay synchronous to avoid SDK auth-lock deadlocks.
    client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session) { clear(); return; }
      if (event !== 'INITIAL_SESSION') {
        const ticket = ++epoch;
        setTimeout(() => verify(ticket), 0);
      }
    });
    async function verify(ticket) {
      try {
        const { data, error } = await client.auth.getUser();
        if (ticket !== epoch) return snapshot();
        if (error || !data?.user) clear(); else bindOwner(data.user.id);
      } catch { if (ticket === epoch) clear(); }
      return snapshot();
    }
    verifyUser = () => verify(++epoch);
    connected = verifyUser();
    return connected;
  }
  window.addEventListener('storage', event => {
    if (event.key === SESSION_KEY && !equal(scope, readSession())) {
      // A different tab signed out or changed accounts. Do not adopt its owner.
      epoch++;
      scope = null;
      notify();
    }
  });
  window.addEventListener('pageshow', () => { if (scope && !snapshot()) { scope = null; notify(); } });
  window.CVDrafts = { connect, snapshot, get, put, remove, clear,
    matches: expected => equal(expected, snapshot()),
    revalidate: () => verifyUser(),
    bindDemoOwner(owner) {
    if (typeof CAREER_DEMO_MODE !== 'undefined' && CAREER_DEMO_MODE) bindOwner(owner);
  }, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); } };
})();
