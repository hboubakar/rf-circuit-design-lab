// Offline support for Smith Chart Lab. The page is fetched fresh when online and
// served from the cache when not. Bump VERSION whenever the shell files change.
const VERSION = 'smith-v5';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/chart.js', 'js/draw.js', 'js/format.js', 'js/ladder.js', 'js/layers.js',
  'js/lessons.js', 'js/share.js', 'js/smith.js', 'js/solver.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png',
  '../images/icon.png', '../images/favicon.ico',
];
// Open-source fonts and icons come from their CDNs; keep copies, with the font files they load.
const CDN = [
  'https://fonts.googleapis.com/css2?family=Caveat:wght@600&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap',
  'https://unpkg.com/@phosphor-icons/web@2.1.1/src/regular/style.css',
];

async function keepCss(cache, url) {
  const res = await fetch(url, { mode: 'cors' });
  if (!res.ok) return;
  await cache.put(url, res.clone());
  const css = await res.text();
  const files = [...css.matchAll(/url\(([^)]+)\)/g)].map(m => new URL(m[1].replace(/["']/g, ''), url).href)
    .filter(href => /\.woff2(\?|$)/.test(href) || href.includes('fonts.gstatic.com'));
  await Promise.all(files.map(f => fetch(f, { mode: 'cors' }).then(r => r.ok && cache.put(f, r)).catch(() => {})));
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(SHELL);
    await Promise.all(CDN.map(url => keepCss(cache, url).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== VERSION) await caches.delete(key);
    await self.clients.claim();
  })());
});

function timeout(ms) { return new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), ms)); }

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    // Network first, so an update shows at once; the cache when offline or very slow.
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      try {
        const res = await Promise.race([fetch(req, { cache: 'no-cache' }), timeout(4000)]); // revalidate, so updates show at once
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch {
        const hit = await cache.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' && await cache.match('index.html'));
        return hit || Response.error();
      }
    })());
    return;
  }
  if (/fonts\.(googleapis|gstatic)\.com|unpkg\.com/.test(url.host)) {
    // Fonts and icons never change at a fixed version: cache first.
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const hit = await cache.match(req.url);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') cache.put(req.url, res.clone());
      return res;
    })());
  }
});
