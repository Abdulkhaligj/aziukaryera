/*!
 * ADNSU Career: nonblocking session recovery and landing.
 * Avoids gating the whole page on external auth, providers or slow requests.
 */
(() => {
  'use strict';
  if (typeof Backend === 'undefined' || typeof Auth === 'undefined' ||
      typeof Landing === 'undefined' || typeof Store === 'undefined') return;

  const providers = Backend.providers.bind(Backend);
  Backend.providers = function () {
    void Promise.resolve().then(providers).then(data => {
      if (typeof UI === 'undefined') return;
      UI.providers = data || {};
      if (UI.publicView === 'auth' && !UI.auth.busy) render();
    }).catch(error => console.warn('[ADNSU] OAuth settings:', error?.message));
    return Promise.resolve({});
  };

  const landing = Landing.load.bind(Landing);
  Landing.load = function () {
    Landing.data ||= { jobs: [], companies: [], events: [], benefits: [], awards: [], ads: [] };
    void Promise.resolve().then(landing).then(() => {
      if (typeof UI !== 'undefined' && UI.publicView === 'landing' &&
          !Auth.isSignedIn()) render();
    }).catch(error => console.warn('[ADNSU] Landing:', error?.message));
    return Promise.resolve();
  };

  let userInteracted = false;
  document.addEventListener('click', event => {
    if (event.target?.closest?.('[data-lp^="auth"], [data-act="auth-open"], [data-act="logout"]'))
      userInteracted = true;
  }, true);
  document.addEventListener('submit', event => {
    if (event.target?.matches?.('[data-act="login-form"], [data-act="register-form"]'))
      userInteracted = true;
  }, true);

  // A background recovery is allowed to activate the user only after
  // legitimate Supabase Auth and RLS data reads have succeeded.
  Auth.restoreRemote = function () {
    if (Store.mode !== 'supabase') return Promise.resolve(false);
    Store.state.session = null;
    Store.bind();
    void (async () => {
      try {
        const session = await Backend.getSession();
        if (!session || userInteracted || UI.auth.busy) return;
        const data = await Backend.loadAll();
        if (!data.ok || userInteracted || UI.auth.busy ||
            UI.publicView !== 'landing') return;
        Store.hydrate(data);
        UI.publicView = 'app';
        UI.booting = false;
        render();
        if (typeof startNotificationUpdates === 'function') startNotificationUpdates();
      } catch (error) {
        console.warn('[ADNSU] Session recovery:', error?.message || error);
      }
    })();
    return Promise.resolve(false);
  };

  // The original startup may still be waiting for the initial connection
  // probe. Do not block navigation on the full-screen loading indicator.
  setTimeout(() => {
    if (typeof UI === 'undefined' || !UI.booting) return;
    if (typeof USE_SUPABASE !== 'undefined' && USE_SUPABASE) {
      Store.mode = 'supabase';
      Store.state.session = null;
      Store.bind();
    }
    Landing.data ||= { jobs: [], companies: [], events: [], benefits: [], awards: [], ads: [] };
    UI.booting = false;
    UI.publicView = 'landing';
    try { render(); } catch (error) {
      console.error('[ADNSU] Fast startup render:', error);
    }
  }, 250);
})();
