/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { Queue } from 'workbox-background-sync';

const CACHE_NAME = 'cevop-service-v2';

// Precache ALL build assets — injected by vite-plugin-pwa at build time
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Background Sync Queue for offline mutations
const mutationQueue = new Queue('mutation-queue', {
  maxRetentionTime: 24 * 60, // 24 hours
  onSync: async ({ queue }) => {
    let entry;
    while ((entry = await queue.shiftRequest())) {
      try {
        await fetch(entry.request.clone());
      } catch {
        await queue.unshiftRequest(entry);
        throw new Error('Replay failed — still offline');
      }
    }
  },
});

self.addEventListener('install', () => {
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

self.addEventListener('fetch', (event) => {
  // Handle API Mutations (POST, PATCH, PUT) for offline queueing
  if (
    event.request.url.includes('/api/') &&
    ['POST', 'PATCH', 'PUT'].includes(event.request.method)
  ) {
    const bgSyncResponse = async () => {
      try {
        const response = await fetch(event.request.clone());
        return response;
      } catch {
        await mutationQueue.pushRequest({ request: event.request.clone() });
        return new Response(
          JSON.stringify({ success: false, queued: true, error: 'Offline — request queued' }),
          { status: 202, headers: { 'Content-Type': 'application/json' } },
        );
      }
    };
    event.respondWith(bgSyncResponse());
    return;
  }

  // Bypass other non-GET or cross-origin requests
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

// Improved Push notification handler
self.addEventListener('push', (event) => {
  if (!event.data) return;

  try {
    const data = event.data.json();
    const options = {
      body: data.body || 'New update from Cevop',
      icon: '/logo192.png',
      badge: '/logo192.png',
      vibrate: [200, 100, 200, 100, 200, 100, 400],
      data: {
        url: data.url || '/',
        type: data.type || 'GENERIC',
      },
      tag: data.tag || 'cevop-alert',
      renotify: true,
      requireInteraction: true,
      actions: [],
    };

    if (
      data.type === 'WAITER_CALL' ||
      data.type === 'SERVICE_REQUEST' ||
      data.type === 'ORDER_READY'
    ) {
      options.actions.push({ action: 'view', title: 'View Task' });
    }

    event.waitUntil(self.registration.showNotification(data.title || 'Cevop Alert', options));
  } catch (err) {
    console.error('Push error:', err);
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = event.notification.data.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (let client of windowClients) {
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(urlToOpen);
      }
    }),
  );
});
