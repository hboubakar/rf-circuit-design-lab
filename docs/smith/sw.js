// Smith Chart Lab runs in the browser only, for now. An earlier version saved an
// offline copy through this service worker; this version removes that copy and
// unregisters itself, so devices that installed it go back to the live site.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('smith-')) await caches.delete(key);
    await self.registration.unregister();
    // Reload open pages so they come from the network, not the old copy.
    for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url);
  })());
});
