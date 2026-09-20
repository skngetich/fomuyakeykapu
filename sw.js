// Cache-first for the app shell so the sheet keeps working in a gym with no signal.
const CACHE = 'fiba-scoresheet-v1';
const ASSETS = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'model.js',
  'sheet.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Stale-while-revalidate: answer instantly from cache (so the app opens with no
// signal), but refresh the entry in the background so a redeploy is picked up on
// the next launch instead of being pinned forever.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: true });
      const net = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => hit || cache.match('index.html'));
      return hit || net;
    }),
  );
});
