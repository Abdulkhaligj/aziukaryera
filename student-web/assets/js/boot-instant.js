/*!
 * ADNSU Karyera | Login-safe background startup.
 * Works on top of the LAST deployed build: no change to app.js, AIDA,
 * company HR, Talent Pool, interview screens, plan hiding, or Supabase RLS.
 */
(() => {
  'use strict';
  if (typeof Auth === 'undefined' || typeof Backend === 'undefined' ||
      typeof Landing === 'undefined' || typeof Store === 'undefined') return;

  let userStartedAuth = false;
  let restoreStarted = false;
  const userAction = event => {
    const target = event.target;
    if (target?.closest?.('[data-lp^="auth"], [data-act="auth-open"], [data-act="login-form"], [data-act="register-form"], [data-act="logout"], .auth-form, #li-email, #li-password')) {
      userStartedAuth = true;
    }
  };
  document.addEventListener('pointerdown', userAction, true);
  document.addEventListener('click', userAction, true);
  document.addEventListener('focusin', userAction, true);
  document.addEventListener('submit', userAction, true);

  const shouldNotRestore = () => userStartedAuth ||
    (typeof UI !== 'undefined' && (UI.publicView !== 'landing' || UI.auth.busy));

  // Do not start a simultaneous getSession() while the user is typing or
  // clicking Login. Supabase's storage locks can stall signInWithPassword.
  Auth.restoreRemote = () => Promise.resolve(false);

  const oldProviders = Backend.providers.bind(Backend);
  Backend.providers = () => {
    setTimeout(() => {
      if (userStartedAuth) return;
      Promise.resolve().then(oldProviders).then(data => {
        if (typeof UI !== 'undefined') UI.providers = data || {};
      }).catch(error => console.warn('[ADNSU] OAuth settings:', error?.message || error));
    }, 900);
    return Promise.resolve({});
  };

  const oldLandingLoad = Landing.load.bind(Landing);
  Landing.load = () => {
    Landing.data ||= { jobs: [], companies: [], events: [], benefits: [], awards: [], ads: [] };
    setTimeout(() => {
      if (userStartedAuth || (typeof UI !== 'undefined' && UI.publicView !== 'landing')) return;
      Promise.resolve().then(oldLandingLoad).then(() => {
        if (typeof UI !== 'undefined' && UI.publicView === 'landing' &&
            !Auth.isSignedIn()) render();
      }).catch(error => console.warn('[ADNSU] Landing:', error?.message || error));
    }, 650);
    return Promise.resolve();
  };

  // Restore a pre-existing REAL session only if user has not chosen
  // to log in manually. A successful login must never be overwritten.
  setTimeout(() => {
    if (restoreStarted || shouldNotRestore() ||
        typeof Store === 'undefined' || Store.mode !== 'supabase') return;
    restoreStarted = true;
    void (async () => {
      try {
        const session = await Backend.getSession();
        if (!session || shouldNotRestore()) return;
        const payload = await Backend.loadAll();
        if (!payload?.ok || shouldNotRestore()) return;
        Store.hydrate(payload);
        UI.publicView = 'app';
        UI.booting = false;
        render();
        if (typeof startNotificationUpdates === 'function') startNotificationUpdates();
      } catch (error) {
        console.warn('[ADNSU] Sessiya bərpası:', error?.message || error);
      }
    })();
  }, 1800);

  // The existing main app probes Supabase before showing the first screen.
  // Display the public page promptly, without selecting local/demo auth.
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
      console.error('[ADNSU] Açılış ekranı:', error);
    }
  }, 250);
})();
