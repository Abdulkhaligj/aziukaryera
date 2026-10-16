const CACHE_NAME = 'adnsu-career-shell-20261016b';
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/assets/css/styles.css?v=20261016b',
  '/assets/css/landing.css?v=20261016b',
  '/assets/js/config.js?v=20261016a',
  '/assets/js/data.js?v=20261016a',
  '/assets/js/match.js?v=20261016a',
  '/assets/js/cv.js?v=20261016a',
  '/assets/js/interview.js?v=20261016a',
  '/assets/js/backend.js?v=20261016a',
  '/assets/js/ai.js?v=20261016a',
  '/assets/js/store.js?v=20261016a',
  '/assets/js/auth.js?v=20261016a',
  '/assets/js/landing.js?v=20261016a',
  '/assets/js/app.js?v=20261016a',
  '/assets/js/pwa.js?v=20261016a',
  '/assets/icons/app-icon-192.png',
  '/assets/icons/app-icon-512.png',
  '/assets/icons/apple-touch-icon.png',
  '/assets/img/mascot-wave.webp'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => (await caches.match(request)) || caches.match('/index.html'))
    );
    return;
  }

  if (!['style', 'script', 'image', 'font', 'manifest'].includes(request.destination)) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      const fresh = fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
      return cached || fresh;
    })
  );
});
