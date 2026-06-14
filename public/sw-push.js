// Push notification service worker - Yuno
self.addEventListener('install', (event) => {
  console.log('[SW-Push] Installing...');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[SW-Push] Activating...');
  event.waitUntil(clients.claim());
});

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
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        for (const client of windowClients) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.navigate(urlToOpen);
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      })
  );
});

self.addEventListener('notificationclose', () => {});
