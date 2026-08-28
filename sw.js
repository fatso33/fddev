const CACHE_NAME = 'flightdeck-v9';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './bridgeClient.js',
  './app.js',
  './pages/radios.js',
  './pages/autopilot.js',
  './pages/lights.js',
  './pages/settings.js',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Network-first strategy for real-time avionics updates
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        return networkResponse;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});
