// Lend Tracker Service Worker - Cache-First for static assets, Network-Only for API
const CACHE_NAME = 'lend-tracker-v5.1.0';
const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './favicon.ico',
  './favicon-32x32.png',
  './favicon-16x16.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

// Install: Cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activate: Clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Network-first or Cache-first based on request
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache Google Apps Script API calls or external dynamic requests
  if (url.hostname.includes('script.google.com') || url.hostname.includes('googleusercontent.com')) {
    return event.respondWith(fetch(event.request));
  }

  // Static assets: Cache falling back to network
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        // Cache valid local GET responses
        if (event.request.method === 'GET' && networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => {
        // Fallback for HTML navigation when completely offline
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
