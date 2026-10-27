/*!
 * ADNSU Karyera — defensive startup and AI-network layer.
 * Loaded after auth/landing and before app.js. Never persists credentials,
 * modifies server data, or enables demo authorization.
 */
(() => {
  'use strict';
  const bounded = (promise, ms, fallback, label) => {
    let timer;
    return Promise.race([
      Promise.resolve().then(() => promise()),
      new Promise(resolve => { timer = setTimeout(() => {
        console.warn('[ADNSU] ' + label + ' vaxt limitini keçdi (' + ms + 'ms)');
        resolve(fallback());
      }, ms); })
    ]).finally(() => clearTimeout(timer));
  };

  // Supabase's browser Web Lock can remain held by an interrupted tab.
  // Normally keep the cross-tab lock; if it is orphaned, recover after 3s.
  const originalInit = Backend.init.bind(Backend);
  Backend.init = function () {
    if (this.sb) return true;
    if (!this.available()) return false;
    const lock = async (name, _acquireTimeout, task) => {
      if (typeof navigator === 'undefined' || !navigator.locks?.request) return task();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      try {
        return await navigator.locks.request(name, { mode: 'exclusive', signal: controller.signal }, task);
      } catch (error) {
        if (!controller.signal.aborted) throw error;
        console.warn('[ADNSU] Köhnə auth kilidi səbəbindən sessiya bərpası davam etdirilir.');
        return task();
      } finally {
        clearTimeout(timer);
      }
    };
    this.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, lock }
    });
    // A slow AI provider must never leave the UI's send button spinning forever.
    const invoke = this.sb.functions.invoke.bind(this.sb.functions);
    this.sb.functions.invoke = (name, options = {}) => {
      if (name !== 'career-ai' && name !== 'aida-chat') return invoke(name, options);
      const controller = new AbortController();
      return bounded(() => invoke(name, { ...options, signal: controller.signal }), 23000,
        () => { controller.abort(); return { data: null, error: new Error('AI vaxt limitini keçdi. Yenidən cəhd edin.') }; },
        name);
    };
    return true;
  };

  const originalProviders = Backend.providers.bind(Backend);
  Backend.providers = () => bounded(originalProviders, 4000, () => ({}), 'OAuth provayderləri');

  const originalRestore = Auth.restoreRemote.bind(Auth);
  Auth.restoreRemote = async () => {
    const restored = await bounded(originalRestore, 11000, () => false, 'Sessiyanın bərpası');
    if (!restored && Store?.state?.session) {
      // Never show stale local profiles as an authenticated Supabase session.
      Store.state.session = null;
      Store.bind();
    }
    return restored;
  };

  const originalLandingLoad = Landing.load.bind(Landing);
  Landing.load = () => bounded(originalLandingLoad, 6500, () => {
    Landing.data ||= { jobs: [], companies: [], events: [], benefits: [] };
  }, 'Açılış səhifəsinin məlumatları');

  // Even unforeseen exceptions must not permanently hide login/landing.
  setTimeout(() => {
    if (typeof UI === 'undefined' || !UI.booting) return;
    console.error('[ADNSU] Başlanğıc təhlükəsizlik limiti aktivləşdi.');
    if (Store?.state?.session) { Store.state.session = null; Store.bind(); }
    Landing.data ||= { jobs: [], companies: [], events: [], benefits: [] };
    UI.publicView = 'landing';
    UI.booting = false;
    try { render(); } catch (error) { console.error('[ADNSU] Render xətası', error); }
  }, 17500);
})();
