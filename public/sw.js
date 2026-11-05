/* Spring Plaza Cafe — minimal app-shell service worker.
 * - Static assets & images: cache-first
 * - HTML navigations: network-first, falling back to the last cached copy (so the app opens offline)
 * - API / Supabase / RSC data requests are never cached here; data lives in IndexedDB (Dexie).
 */
const VERSION = 'v2'; // bump on deploy → old caches are pruned on activate
const STATIC = `spc-static-${VERSION}`;
const PAGES = `spc-pages-${VERSION}`;
const IMAGES = `spc-img-${VERSION}`;
const MAX_IMAGES = 100; // cap so cashier tablets never fill up with menu photos

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('spc-') && ![STATIC, PAGES, IMAGES].includes(k)).map((k) => caches.delete(k))))
    .then(() => self.clients.claim())
));

async function trim(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]); // oldest first
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  const isStatic = url.origin === self.location.origin && (url.pathname.startsWith('/_next/static/') || /\.(?:svg|png|jpg|jpeg|webp|ico|woff2?)$/.test(url.pathname));
  if (isStatic || req.destination === 'image') {
    const isNextStatic = url.origin === self.location.origin && url.pathname.startsWith('/_next/static/');
    const name = isNextStatic ? STATIC : IMAGES;
    event.respondWith(
      caches.open(name).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        try {
          const res = await fetch(req);
          if (res.ok || res.type === 'opaque') { cache.put(req, res.clone()).then(() => name === IMAGES && trim(cache, MAX_IMAGES)).catch(() => {}); }
          return res;
        }
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
