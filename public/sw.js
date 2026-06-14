// Service Worker for Push Notifications
self.addEventListener('install', (event) => {
  console.log('Service Worker installing...');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('Service Worker activating...');
  event.waitUntil(clients.claim());
});

self.addEventListener('push', (event) => {
  console.log('Push notification received:', event);
  
  const data = event.data?.json() || {};
  const { notification } = data;
  
  if (notification) {
    const options = {
      body: notification.body,
      icon: notification.icon || '/favicon.ico',
      badge: notification.badge || '/favicon.ico',
      tag: notification.tag,
      data: notification.data,
      requireInteraction: true,
      vibrate: [200, 100, 200],
    };

    event.waitUntil(
      self.registration.showNotification(notification.title, options)
    );
  }
});

self.addEventListener('notificationclick', (event) => {
  console.log('Notification clicked:', event);
  event.notification.close();

  const urlToOpen = event.notification.data?.url || '/my-orders';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Check if there's already a window open
      for (const client of clientList) {
        if (client.url.includes(urlToOpen) && 'focus' in client) {
          return client.focus();
        }
      }
      // If no window is open, open a new one
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
