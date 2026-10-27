/*!
 * ADNSU Karyera — authentication completion guard.
 * Does not alter credentials, login policy, RLS, tokens or subscription data.
 * Instead of leaving the login form busy on network/DB errors, it safely
 * resolves the existing login result into an actionable Azerbaijani message.
 */
(() => {
  'use strict';
  if (typeof Auth === 'undefined' || typeof Backend === 'undefined' ||
      typeof Auth.loginRemote !== 'function') return;

  const originalLogin = Auth.loginRemote.bind(Auth);
  Auth.loginRemote = async (email, password) => {
    let timeout;
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => originalLogin(email, password)),
        new Promise(resolve => {
          timeout = setTimeout(() => resolve({
            ok: false,
            error: 'Giriş cavabı gecikir. İnternet bağlantınızı yoxlayıb bir daha cəhd edin. Şifrəniz dəyişdirilməyib.'
          }), 18000);
        })
      ]);
      if (!result || typeof result !== 'object') {
        return { ok: false, error: 'Giriş cavabı düzgün alınmadı. Yenidən cəhd edin.' };
      }
      if (result.ok && !result.user) {
        return { ok: false, error: 'Sessiya təsdiqləndi, amma profil yüklənmədi. Səhifəni yeniləyib daxil olun.' };
      }
      return result;
    } catch (error) {
      console.error('[ADNSU] Login completion failed', error);
      return {
        ok: false,
        error: 'Giriş zamanı əlaqə xətası yarandı. Səhifəni yeniləyib yenidən cəhd edin.'
      };
    } finally {
      clearTimeout(timeout);
    }
  };
})();
