// Offline support. All paths are relative so the app works under https://<user>.github.io/<repo>/.
// __BUILD__ is replaced on deploy with a hash of the app files, so it only changes when the app does.
// A new version takes over straight away and is used the next time the app is opened.
const VERSION = '__BUILD__';
const SHELL = `shell-${VERSION}`;
// Unstamped (local run): network first, or a normal reload mixes old cached files with new ones.
const DEV = VERSION.startsWith('__');
const fresh = (req, key = req) => fetch(req).catch(() => caches.match(key, { cacheName: SHELL }));
const DATA = 'data-v1';
const PAGES = 'pages-v1';

const SHELL_FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/styles.css',
  'js/app.js',
  'js/i18n.js',
  'js/times.js',
  'data/cities.json',
  'icons/favicon.svg',
  'assets/senja/indonesia.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  ...['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'].flatMap((p) => [`assets/senja/${p}.webp`, `assets/senja/${p}-lines.webp`]),
  ...['jost-latin-300', 'jost-latin-400', 'jost-latin-500', 'sora-latin-400', 'sora-latin-500', 'sora-latin-600', 'amiri-arabic-400'].map((f) => `assets/fonts/${f}-normal.woff2`),
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('shell-') && k !== SHELL).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (req.mode === 'navigate') {
    const rel = url.pathname.slice(new URL(self.registration.scope).pathname.length);
    // Home: cached shell first so a slow network can't leave a blank screen; updates come with a new VERSION.
    if (rel === '' || rel === 'index.html') {
      e.respondWith(DEV ? fresh(req, 'index.html') : caches.match('index.html', { cacheName: SHELL }).then((hit) => hit || fetch(req)));
    } else {
      e.respondWith(cityPage(req, rel));
    }
    return;
  }

  // Schedule data: serve the saved copy instantly, refresh it in the background.
  if (url.pathname.includes('/data/')) {
    e.respondWith((async () => {
      const cache = await caches.open(DATA);
      const hit = await cache.match(req);
      const net = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
      if (hit) { e.waitUntil(net); return hit; }
      const res = await net;
      if (res) return res;
      const shellHit = await caches.match(req, { cacheName: SHELL }); // cities.json from install
      return shellHit || new Response('', { status: 503, statusText: 'offline' });
    })());
    return;
  }

  // App files: cache first.
  e.respondWith(DEV ? fresh(req) : caches.match(req, { cacheName: SHELL }).then((hit) => hit || fetch(req)));
});

// City pages (jadwal-sholat/<slug>/ and the English ones) carry this month's table, so the network comes first.
// Offline: the saved copy, else the home shell pointed back at the site root so its relative paths still load.
async function cityPage(req, rel) {
  const cache = await caches.open(PAGES);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit) return hit;
    const shell = await caches.match('index.html', { cacheName: SHELL });
    if (!shell) throw err;
    const depth = rel.split('/').length - 1;
    const html = (await shell.text()).replace('<meta charset="utf-8">', `$&<base href="${'../'.repeat(depth)}">`);
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
}
