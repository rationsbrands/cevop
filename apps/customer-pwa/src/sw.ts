/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { StaleWhileRevalidate, CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { Queue } from 'workbox-background-sync';

declare let self: ServiceWorkerGlobalScope;

// Precache all build assets (injected by vite-plugin-pwa at build time)
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Navigation fallback — SPA routing
registerRoute(
  new NavigationRoute(
    new StaleWhileRevalidate({
      cacheName: 'pages',
    }),
    {
      allowlist: [/^\/menu\//, /^\/order\//],
    },
  ),
);

// Menu API — stale while revalidate, 1 hour TTL
registerRoute(
  ({ url }) => url.pathname.includes('/api/menu/public/'),
  new StaleWhileRevalidate({
    cacheName: 'menu-cache',
    plugins: [new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 60 * 60 })],
  }),
);

// Table info API — cache first, 24 hour TTL (table info rarely changes)
registerRoute(
  ({ url }) => url.pathname.includes('/api/tables/public/'),
  new CacheFirst({
    cacheName: 'table-cache',
    plugins: [new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 })],
  }),
);

// Background Sync — queue failed order POST requests and replay when online
// This ensures orders placed while offline are submitted when connectivity returns,
// even if the customer has closed the browser tab.
const orderQueue = new Queue('pending-orders', {
  maxRetentionTime: 24 * 60, // Retry for up to 24 hours
  onSync: async ({ queue }) => {
    let entry;
    while ((entry = await queue.shiftRequest())) {
      try {
        await fetch(entry.request.clone());
      } catch {
        // Put it back and stop — still offline
        await queue.unshiftRequest(entry);
        throw new Error('Replay failed — still offline');
      }
    }
  },
});

// Intercept public order POST requests — queue them if the network fails
self.addEventListener('fetch', (event: FetchEvent) => {
  if (event.request.method === 'POST' && event.request.url.includes('/api/orders/public')) {
    const bgSyncResponse = async () => {
      try {
        const response = await fetch(event.request.clone());
        return response;
      } catch {
        await orderQueue.pushRequest({ request: event.request.clone() });
        return new Response(
          JSON.stringify({ success: false, queued: true, error: 'Offline — order queued' }),
          { status: 202, headers: { 'Content-Type': 'application/json' } },
        );
      }
    };
    event.respondWith(bgSyncResponse());
  }
});

// Push notification handler
self.addEventListener('push', (event: PushEvent) => {
  let data: { title?: string; body?: string; url?: string; tag?: string; type?: string };
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

  const options: any = {
    body,
    tag,
    data: { url, type },
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [200, 100, 200],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const url = event.notification.data?.url ?? '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => c.url.includes(url));
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    }),
  );
});
