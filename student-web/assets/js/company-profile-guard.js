/*!
 * ADNSU Career pilot hardening: no crash when a signed-in company user has
 * no company row. Preserve all existing employer modules for linked accounts.
 * This is a presentation guard only; does not approve accounts or modify RLS.
 */
(() => {
  'use strict';
  if (typeof VIEWS === 'undefined' || !VIEWS.company ||
      typeof Auth === 'undefined' || typeof Store === 'undefined') return;

  const safe = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  const missingProfile = () => {
    const account = Auth.currentUser();
    const pending = account?.status === 'pending';
    const title = pending ? 'Şirkət hesabınız təsdiq gözləyir'
                          : 'Şirkət profilinin əlaqələndirilməsi lazımdır';
    const explanation = pending
      ? 'Hesabınız yaradılıb, lakin şirkət profilinizin əlaqələndirilməsi və təsdiqi tamamlanmayıb. Bu mərhələ başa çatdıqdan sonra vakansiya, Talent Pool və digər işəgötürən alətlərindən istifadə edə biləcəksiniz.'
      : 'Şirkət hesabınıza bağlı profil tapılmadı. Məlumatlarınızı dəyişdirmədən Karyera Mərkəzinin dəstəyi ilə profilinizi əlaqələndirmək lazımdır.';
    return `<section class="card pad-lg" style="max-width:760px;margin:32px auto">
      <div class="eyebrow">ADNSU Karyera · Şirkət kabineti</div>
      <h1 style="margin:12px 0 16px">${title}</h1>
      <p>${explanation}</p>
      <p style="margin:16px 0;color:var(--muted)">Hesab: ${safe(account?.email || '')}</p>
      <div class="row" style="margin-top:16px;gap:10px;flex-wrap:wrap">
        <button type="button" class="btn" data-act="home">Ana səhifəyə keç</button>
        <button type="button" class="btn" data-act="logout">Hesabdan çıx</button>
      </div>
    </section>`;
  };

  // Additional HR/ATS modules may register new views after app.js; this file
  // runs at the end of all view registration scripts.
  for (const key of Object.keys(VIEWS.company)) {
    const previous = VIEWS.company[key];
    if (typeof previous !== 'function') continue;
    VIEWS.company[key] = function (...args) {
      if (!Store.state?.company) return missingProfile();
      return previous.apply(this, args);
    };
  }
})();
