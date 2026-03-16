const CACHE_NAME = 'kondate-v1';
const ASSETS = [
  './',
  './index.html',
  './menu.html',
  './recipe.html',
  './profile.html',
  './shopping.html',
  './history.html',
  './style.css',
  './app.js',
  './config.js',
  './manifest.json',
  './icon.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  // Network first strategy for API / dynamic looking? This is a static site with local storage.
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    }).catch(() => {
      // Offline fallback
      return caches.match('./index.html');
    })
  );
});

self.addEventListener('activate', event => {
  const cacheAllowlist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheAllowlist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});
