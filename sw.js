// Include the scope so other apps on the same GitHub Pages origin keep their caches.
const cachePrefix = `watt-a-breeze:${self.registration.scope}:`;
const cacheName = `${cachePrefix}v1`;
const shell = [
  './', './index.html', './styles.css', './app.js', './bluetooth.js', './core.js',
  './pwa.js', './manifest.webmanifest', './favicon.svg',
  './icons/icon-192.png', './icons/icon-512.png',
];
const shellURLs = new Set(shell.map(path => new URL(path, self.registration.scope).href));

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(shell)));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(cachePrefix) && name !== cacheName)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  url.search = '';
  if (event.request.method !== 'GET' || !shellURLs.has(url.href)) return;

  // Prefer current files online; retain an app shell for offline launches.
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    try {
      const response = await fetch(event.request);
      if (response.ok) {
        // A full or unavailable cache must not prevent online use.
        await cache.put(url.href, response.clone()).catch(() => {});
        return response;
      }
      return await cache.match(url.href) || response;
    } catch {
      return await cache.match(url.href) || Response.error();
    }
  })());
});
