/*!
 * ADNSU Karyera — repair password login stalled after successful /auth/token.
 * Adds a bounded password grant + Supabase session handoff while keeping the
 * exact latest production UI, RLS and company HR features intact.
 */
(() => {
  'use strict';
  if (typeof Backend === 'undefined' || typeof Auth === 'undefined' ||
      !window.supabase || !USE_SUPABASE) return;

  const originalInit = Backend.init.bind(Backend);
  const timed = (factory, ms, explanation) => {
    let timeout;
    return Promise.race([
      Promise.resolve().then(factory),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(explanation)), ms);
      })
    ]).finally(() => clearTimeout(timeout));
  };

  // Interrupted tabs have left the browser-wide Supabase Web Lock held.
  // Keep the client per tab; avoid depending on another tab's lock for login.
  // SDK will still check token validity and persist its session normally.
  Backend.init = function () {
    if (this.sb) return true;
    if (!this.available()) return false;
    this.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        lock: async (_name, _acquireTimeout, fn) => fn()
      }
    });
    // Retain existing AI inference timeout behavior from boot-recovery.js.
    const originalInvoke = this.sb.functions.invoke.bind(this.sb.functions);
    this.sb.functions.invoke = (name, options = {}) => {
      if (!['career-ai', 'aida-chat'].includes(name)) return originalInvoke(name, options);
      const ctrl = new AbortController();
      return timed(() => originalInvoke(name, { ...options, signal: ctrl.signal }),
        23000, 'AI sorğusunun müddəti bitdi.').catch(error => {
          ctrl.abort();
          return { data: null, error };
        });
    };
    return true;
  };

  // Avoid Supabase signInWithPassword's internal cross-tab lock while
  // maintaining the exact same official Supabase password grant.
  Auth.loginRemote = async function (email, password) {
    const emailError = this.validateEmail(email, null);
    if (emailError) return { ok: false, field: 'email', error: emailError };
    if (!password) return { ok: false, field: 'password', error: 'Şifrəni yazın.' };
    if (!Backend.init()) return { ok: false, error: 'Giriş xidməti yüklənmədi. Səhifəni yeniləyin.' };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7500);
    try {
      const response = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
        method: 'POST',
        headers: {
          apikey: SUPABASE_PUBLISHABLE_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email: String(email).trim().toLowerCase(), password }),
        cache: 'no-store',
        signal: controller.signal
      });

      const grant = await timed(() => response.json(), 1500, 'Giriş cavabı gecikdi.');
      if (!response.ok || !grant?.access_token || !grant?.refresh_token) {
        let message = 'E-poçt və ya şifrə yanlışdır.';
        if (response.status === 429) message = 'Çox sayda giriş cəhdi var. Bir qədər sonra yenidən yoxlayın.';
        else if (response.status >= 500) message = 'Giriş serverində müvəqqəti xəta var. Yenidən cəhd edin.';
        else if (grant?.error_code === 'email_not_confirmed') message = 'Hesabınızın e-poçtu təsdiqlənməyib.';
        return { ok: false, field: 'password', error: message };
      }

      // Stores the session through the official SDK, not via localStorage
      // manipulation or an insecure client-side "logged in" flag.
      const installed = await timed(
        () => Backend.sb.auth.setSession({
          access_token: grant.access_token,
          refresh_token: grant.refresh_token
        }),
        3700, 'Sessiyanın yadda saxlanması gecikdi.'
      );
      if (installed.error || !installed.data?.session) {
        return { ok: false, error: 'Giriş uğurludur, ancaq sessiya saxlanılmadı. Yenidən cəhd edin.' };
      }

      const payload = await timed(() => Backend.loadAll(), 5200,
        'Şirkət məlumatlarının yüklənməsi gecikdi.');
      if (!payload?.ok) {
        return { ok: false, error: payload?.error || 'Kabinet məlumatları açıla bilmədi.' };
      }
      Store.hydrate(payload);
      const user = this.currentUser();
      if (!user) {
        return { ok: false, error: 'Şirkət profili oxunmadı. Yenidən cəhd edin.' };
      }
      return { ok: true, user };
    } catch (error) {
      const timeout = controller.signal.aborted || /gecikdi|timed out/i.test(error?.message || '');
      console.warn('[ADNSU] Login completed with client error:', timeout ? 'timeout' : 'network');
      return {
        ok: false,
        error: timeout
          ? 'Giriş gözləniləndən uzun çəkdi. Səhifəni yeniləyib bir daha cəhd edin.'
          : 'Giriş zamanı bağlantı xətası oldu. İnternetinizi yoxlayıb yenidən cəhd edin.'
      };
    } finally {
      clearTimeout(timer);
    }
  };

  // A rejected callback should never leave a disabled "Yoxlanılır..." button.
  window.addEventListener('unhandledrejection', () => {
    if (typeof UI === 'undefined' || !UI.auth?.busy || UI.publicView !== 'auth') return;
    UI.auth.busy = false;
    UI.auth.error = 'Giriş tamamlanmadı. Yenidən cəhd edin.';
    try { render(); } catch (_error) { /* UI already visible */ }
  });
})();
