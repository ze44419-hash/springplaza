/* Spring Plaza Cafe — minimal app-shell service worker.
 * - Static assets & images: cache-first
 * - HTML navigations: network-first, falling back to the last cached copy (so the app opens offline)
 * - API / Supabase / RSC data requests are never cached here; data lives in IndexedDB (Dexie).
 */
const STATIC = 'spc-static-v1';
const PAGES = 'spc-pages-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  const isStatic = url.origin === self.location.origin && (url.pathname.startsWith('/_next/static/') || /\.(?:svg|png|jpg|jpeg|webp|ico|woff2?)$/.test(url.pathname));
  if (isStatic || req.destination === 'image') {
    event.respondWith(
      caches.open(STATIC).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        try { const res = await fetch(req); if (res.ok || res.type === 'opaque') cache.put(req, res.clone()); return res; }
        catch { return hit || Response.error(); }
      })
    );
    return;
  }

  if (req.mode === 'navigate' && url.origin === self.location.origin) {
    event.respondWith(
      fetch(req).then((res) => {
        if (res.ok && !res.redirected) { const copy = res.clone(); caches.open(PAGES).then((c) => c.put(req, copy)); }
        return res;
      }).catch(async () => (await caches.match(req)) || (await caches.match('/cashier')) || (await caches.match('/waiter')) || Response.error())
    );
  }
});
