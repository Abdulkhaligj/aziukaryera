/* ADNSU Career PWA - network first for executable code, cache v20261102. */
const CACHE_NAME = 'adnsu-career-shell-20261126-admin-v1';
// The admin panel is served under this address too (career.asoiu.edu.az/admin,
// passed through to its own app). Its pages, scripts and API are never
// answered or kept by this worker: kept admin pages would hold staff data,
// and the panel's own navigation broke when this worker sat in between.
// A new cache name also drops the old cache, which held such pages.
const ADMIN_PATHS = /^\/(admin|login|account|api\/admin|_next|icons)(\/|$)/;
const OFFLINE = ['/','/index.html','/manifest.webmanifest'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(OFFLINE)));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(key => key.startsWith('adnsu-career-shell-') && key !== CACHE_NAME)
      .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (ADMIN_PATHS.test(url.pathname)) return;
  // Fresh scripts, CSS and HTML are vital: never reuse a broken old bundle
  // before attempting a live request. Keep offline fallbacks where possible.
  if (request.mode === 'navigate' || ['script','style'].includes(request.destination)) {
    event.respondWith(fetch(request, { cache: 'no-store' }).then(response => {
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(request, copy)));
      }
      return response;
    }).catch(async () =>
      (await caches.match(request)) ||
      (request.mode === 'navigate' ? caches.match('/index.html') : Response.error())
    ));
    return;
  }
  if (!['image','font','manifest'].includes(request.destination)) return;
  // Only the site's own files are kept offline, never pictures people upload
  // (audit 2026-11-16, L50); sign-out also empties this cache.
  if (request.destination !== 'manifest' && !url.pathname.startsWith('/assets/')) return;
  event.respondWith(caches.match(request).then(cached => {
    if (cached) return cached;
    return fetch(request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(request, copy)));
      }
      return response;
    });
  }));
});
