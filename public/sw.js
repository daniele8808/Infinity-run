/* Service worker: cache-first per gli asset (GLB, audio, JS con hash),
   network-first per pagina e config così gli aggiornamenti arrivano subito. */
const CACHE = 'runner-v1';

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) return;
  const isFresh = req.mode === 'navigate' || req.url.includes('game-config.json') || req.url.endsWith('sw.js');
  if (isFresh) {
    // Network-first: aggiornamenti immediati, fallback offline dalla cache.
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true }))
    );
  } else {
    // Cache-first: asset immutabili (bundle con hash, GLB, audio, icone).
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }))
    );
  }
});
