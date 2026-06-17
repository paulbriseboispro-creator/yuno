import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

let vapidKeyCache: string | null = null;

async function getVapidPublicKey(): Promise<string> {
  if (vapidKeyCache) return vapidKeyCache;
  const { data, error } = await supabase.functions.invoke('get-vapid-key');
  if (error || !data?.publicKey) throw new Error('Failed to fetch VAPID key');
  vapidKeyCache = data.publicKey;
  return data.publicKey;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

/** Upsert current subscription keys and delete stale endpoints for this user */
async function syncSubscriptionToDb(subscription: PushSubscription) {
  const p256dhKey = subscription.getKey('p256dh');
  const authKey = subscription.getKey('auth');
  if (!p256dhKey || !authKey) return;

  const p256dh = btoa(String.fromCharCode(...new Uint8Array(p256dhKey)));
  const auth = btoa(String.fromCharCode(...new Uint8Array(authKey)));

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  // Upsert current endpoint
  await supabase
    .from('push_subscriptions' as any)
    .upsert({
      user_id: user.id,
      endpoint: subscription.endpoint,
      p256dh,
      auth,
    }, { onConflict: 'user_id,endpoint' });

  // Delete all OTHER endpoints for this user (stale iOS endpoints)
  await supabase
    .from('push_subscriptions' as any)
    .delete()
    .eq('user_id', user.id)
    .neq('endpoint', subscription.endpoint);
}

export function usePushNotifications() {
  const [isSupported, setIsSupported] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [isLoading, setIsLoading] = useState(false);
  const [isiOS, setIsiOS] = useState(false);
  const [isPWA, setIsPWA] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    setIsiOS(isIOSDevice);

    const isPWAMode = window.matchMedia('(display-mode: standalone)').matches ||
                      (navigator as any).standalone === true;
    setIsPWA(isPWAMode);

    const hasServiceWorker = 'serviceWorker' in navigator;
    const hasPushManager = 'PushManager' in window;
    const hasNotification = 'Notification' in window;

    if (isIOSDevice && !isPWAMode) {
      setIsSupported(false);
    } else {
      setIsSupported(hasServiceWorker && hasPushManager && hasNotification);
    }

    if ('Notification' in window) {
      setPermission(Notification.permission);
    }

    checkSubscription().finally(() => setReady(true));

    const onSync = () => checkSubscription();
    window.addEventListener('pushSubscriptionChanged', onSync);
    return () => window.removeEventListener('pushSubscriptionChanged', onSync);
  }, []);

  const checkSubscription = async () => {
    try {
      if (!('serviceWorker' in navigator)) return;
      // Use the single workbox SW (push handlers are imported into it) — never a
      // separate /sw-push.js, which would replace workbox at scope '/'.
      const registration = await navigator.serviceWorker.ready;
      if (!registration) { setIsSubscribed(false); return; }
      const subscription = await registration.pushManager?.getSubscription();
      if (!subscription) { setIsSubscribed(false); return; }

      setIsSubscribed(true);

      // Auto-refresh: re-upsert keys and purge stale endpoints every app open
      try {
        await syncSubscriptionToDb(subscription);
      } catch (e) {
        console.warn('[Push] Auto-refresh sync failed:', e);
      }
    } catch {
      setIsSubscribed(false);
    }
  };

  const subscribe = useCallback(async () => {
    if (!isSupported) throw new Error('Push notifications not supported');
    setIsLoading(true);

    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') throw new Error('Permission denied');

      // Subscribe through the active workbox SW (it imports the push handlers).
      const registration = await navigator.serviceWorker.ready;

      const vapidKey = await getVapidPublicKey();
      const applicationServerKey = urlBase64ToUint8Array(vapidKey);

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey.buffer as ArrayBuffer,
      }) as PushSubscription;

      // Sync to DB and clean up stale endpoints
      await syncSubscriptionToDb(subscription);

      setIsSubscribed(true);
      window.dispatchEvent(new Event('pushSubscriptionChanged'));
    } catch (error) {
      console.error('[Push] Subscribe error:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [isSupported]);

  const unsubscribe = useCallback(async () => {
    setIsLoading(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      if (!registration) { setIsSubscribed(false); return; }

      const subscription = await registration.pushManager?.getSubscription();
      if (subscription) {
        await subscription.unsubscribe();
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await supabase
            .from('push_subscriptions' as any)
            .delete()
            .eq('user_id', user.id)
            .eq('endpoint', subscription.endpoint);
        }
      }
      setIsSubscribed(false);
      window.dispatchEvent(new Event('pushSubscriptionChanged'));
    } catch (error) {
      console.error('[Push] Unsubscribe error:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { isSupported, isSubscribed, permission, isLoading, isiOS, isPWA, ready, subscribe, unsubscribe };
}
