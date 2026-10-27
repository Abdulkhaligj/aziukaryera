/*!
 * ADNSU Karyera — temporary company-package rollout hold (27 Oct 2026).
 * Presentation only: subscriptions, billing, plan entitlements, RLS and data
 * remain unchanged. To re-enable all UI, remove this script include.
 */
(() => {
  'use strict';

  if (typeof NAV === 'undefined' || typeof VIEWS === 'undefined' || !VIEWS.company) return;

  // Pro-only recruiting pages and package comparisons are not publicly
  // available during the current pilot. Regular HR workflow stays visible.
  const held = new Set(['subscription', 'candidates', 'search', 'talent-pool', 'compare']);

  NAV.company = NAV.company.filter(item => !held.has(item.id));

  const notice = () => `<section class="card pad-lg" style="max-width:680px;margin:28px auto">
    <div class="eyebrow">ADNSU Karyera</div>
    <h1 style="margin:12px 0">Yeni imkanlar hazırlanır</h1>
    <p>Əlavə şirkət alətləri pilot mərhələsindən sonra təqdim ediləcək.
    Vakansiyalarınızı, müraciətlərinizi və müsahibələrinizi əvvəlki kimi idarə edə bilərsiniz.</p>
    <button type="button" class="btn primary" data-act="go" data-view="dashboard" style="margin-top:16px">Şirkət kabinetinə qayıt</button>
  </section>`;

  // An old bookmarked screen or saved route cannot accidentally expose pricing.
  for (const id of held) VIEWS.company[id] = notice;
  if (typeof Store !== 'undefined' && Store.state &&
      Store.state.session && held.has(Store.state.view)) {
    Store.state.view = 'dashboard';
  }

  // Remove the package marketing callout from the otherwise useful basic HR
  // analytics. This is not an access-control mechanism or billing change.
  const css = document.createElement('style');
  css.id = 'company-package-hold';
  css.textContent = `
    .em-upgrade,
    [data-view="subscription"][data-act="go"],
    [data-act="plan-select"] { display:none !important; }
  `;
  document.head.appendChild(css);

  // In case a cached/legacy screen contains a link, route it safely.
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-act="go"][data-view="subscription"]');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (typeof Auth !== 'undefined' && Auth.role() === 'company') {
      Store.state.view = 'dashboard';
      if (typeof rerender === 'function') rerender();
      else if (typeof render === 'function') render();
    }
  }, true);
})();
