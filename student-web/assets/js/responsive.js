/* Layout helpers that CSS alone cannot do. They run after every render
 * (the app replaces #app's HTML), after a language switch and on resize.
 *
 * 1. Landing header: when the menu links do not fit on one line, they are
 *    set smaller and closer first (the Russian labels are longer), and only
 *    when that is not enough either (narrow laptops) the header switches to
 *    the ☰ menu. A wrapped header used to drop its buttons over the page.
 * 2. Phone section tabs: the open section is scrolled into view in the
 *    horizontal tab strip, so the student always sees where they are.
 * 3. Phone tables: each cell gets its column name (data-label), which
 *    mobile.css shows when a table turns into one card per row.
 * 4. Landing logo strip: logos are sized to the same visual area.
 */
(function () {
  'use strict';

  function fitLandingHeader() {
    const head = document.querySelector('.lp-head');
    const nav = head && head.querySelector('.lp-nav');
    if (!nav) return;
    head.classList.remove('lp-head-tight', 'lp-head-compact');
    if (getComputedStyle(nav).display === 'none') return;   // phones: already the ☰ menu
    const overflows = () => nav.scrollWidth > nav.clientWidth + 1;
    if (!overflows()) return;
    head.classList.add('lp-head-tight');
    if (overflows()) head.classList.add('lp-head-compact');
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

  /* 4. Landing logo strip: every logo gets about the same visual area, so a
   *    wide wordmark (Kapital Bank) is lower and a square mark (bp, EY) is
   *    taller. Equal heights made the square marks look tiny. */
  function sizeLogo(img) {
    // The size written on the tag (landing.js), not the loaded picture: the
    // logo is laid out before it arrives and its tile never changes width.
    const w = Number(img.getAttribute('width')), h = Number(img.getAttribute('height'));
    if (!w || !h) return;
    const phone = innerWidth <= 520;
    const area = phone ? 5600 : 8400;
    const maxH = phone ? 66 : 82, maxW = phone ? 200 : 260;
    const ratio = w / h;
    let height = Math.min(maxH, Math.sqrt(area / ratio));
    let width = height * ratio;
    if (width > maxW) { width = maxW; height = width / ratio; }
    img.style.height = Math.round(height) + 'px';
    img.style.width = Math.round(width) + 'px';
  }

  function sizeLogos() {
    document.querySelectorAll('.lp-lgo img').forEach(sizeLogo);
  }

  let frame = 0;
  function run(force) {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      fitLandingHeader();
      showActiveSection();
      labelTables(force === true);
      sizeLogos();
    });
  }

  addEventListener('resize', () => run());
  document.addEventListener('i18n:change', () => { cancelAnimationFrame(frame); frame = 0; run(true); });
  new MutationObserver(() => run()).observe(document.documentElement, { childList: true, subtree: true });
  // The header is measured again once the web font has loaded: the fallback
  // font has other widths.
  if (document.fonts) document.fonts.ready.then(() => run());
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => run());
  else run();
})();
