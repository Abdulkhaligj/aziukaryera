/*!
 * ADNSU Karyera — a new password is required (audit 2026-11-13, #15 and #32).
 * A password-recovery link opens a session that may only set a new password,
 * and a temporary password given by the Career Centre must be replaced at the
 * first sign-in. In both cases this screen covers the site until it is done.
 */
(() => {
  'use strict';
  if (typeof Backend === 'undefined' || typeof Backend.init !== 'function' || !Backend.init() || !Backend.sb) return;
  const sb = Backend.sb;
  // The recovery link's tokens arrive in the address; remember that before the client clears it.
  let recovery = /(?:^|[#&])type=recovery(?:&|$)/.test(String(window.location.hash || ''));
  let shown = false;

  function claims(session) {
    try {
      const part = String(session?.access_token || '').split('.')[1] || '';
      return JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    } catch { return {}; }
  }

  function modeOf(session) {
    if (!session) return null;
    const token = claims(session);
    if (recovery || token.restricted === true) return 'recovery';
    if (session.user?.app_metadata?.must_change_password === true) return 'temporary';
    return null;
  }

  function field(id, label, autocomplete) {
    return `<label class="pw-required__field" for="${id}">${label}` +
      `<input id="${id}" type="password" autocomplete="${autocomplete}" required minlength="${id === 'pw-req-current' ? 1 : 8}" maxlength="72"></label>`;
  }

  function show(mode) {
    if (shown) return;
    shown = true;
    const box = document.createElement('div');
    box.className = 'pw-required';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'pw-req-title');
    box.style.cssText = 'position:fixed;inset:0;z-index:10000;display:grid;place-items:center;padding:16px;background:rgba(10,18,40,.72)';
    box.innerHTML = `<form class="pw-required__card" novalidate style="background:#fff;color:#14213d;max-width:420px;width:100%;border-radius:16px;padding:26px 22px;box-shadow:0 18px 50px rgba(0,0,0,.25);display:grid;gap:12px">
      <h2 id="pw-req-title" style="margin:0;font-size:20px">Yeni şifrə təyin edin</h2>
      <p style="margin:0;color:#4a5578">${mode === 'recovery'
        ? 'Bərpa linki ilə daxil oldunuz. Davam etmək üçün yeni şifrə qurun.'
        : 'Hesabınıza müvəqqəti şifrə ilə daxil oldunuz. Davam etmək üçün yalnız sizin bildiyiniz yeni şifrə qurun.'}</p>
      ${mode === 'temporary' ? field('pw-req-current', 'Müvəqqəti şifrə', 'current-password') : ''}
      ${field('pw-req-new', 'Yeni şifrə', 'new-password')}
      ${field('pw-req-new2', 'Yeni şifrənin təkrarı', 'new-password')}
      <p class="pw-required__error" role="alert" style="margin:0;color:#b42318;min-height:1.2em"></p>
      <button type="submit" class="btn primary block">Şifrəni yadda saxla</button>
      <button type="button" class="btn ghost block" data-pw-req="logout">Çıxış</button>
    </form>`;
    document.body.appendChild(box);
    const form = box.querySelector('form');
    const error = box.querySelector('.pw-required__error');
    const value = id => box.querySelector('#' + id)?.value || '';
    box.querySelector('[data-pw-req="logout"]').addEventListener('click', async () => {
      await Auth.logout?.();
      window.location.replace(window.location.pathname);
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const next = value('pw-req-new');
      const problem = Auth.validatePassword?.(next) || (next.length < 8 ? 'Şifrə ən azı 8 simvol olmalıdır.' : '');
      if (problem) { error.textContent = problem; return; }
      if (next !== value('pw-req-new2')) { error.textContent = 'Yeni şifrələr üst-üstə düşmür.'; return; }
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      error.textContent = '';
      const result = await Backend.changePassword(next, mode === 'temporary' ? value('pw-req-current') : undefined);
      if (!result.ok) { button.disabled = false; error.textContent = result.error || 'Şifrə dəyişmədi.'; return; }
      // A fresh token without the recovery mark or the temporary-password flag.
      try { await sb.auth.refreshSession(); } catch { /* the reload signs in again if needed */ }
      recovery = false;
      window.location.replace(window.location.pathname);
    });
    box.querySelector('input')?.focus();
  }

  function check(session) {
    const mode = modeOf(session);
    if (mode) show(mode);
  }

  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') recovery = true;
    if (event === 'SIGNED_OUT') { recovery = false; return; }
    // Do not call Auth APIs inside the client's auth callback.
    setTimeout(() => check(session), 0);
  });
  sb.auth.getSession().then(({ data }) => check(data?.session)).catch(() => {});
})();
