const CACHE_NAME = 'mint-v16';
const ASSETS = ['./', './index.html'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).catch(() => caches.match('./index.html')))
  );
});

// ── SCHEDULED NOTIFICATIONS ──
// Uses e.waitUntil() to keep the SW alive until the timer fires.
// Works when the app is minimized/closed (as long as browser hasn't been
// force-killed). For the 60s test this is rock-solid.
self.addEventListener('message', e => {
  const { type, id, title, body, delaySecs } = e.data || {};

  if (type === 'SCHEDULE_NOTIF') {
    e.waitUntil(
      new Promise(resolve => {
        setTimeout(async () => {
          await self.registration.showNotification(title || 'Mint', {
            body: body || '',
            icon:  './icon-192.png',
            badge: './icon-192.png',
            tag:   id || 'mint-notif',
            renotify: true,
            vibrate: [200, 100, 200]
          });
          resolve();
        }, (delaySecs || 0) * 1000);
      })
    );
  }
});

// Tap notification → open / focus the app
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.includes(self.location.origin) && 'focus' in c) return c.focus();
      }
      return clients.openWindow('./');
    })
  );
});
