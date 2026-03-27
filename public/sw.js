/* eslint-disable no-restricted-globals */

// Service Worker for ATCORA PWA — caching + push notifications

const CACHE_NAME = 'atcora-v2';
const APP_SHELL = ['/', '/index.html'];

// ──── Install: pre-cache app shell ────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

// ──── Activate: clean old caches ────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ──── Fetch: network-first for navigation, cache-first for hashed assets ────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET, API, and Supabase requests
  if (request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/') || url.origin.includes('supabase')) return;

  // Hashed Vite assets — cache-first (immutable)
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((res) => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(request, clone));
        return res;
      }))
    );
    return;
  }

  // Navigation — network-first with offline fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Other static assets — stale-while-revalidate
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetched = fetch(request).then((res) => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(request, clone));
        return res;
      }).catch(() => cached);
      return cached || fetched;
    })
  );
});

// ──── Push Notifications ────
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Atcora Notification', body: event.data?.text() || '' };
  }

  const title = data.title || 'Atcora Notification';
  const options = {
    body: data.body || '',
    icon: '/web-app-manifest-192x192.png',
    badge: '/favicon-96x96.png',
    data: { url: data.url || '/' },
    tag: data.tag || undefined,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus existing window if one is open
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      // Otherwise open a new window
      return self.clients.openWindow(url);
    })
  );
});
