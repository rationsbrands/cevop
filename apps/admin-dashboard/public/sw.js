/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { Queue } from 'workbox-background-sync';

const CACHE_NAME = 'cevop-admin-v2';

// Precache ALL build assets — injected by vite-plugin-pwa at build time
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Background Sync Queue — queues failed POST/PATCH/PUT mutations when offline
const mutationQueue = new Queue('admin-mutation-queue', {
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
  const { request } = event;

  // Queue offline mutations for later replay
  if (request.url.includes('/api/') && ['POST', 'PATCH', 'PUT'].includes(request.method)) {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request.clone());
        } catch {
          await mutationQueue.pushRequest({ request: request.clone() });
          return new Response(
            JSON.stringify({ success: false, queued: true, error: 'Offline — request queued' }),
            { status: 202, headers: { 'Content-Type': 'application/json' } },
          );
        }
      })(),
    );
    return;
  }

  // Skip non-GET, cross-origin, API, and socket requests
  if (!request.url.startsWith(self.location.origin)) return;
  if (request.url.includes('/api/') || request.url.includes('/socket.io/')) return;
  if (request.method !== 'GET') return;

  // Navigation — network first, fallback to cached shell
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match('/index.html').then((cached) => cached || Response.error()),
      ),
    );
    return;
  }

  // Static assets — cache first, network fallback, then cache the response
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      });
    }),
  );
});

// Push notification handler
self.addEventListener('push', (event) => {
  if (!event.data) return;

  try {
    const data = event.data.json();
    const options = {
      body: data.body || 'New update from Cevop',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      vibrate: [200, 100, 200, 100, 200, 100, 400],
      data: { url: data.url || '/', type: data.type || 'GENERIC' },
      tag: data.tag || 'cevop-alert',
      renotify: true,
      requireInteraction: true,
      actions: [],
    };

    if (['WAITER_CALL', 'SERVICE_REQUEST', 'ORDER_READY'].includes(data.type)) {
      options.actions.push({ action: 'view', title: 'View' });
    }

    event.waitUntil(self.registration.showNotification(data.title || 'Cevop Admin', options));
  } catch (err) {
    console.error('Push error:', err);
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => c.url.includes(url));
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    }),
  );
});
