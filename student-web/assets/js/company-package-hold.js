/*!
 * ADNSU Karyera — temporary package marketing hold.
 * Hides company price/package selection ONLY. Candidate search, Talent Pool,
 * candidate comparison, HR analysis, interviews and other modules stay open.
 * Pilot search shows only profiles already authorized by Supabase RLS.
 * No database, subscription, payment, or security-policy changes.
 * To restore package UI later, remove this script from index.html.
 */
(() => {
  'use strict';
  if (typeof NAV === 'undefined' || typeof VIEWS === 'undefined' || !VIEWS.company) return;

  // Leave every recruiting tool in place — only remove the package screen.
  NAV.company = NAV.company.filter(item => item.id !== 'subscription');
  VIEWS.company.subscription = () => `<div class="page-head">
    <h1>Şirkət kabineti</h1>
    <p>Vakansiya, müraciət, Talent Pool və müsahibə alətlərinə yan menyudan keçə bilərsiniz.</p>
    <button class="btn primary" data-act="go" data-view="dashboard">Ana səhifəyə qayıt</button>
  </div>`;

  // Temporary pilot access: active, signed-in employers may use search and
  // Talent Pool screens. This is UI-only: Supabase RLS still limits students
  // to company applicants or records this employer is entitled to see.
  // AI ranking and all other paid-feature checks remain server-controlled.
  if (typeof companyCanUse === 'function') {
    const originalCanUse = companyCanUse;
    companyCanUse = function (feature) {
      if (feature !== 'candidate_search') return originalCanUse(feature);
      const user = typeof Auth !== 'undefined' && Auth.currentUser();
      return !!(user && user.role === 'company' && user.status === 'active' &&
        Store.mode === 'supabase' && Store.state?.company);
    };
  }

  // Browser-saved link to a package page should return to normal company home.
  if (typeof Store !== 'undefined' && Store.state &&
      Store.state.session && Store.state.view === 'subscription') {
    Store.state.view = 'dashboard';
  }

  const style = document.createElement('style');
  style.id = 'adnsu-hide-company-packages';
  style.textContent = `
    .em-upgrade,
    .registration-plans,
    .field:has(> .registration-plans),
    [data-act="plan-select"],
    [data-act="go"][data-view="subscription"],
    [data-act="auth-plan"] {
      display: none !important;
    }
  `;
  document.head.appendChild(style);

  // Guard legacy package links without affecting any other buttons.
  document.addEventListener('click', event => {
    const btn = event.target.closest?.('[data-act="go"][data-view="subscription"]');
    if (!btn) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (typeof Auth !== 'undefined' && Auth.role() === 'company') {
      Store.state.view = 'dashboard';
      if (typeof rerender === 'function') rerender();
      else if (typeof render === 'function') render();
    }
  }, true);
})();
