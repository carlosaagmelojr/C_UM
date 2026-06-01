self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(k => Promise.all(k.map(c => caches.delete(c))))));
self.addEventListener('fetch', () => {});
