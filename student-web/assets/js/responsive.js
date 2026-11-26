/* Layout helpers that CSS alone cannot do. They run after every render
 * (the app replaces #app's HTML), after a language switch and on resize.
 *
 * 1. Landing header: when the menu links do not fit on one line (Russian
 *    labels are longer, and narrow laptops), the header switches to the ☰
 *    menu. A wrapped header used to drop its buttons over the page.
 * 2. Phone section tabs: the open section is scrolled into view in the
 *    horizontal tab strip, so the student always sees where they are.
 * 3. Phone tables: each cell gets its column name (data-label), which
 *    mobile.css shows when a table turns into one card per row.
 */
(function () {
  'use strict';

  function fitLandingHeader() {
    const head = document.querySelector('.lp-head');
    const nav = head && head.querySelector('.lp-nav');
    if (!nav) return;
    head.classList.remove('lp-head-compact');
    if (getComputedStyle(nav).display === 'none') return;   // phones: already the ☰ menu
    if (nav.scrollWidth > nav.clientWidth + 1) head.classList.add('lp-head-compact');
  }

  function showActiveSection() {
    const rail = document.querySelector('.rail');
    if (!rail || rail.scrollWidth <= rail.clientWidth) return;   // desktop sidebar
    const link = rail.querySelector('[aria-current="page"]');
    if (!link || rail.dataset.centered === link.getAttribute('href')) return;
    rail.dataset.centered = link.getAttribute('href');
    const r = rail.getBoundingClientRect();
    const a = link.getBoundingClientRect();
    rail.scrollLeft += (a.left - r.left) - (r.width - a.width) / 2;
  }

  function labelTables(force) {
    document.querySelectorAll('.table-wrap table').forEach(table => {
      if (table.dataset.labeled && !force) return;
      const heads = [...table.querySelectorAll('thead th')].map(th => th.textContent.trim());
      if (!heads.length) return;
      table.querySelectorAll('tbody tr').forEach(tr => {
        [...tr.children].forEach((td, i) => td.setAttribute('data-label', heads[i] || ''));
      });
      table.dataset.labeled = '1';
    });
  }

  let frame = 0;
  function run(force) {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      fitLandingHeader();
      showActiveSection();
      labelTables(force === true);
    });
  }

  addEventListener('resize', () => run());
  document.addEventListener('i18n:change', () => { cancelAnimationFrame(frame); frame = 0; run(true); });
  new MutationObserver(() => run()).observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => run());
  else run();
})();
