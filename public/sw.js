const CACHE_NAME = 'limited-prep-timer-v1';

// On install, cache the root document so the app works offline.
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(['/'])));
  self.skipWaiting();
});

// On activate, remove stale caches from previous versions.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
      ),
  );
  self.clients.claim();
});

// Fetch strategy: serve from cache immediately, then update cache from network.
// Navigation requests always fall back to the root index.html (SPA shell).
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Only handle same-origin requests.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(event.request);

      const networkPromise = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            cache.put(event.request, response.clone());
          }
          return response;
        })
        .catch(() => null);

      // For navigation requests fall back to the cached root if the network fails.
      if (event.request.mode === 'navigate') {
        const response = await networkPromise;
        if (response) return response;
        return cached || (await cache.match('/')) || new Response('Offline', { status: 503 });
      }

      // For all other assets: return cached version immediately (if available)
      // while refreshing in the background.
      if (cached) {
        networkPromise.catch((err) => console.warn('Background cache update failed:', err));
        return cached;
      }

      return (await networkPromise) || new Response('Not found', { status: 404 });
    }),
  );
});
