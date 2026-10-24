// Offline support. All paths are relative so the app works under https://<user>.github.io/<repo>/.
// __BUILD__ is replaced on deploy with a hash of the app files, so it only changes when the app does.
// A new version takes over straight away and is used the next time the app is opened.
const VERSION = '__BUILD__';
const SHELL = `shell-${VERSION}`;
const DATA = 'data-v1';

const SHELL_FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/styles.css',
  'js/app.js',
  'js/i18n.js',
  'js/next.js',
  'data/cities.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'assets/meteocons/clear-day.svg',
  'assets/meteocons/cloudy.svg',
  'assets/meteocons/moon-waxing-crescent.svg',
  'assets/meteocons/sunrise.svg',
  'assets/meteocons/sunset.svg',
  ...[400, 500, 600, 700, 800].map((w) => `assets/fonts/plus-jakarta-sans-latin-${w}-normal.woff2`),
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

  // Pages: cached shell first so a slow network can't leave a blank screen; updates come with a new VERSION.
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('index.html', { cacheName: SHELL }).then((hit) => hit || fetch(req)));
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
  e.respondWith(caches.match(req, { cacheName: SHELL }).then((hit) => hit || fetch(req)));
});
