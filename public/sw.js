/* eslint-disable no-restricted-globals */

// Service Worker for ATCORA PWA — caching, update lifecycle, and push notifications
//
// HOW UPDATES WORK:
// 1. Vercel serves sw.js with Cache-Control: no-cache — browser always byte-checks.
// 2. Any change to this file (including CACHE_VERSION bump from build) triggers
//    the browser's "installing" → "waiting" lifecycle.
// 3. The app (main.tsx) detects the waiting worker and sends SKIP_WAITING.
// 4. This worker calls skipWaiting(), activates, purges old caches, claims clients.
// 5. The app listens for controllerchange and reloads the page once.

const CACHE_VERSION = 'atcora-v3';
const APP_SHELL = ['/', '/index.html'];

// ──── Install: pre-cache app shell, skip waiting immediately if told to ────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// ──── Activate: purge ALL old caches, claim clients ────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ──── Message: allow app to tell a waiting worker to take over ────
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ──── Fetch ────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET, API calls, and Supabase traffic
  if (request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/') || url.origin.includes('supabase')) return;

  // ── Navigation requests → ALWAYS network-first ──
  // This guarantees the browser gets the latest index.html (with fresh asset hashes)
  // after every deploy.  Offline fallback serves the last cached copy.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(request, clone));
          return res;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // ── Hashed Vite assets (/assets/*) → cache-first (immutable) ──
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((res) => {
            const clone = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(request, clone));
            return res;
          })
      )
    );
    return;
  }

  // ── Everything else → stale-while-revalidate ──
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetched = fetch(request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(request, clone));
          return res;
        })
        .catch(() => cached);
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
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.navigate(url);
            return client.focus();
          }
        }
        return self.clients.openWindow(url);
      })
  );
});
