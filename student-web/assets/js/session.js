/* Client privacy boundary shared by startup, private reads and chat widgets.
 * Server Auth/RLS remain authoritative. Browser storage never proves identity. */
(() => {
  'use strict';
  let epoch = 0, owner = null, observedOwner = null, client = null;
  let authRun = 0, activeAuth = null;
  const listeners = new Set(), payloadScopes = new WeakMap(), connected = new WeakSet(), operationScopes = new WeakMap();
  const cancelled = new Error('STALE_SESSION');
  const stale = () => ({ ok: false, stale: true, error: 'Sessiya dəyişib. Yenidən cəhd edin.' });
  const dbStale = () => ({ data: null, error: { code: 'STALE_SESSION', message: 'Sessiya dəyişib.' } });
  const snapshot = () => ({ ownerId: owner, epoch });
  const matches = token => !!token && token.epoch === epoch && token.ownerId === owner;
  const scopedResult = (result, token, failure) => result && typeof result === 'object'
    ? new Proxy(result, { get(target, key, receiver) { return Reflect.get(matches(token) ? target : failure(), key, receiver); } }) : result;
  const emit = reason => listeners.forEach(fn => { try { fn({ ...snapshot(), reason }); } catch (error) { console.error('Session cleanup failed', error); } });
  function invalidate(reason = 'invalidated', cancelAuth = true) {
    epoch++; owner = null;
    if (cancelAuth) { authRun++; activeAuth = null; }
    emit(reason);
  }
  function observe(id, event, email) {
    const next = id || null;
    if (event === 'SIGNED_OUT') {
      observedOwner = null; invalidate('signed-out'); return;
    }
    if (next !== observedOwner) {
      observedOwner = next;
      const conflict = event !== 'INITIAL_SESSION' && activeAuth && activeAuth.email !== String(email || '').toLowerCase();
      invalidate('identity-changed', !!conflict);
    }
  }
  async function verify() {
    if (!client) return null;
    const ticket = epoch;
    try {
      const { data, error } = await client.auth.getUser();
      if (ticket !== epoch) return null;
      if (error || !data?.user) {
        if (owner || observedOwner) { observedOwner = null; invalidate('unverified'); }
        return null;
      }
      const user = data.user;
      if (observedOwner !== user.id) observe(user.id, 'VERIFIED', user.email);
      if (owner !== user.id) { owner = user.id; emit('verified'); }
      return snapshot();
    } catch {
      if (ticket === epoch && (owner || observedOwner)) { observedOwner = null; invalidate('unverified'); }
      return null;
    }
  }
  // Guard the final SDK result as well as the final Backend method. Extensions
  // use the SDK directly, and may await several chained database/storage calls.
  function guarded(value, token) {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) return value;
    return new Proxy(value, { get(target, key) {
      if (key === 'then') return (resolve, reject) => {
        // PostgREST builders are lazy: assimilating their thenable starts the
        // write. Reject a retained old-owner builder before it reaches fetch.
        if (!matches(token)) return Promise.resolve(dbStale()).then(resolve, reject);
        return Promise.resolve(target).then(
          result => resolve(matches(token) ? scopedResult(result, token, dbStale) : dbStale()), reject);
      };
      if (!matches(token)) {
        const failure = dbStale();
        if (key in failure) return failure[key];
        const member = Reflect.get(target, key, target);
        // Keep stale fluent chains awaitable while never invoking a retained
        // storage/query client method under a replacement user's credentials.
        return typeof member === 'function' ? () => guarded(target, token) : undefined;
      }
      const member = Reflect.get(target, key, target);
      return typeof member === 'function' ? (...args) => matches(token)
        ? guarded(member.apply(target, args), token) : guarded(target, token) : member;
    } });
  }
  // An operation's input belongs to its starting owner. Its continuations must
  // not obtain a fresh SDK scope after an awaited Auth/session lookup.
  function operationClient(sdk, token) {
    return new Proxy(sdk, { get(target, key) {
      const member = Reflect.get(target, key, target);
      if (member && ['auth', 'storage', 'functions'].includes(key)) return operationClient(member, token);
      return typeof member === 'function' ? (...args) => {
        if (!matches(token)) throw cancelled;
        return guarded(member.apply(target, args), token);
      } : member;
    } });
  }
  function operationReceiver(backend, token) {
    const target = operationScopes.get(backend)?.backend || backend;
    const receiver = new Proxy(target, { get(target, key) {
      if (key === 'sb') return target.sb ? operationClient(target.sb, token) : null;
      // Initialization must keep the real SDK client in the shared lifecycle.
      if (key === 'init') return (...args) => matches(token) && target.init(...args);
      if (key === 'getSession') return async (...args) => {
        if (!matches(token)) throw cancelled;
        const session = await target.getSession(...args);
        if (!matches(token) || session?.user?.id !== token.ownerId) throw cancelled;
        return session;
      };
      return Reflect.get(target, key, target);
    } });
    operationScopes.set(receiver, { backend: target, token });
    return receiver;
  }
  function connect(sdk) {
    client = sdk;
    if (!sdk || connected.has(sdk)) return;
    connected.add(sdk);
    for (const method of ['from', 'rpc']) {
      if (typeof sdk[method] !== 'function') continue;
      const original = sdk[method].bind(sdk);
      sdk[method] = (...args) => guarded(original(...args), snapshot());
    }
    if (sdk.storage?.from) {
      const from = sdk.storage.from.bind(sdk.storage);
      sdk.storage.from = (...args) => guarded(from(...args), snapshot());
    }
    // Supabase exposes functions through a getter. Keep a single wrapped client
    // so compatibility wrappers cannot accidentally wrap a discarded instance.
    if (sdk.functions?.invoke) {
      const functions = sdk.functions, invoke = functions.invoke.bind(functions);
      functions.invoke = async (...args) => {
        const token = snapshot(), result = await invoke(...args);
        return matches(token) ? scopedResult(result, token, dbStale) : dbStale();
      };
      Object.defineProperty(sdk, 'functions', { configurable: true, value: functions });
    }
    sdk.auth.onAuthStateChange((event, session) => {
      observe(session?.user?.id, event, session?.user?.email);
      // Do not call Auth APIs while the SDK auth lock owns this callback.
      if (event !== 'SIGNED_OUT' && session) setTimeout(() => { void verify(); }, 0);
    });
    void verify();
  }
  const api = {
    connect, verify, snapshot, matches, stale,
    capture() { return owner ? snapshot() : null; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    invalidate,
    beginAuth(email) {
      const id = ++authRun;
      activeAuth = { id, email: String(email || '').trim().toLowerCase() };
      invalidate('auth-start', false);
      return id;
    },
    authMatches(id) { return id === authRun; },
    currentAuth() { return authRun; },
    authPending() { return !!activeAuth; },
    cancelAuth(id) { if (id === authRun) invalidate('auth-cancelled'); },
    finishAuth(id) { if (id === authRun) activeAuth = null; },
    demoOwner(id) {
      if (typeof CAREER_DEMO_MODE === 'undefined' || !CAREER_DEMO_MODE) return;
      if (owner !== id) { invalidate('demo-owner'); observedOwner = owner = id || null; emit('verified'); }
    },
    markPayload(payload, token) { payloadScopes.set(payload, token); return payload; },
    payloadMatches(payload) { const token = payloadScopes.get(payload); return matches(token) && token.ownerId === payload.uid; }
  };
  window.CareerSession = api;
  if (typeof Backend === 'undefined') return;
  const loadAll = Backend.loadAll;
  Backend.loadAll = async function () {
    if (!this.init()) return stale();
    const token = await verify();
    if (!token) return stale();
    const payload = await loadAll.call(operationReceiver(this, token));
    if (!matches(token) || (payload.ok && payload.uid !== token.ownerId)) return stale();
    return payload.ok ? api.markPayload(payload, token) : payload;
  };
  const excluded = new Set(['getSession','loadAll','signIn','signUp','signOut','providers','signInWithGoogle','signInWithAzure','signInWithMagicLink','resetPassword','resendConfirmation']);
  for (const name of Object.keys(Backend)) {
    const original = Backend[name];
    if (excluded.has(name) || original?.constructor?.name !== 'AsyncFunction') continue;
    Backend[name] = async function (...args) {
      const token = operationScopes.get(this)?.token || api.capture();
      if (!token || !matches(token)) return stale();
      try {
        const result = await original.apply(operationReceiver(this, token), args);
        return matches(token) ? scopedResult(result, token, stale) : stale();
      } catch (error) {
        if (error === cancelled || !matches(token)) return stale();
        throw error;
      }
    };
  }
})();
