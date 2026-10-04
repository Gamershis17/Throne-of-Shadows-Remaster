'use strict';
/* Throne of Shadows service worker — minimal offline shell for the PWA install.
 * - Cache-first for same-origin static assets (js/css/icons/manifest).
 * - Network-first for navigations and all /api/* requests.
 * - API responses are NEVER cached or altered.
 * - Versioned cache; old caches purged on activate.
 */
const CACHE = 'kop-static-v45';
const STATIC_RE = /\.(?:js|css|png|jpg|jpeg|webp|svg|ico|webmanifest|json|woff2?)$/i;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(['/', '/manifest.webmanifest'])).then(() => self.skipWaiting()).catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      // NOTE: Do NOT force-reload tabs here. The app's pollMaintenance()
      // already detects new deploys and shows a 10s countdown before
      // refreshing. Force-navigating (c.navigate) wipes in-progress logins
      // and bricks the auth flow — see 2026-10-02 login incident.
  );
});

function isApi(url) {
  return url.pathname.startsWith('/api/');
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  let url;
  try {
    url = new URL(request.url);
  } catch (e) {
    return;
  }
  if (url.origin !== self.location.origin) return;

  // Never touch API traffic: straight to network.
  if (isApi(url)) return;

  const isStatic = STATIC_RE.test(url.pathname);

  if (request.mode === 'navigate' || !isStatic) {
    // Navigations & anything else: network first, fall back to cache, then to /.
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(request).then((hit) => hit || caches.match('/')))
    );
    return;
  }

  // Static assets: cache first, populate on miss.
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
          }
          return res;
        })
    )
  );
});
