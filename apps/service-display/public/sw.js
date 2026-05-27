/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';

const CACHE_NAME = 'cevop-service-v2';

// Precache ALL build assets — injected by vite-plugin-pwa at build time
// This replaces the manual cache.addAll(['/', '/index.html']) which missed JS chunks
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Fallback install for environments where __WB_MANIFEST is not injected (dev)
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(['/', '/index.html']).catch(() => void 0)),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME && !key.startsWith('workbox-'))
            .map((key) => caches.delete(key)),
        ),
      ),
  );
  self.clients.claim();
});

// Fetch strategy: network first for navigation, cache first for assets
self.addEventListener('fetch', (event) => {
  if (!event.request.url.startsWith(self.location.origin)) return;
  if (event.request.url.includes('/api/') || event.request.url.includes('/socket.io/')) return;
  if (event.request.method !== 'GET') return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches.match('/index.html').then((cached) => cached || Response.error()),
      ),
    );
    return;
  }

  // Static assets — cache first with network fallback
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    }),
  );
});

// Push notification handler
self.addEventListener('push', (event) => {
  let data;
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = data.title ?? 'Cevop';
  const body = data.body ?? '';
  const url = data.url ?? '/';
  const tag = data.tag;
  const type = data.type ?? 'GENERIC';

  const options = {
    body,
    tag,
    data: { url, type },
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [200, 100, 200, 100, 400],
    requireInteraction: true,
    actions: [],
  };

  if (type === 'WAITER_CALL' || type === 'SERVICE_REQUEST') {
    options.actions.push({ action: 'claim', title: 'Claim Table' });
  }

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  const { notification } = event;
  notification.close();
  const url = notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      for (const client of clientsArr) {
        if (client.url && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
      return null;
    }),
  );
});
