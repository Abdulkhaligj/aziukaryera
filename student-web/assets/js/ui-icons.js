/* ADNSU Karyera - accessible icon system for the existing UI.
 * Only decorative icons are replaced. App routing and data stay unchanged. */
(() => {
  'use strict';
  const paths = Object.freeze({
    dashboard: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
    jobs: '<rect x="4" y="7" width="16" height="14" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M4 13h16"/>',
    vacancies: '<rect x="4" y="7" width="16" height="14" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M4 13h16"/>',
    applications: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3.5h6M8 10h8M8 14h8M8 18h4"/>',
    events: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18"/>',
    network: '<circle cx="8" cy="8" r="3"/><circle cx="18" cy="9" r="2"/><path d="M2 20v-2a6 6 0 0 1 12 0v2M17 15a4 4 0 0 1 4 4v1"/>',
    benefits: '<path d="M4 9h16v12H4zM2 9V5h20v4M12 5v16M7 5C4 5 4 1 7 1c3 0 5 4 5 4s2-4 5-4c3 0 3 4 0 4"/>',
    profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
    cv: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M9 7h6M9 11h6M9 15h4"/>',
    interview: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="m9 21 3-4 3 4M7 9h10M7 12h6"/>',
    roadmap: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h4a5 5 0 0 0 5-5v-5M4 9l3-3 3 3"/>',
    post: '<path d="M12 5v14M5 12h14"/><circle cx="12" cy="12" r="10"/>',
    analytics: '<path d="M3 21h18M6 17v-5m6 5V7m6 10V3" stroke-width="2.6"/>',
    'hr-analytics': '<path d="M3 21h18M6 17v-5m6 5V7m6 10V3" stroke-width="2.6"/>',
    candidates: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 6a3 3 0 0 1 0 5M21 20v-2a6 6 0 0 0-4-5.5"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    'talent-pool': '<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 6a3 3 0 0 1 0 5M21 20v-2a6 6 0 0 0-4-5.5"/>',
    compare: '<rect x="3" y="4" width="7" height="16" rx="1"/><rect x="14" y="4" width="7" height="16" rx="1"/><path d="M6 9h1M17 9h1M6 13h1M17 13h1"/>',
    invites: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="m3 7 9 7 9-7"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/><circle cx="12" cy="15" r="2"/>',
    partnerships: '<path d="M2 11l6-5 4 3 4-3 6 5-5 6-5 4-5-4z"/><path d="m8 13 4 3 4-3"/>',
    'partnerships-admin': '<path d="M2 11l6-5 4 3 4-3 6 5-5 4-5-4z"/><path d="m8 13 4 3 4-3"/>',
    approvals: '<path d="m5 12 5 5 9-10"/><circle cx="12" cy="12" r="10"/>',
    students: '<circle cx="8" cy="8" r="3"/><circle cx="17" cy="9" r="2"/><path d="M2 21v-2a6 6 0 0 1 12 0v2M17 15a5 5 0 0 1 5 5"/>',
    companies: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h2M14 7h2M8 11h2M14 11h2M10 21v-5h4v5"/>',
    redeem: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14v3m3-3h3v6h-6v-1"/>',
    reports: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v5h4M9 12h7M9 16h7"/>',
    subscription: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
    learner: '<path d="m2 9 10-5 10 5-10 5zM6 11v6c3 3 9 3 12 0v-6M22 9v7"/>',
    company: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h2M14 7h2M8 11h2M14 11h2M10 21v-5h4v5"/>'
  });
  const icon = name => '<svg class="adnsu-ux-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true">' + paths[name] + '</svg>';
  const root = document.getElementById('root');
  if (!root) return;
  function draw() {
    root.querySelectorAll('.rail a[data-view]').forEach(link => {
      const key = link.getAttribute('data-view');
      const target = link.querySelector('.ico');
      if (!target || !paths[key] || target.dataset.uxIcon === key) return;
      target.innerHTML = icon(key);
      target.dataset.uxIcon = key;
    });
    root.querySelectorAll('.account-choice-grid [data-account] .account-choice-icon').forEach(target => {
      const key = target.closest('[data-account]').getAttribute('data-account') === 'company' ? 'company' : 'learner';
      if (target.dataset.uxIcon === key) return;
      target.innerHTML = icon(key);
      target.dataset.uxIcon = key;
    });
    root.querySelectorAll('.notification-bell > span:first-child').forEach(target => {
      if (target.dataset.uxIcon === 'bell') return;
      target.innerHTML = icon('bell');
      target.dataset.uxIcon = 'bell';
    });
    root.querySelectorAll('.searchbar > .ico').forEach(target => {
      if (target.dataset.uxIcon === 'search') return;
      target.innerHTML = icon('search');
      target.dataset.uxIcon = 'search';
    });
  }
  new MutationObserver(draw).observe(root, {childList:true});
  draw();
})();