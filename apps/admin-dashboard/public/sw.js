self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open('cevop-admin-v1')
      .then((cache) =>
        cache.addAll([
          '/',
          '/manifest.webmanifest',
          '/icon-192.png',
          '/icon-512.png',
          '/apple-touch-icon.png',
        ]),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches
            .open('cevop-admin-v1')
            .then((cache) => cache.put('/', copy))
            .catch(() => void 0);
          return res;
        })
        .catch(() => caches.match('/').then((cached) => cached || Response.error())),
    );
    return;
  }

  if (
    url.pathname.startsWith('/assets/') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.js')
  ) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          const copy = res.clone();
          caches
            .open('cevop-admin-v1')
            .then((cache) => cache.put(req, copy))
            .catch(() => void 0);
          return res;
        });
      }),
    );
  }
});
