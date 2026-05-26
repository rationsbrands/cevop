const CACHE_NAME = 'cevop-service-v1';

// On install — cache the app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(['/', '/index.html']).catch(() => {
        // Ignore cache failures — app still works online
      });
    }),
  );
  self.skipWaiting();
});

// On activate — clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      ),
  );
  self.clients.claim();
});

// On fetch — network first, fallback to cache for navigation
self.addEventListener('fetch', (event) => {
  // Only handle same-origin requests
  if (!event.request.url.startsWith(self.location.origin)) return;

  // For navigation requests (HTML) — network first, fallback to cached index
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/index.html')));
    return;
  }

  // For API and socket requests — network only, never cache
  if (event.request.url.includes('/api/') || event.request.url.includes('/socket.io/')) {
    return;
  }

  // For static assets — network first with cache fallback
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});

// EXISTING push notification handlers — keep exactly as is
self.addEventListener('push', (event) => {
  let data;
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = data && typeof data.title === 'string' ? data.title : 'Cevop';
  const body = data && typeof data.body === 'string' ? data.body : '';
  const url = data && typeof data.url === 'string' ? data.url : '/';
  const tag = data && typeof data.tag === 'string' ? data.tag : undefined;
  const type = data && typeof data.type === 'string' ? data.type : 'GENERIC';

  const options = {
    body,
    tag,
    data: { url, type },
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [200, 100, 200, 100, 400], // High-priority double pulse
    requireInteraction: true, // Keep notification visible until dismissed
    actions: [],
  };

  // Add contextual actions for lock-screen efficiency
  if (type === 'WAITER_CALL' || type === 'SERVICE_REQUEST') {
    options.actions.push({ action: 'claim', title: 'Claim Table' });
  }

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  const { notification, action } = event;
  notification.close();

  const url = notification.data?.url || '/';
  const type = notification.data?.type;

  // Handle background actions without opening the app if possible
  if (action === 'claim' && type) {
    // In a real production app, we would use fetch() here to call a "background claim" API
    // For now, we'll open the app to handle the claim logic
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      for (const client of clientsArr) {
        if (client.url && client.url.includes(url) && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
      return null;
    }),
  );
});
