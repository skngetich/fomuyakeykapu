// Offline app shell, one complete cache per release.
//
// Each release precaches every file before it installs (cache.addAll is
// all-or-nothing), so a phone never runs a mix of old and new files. Updates
// are never applied mid-game: while the app reports an open game, the version
// it started on is "pinned" and keeps being served, even across restarts,
// until the game is closed. scripts/build-site.mjs stamps VERSION per build
// and copies exactly the files in ASSETS, so this list is the one definition
// of what ships with the app.
const VERSION = 'dev';
const CACHE = `scoresheet-${VERSION}`;
const META = 'scoresheet-meta';
const PIN = 'pin';

// Relative to this file (served from /app/). './' rather than 'index.html':
// static hosts redirect /index.html to the directory, and cache.addAll
// rejects a redirected response, which would stop the worker installing.
const ASSETS = [
  './',
  'app.js',
  'model.js',
  'sheet.js',
  'version.js',
  'manifest.webmanifest',
  '../config.js',
  '../theme-init.js',
  '../styles.css',
  '../icons/icon.svg',
  '../icons/icon-192.png',
  '../icons/icon-512.png',
  '../icons/icon-maskable-512.png',
];

const pinned = async () => {
  const res = await (await caches.open(META)).match(PIN);
  return res ? res.text() : null;
};

const setPin = async (name) => {
  const meta = await caches.open(META);
  if (name) return meta.put(PIN, new Response(name));
  await meta.delete(PIN);
  // The release a game was pinned to is not needed once the game is closed.
  for (const k of await caches.keys()) if (k !== CACHE && k !== META) await caches.delete(k);
};

/** The cache to serve from: the pinned release while a game is open, else this one. */
async function servingCache() {
  const pin = await pinned();
  if (pin && pin !== CACHE && (await caches.has(pin))) return pin;
  return CACHE;
}

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const keep = new Set([CACHE, META, await pinned()]);
      for (const k of await caches.keys()) if (!keep.has(k)) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (e) => {
  const msg = e.data || {};
  if (msg.type === 'skip-waiting') {
    self.skipWaiting();
  } else if (msg.type === 'game-open') {
    // Pin whatever release is serving now. Once the game closes, the pin is
    // dropped and the next launch gets the newest release.
    e.waitUntil(
      (async () => {
        if (msg.open) {
          if (!(await pinned())) await setPin(await servingCache());
        } else {
          await setPin(null);
        }
      })(),
    );
  } else if (msg.type === 'status') {
    e.waitUntil(
      servingCache().then((serving) =>
        e.source?.postMessage({ type: 'status', serving, latest: CACHE }),
      ),
    );
  }
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    (async () => {
      const cache = await caches.open(await servingCache());
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      // Any page under /app/ is the app shell, e.g. /app/index.html.
      if (req.mode === 'navigate') {
        const shell = await cache.match('./');
        if (shell) return shell;
      }
      return fetch(req);
    })(),
  );
});
