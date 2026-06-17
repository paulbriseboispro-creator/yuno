// Push notification handlers for Yuno.
//
// These run INSIDE the workbox-generated service worker (sw.js) via
// `workbox.importScripts` (see vite.config.ts). Keeping push in the same SW is
// deliberate: a browser allows only ONE service worker per scope, so registering
// a separate /sw-push.js at scope '/' used to REPLACE the workbox SW — silently
// disabling the PWA precache AND the new-deploy auto-reload the moment a user
// enabled push. Folding the handlers in here keeps a single SW that does both.
//
// Do NOT add install/activate/skipWaiting/clientsClaim here — the workbox
// template owns the lifecycle (skipWaiting + clientsClaim are set in workbox
// config). Only event listeners belong in this file.

self.addEventListener('push', (event) => {
  let data = {
    title: 'Yuno',
    body: 'Tu as une nouvelle notification',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    url: '/',
  };

  try {
    if (event.data) {
      const payload = event.data.json();
      data = {
        title: payload.title || data.title,
        body: payload.body || data.body,
        icon: payload.icon || data.icon,
        badge: payload.badge || data.badge,
        url: payload.url || data.url,
      };
    }
  } catch (e) {
    try {
      if (event.data) data.body = event.data.text();
    } catch (_) {}
  }

  const options = {
    body: data.body,
    icon: data.icon,
    badge: data.badge,
    tag: 'yuno-notification',
    renotify: true,
    requireInteraction: false,
    data: { url: data.url },
  };

  event.waitUntil(
    (async () => {
      try {
        await self.registration.showNotification(data.title, options);
        const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        windowClients.forEach((client) => {
          client.postMessage({ type: 'PUSH_RECEIVED', payload: data });
        });
      } catch (err) {
        console.log('[SW-Push] Failed to display notification:', err);
      }
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        for (const client of windowClients) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.navigate(urlToOpen);
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(urlToOpen);
        }
      })
  );
});

self.addEventListener('notificationclose', () => {});
