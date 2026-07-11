import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { isNative, isProApp } from '@/lib/native';

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
      platform: 'web',
    }, { onConflict: 'user_id,endpoint' });

  // Delete all OTHER *web* endpoints for this user (stale browser endpoints).
  // Never touch platform='ios' rows: the APNs token of the native app must
  // survive the user opening the web app on desktop.
  await supabase
    .from('push_subscriptions' as any)
    .delete()
    .eq('user_id', user.id)
    .eq('platform', 'web')
    .neq('endpoint', subscription.endpoint);
}

// ---------------------------------------------------------------------------
// App native (Capacitor iOS) : le push passe par APNs, pas par le Web Push.
// Le token device est stocké dans push_subscriptions avec platform='ios' et
// endpoint='apns:<token>' — le relay send-push-notification route dessus.
// ---------------------------------------------------------------------------

/** register() APNs et attend le token (les events Capacitor sont asynchrones). */
async function registerNativePush(): Promise<string> {
  const { PushNotifications } = await import('@capacitor/push-notifications');
  return await new Promise<string>((resolve, reject) => {
    let settled = false;
    const listeners: Array<Promise<{ remove(): Promise<void> }>> = [];
    const cleanup = () => {
      clearTimeout(timer);
      listeners.forEach((p) => p.then((s) => s.remove()).catch(() => {}));
    };
    const timer = setTimeout(() => {
      if (!settled) { settled = true; cleanup(); reject(new Error('APNs registration timeout')); }
    }, 10000);
    listeners.push(PushNotifications.addListener('registration', (token) => {
      if (!settled) { settled = true; cleanup(); resolve(token.value); }
    }));
    listeners.push(PushNotifications.addListener('registrationError', (err) => {
      if (!settled) { settled = true; cleanup(); reject(new Error(err.error)); }
    }));
    PushNotifications.register().catch((e) => {
      if (!settled) { settled = true; cleanup(); reject(e); }
    });
  });
}

/**
 * Plateforme native du token : l'app B2C stocke 'ios', l'app Yuno Pro
 * 'ios_pro' (topics APNs distincts côté relay). Un même utilisateur peut
 * avoir les deux apps : upserts ET purges toujours scopés à SA plateforme —
 * ne jamais toucher les tokens de l'autre app.
 */
function nativePlatform(): 'ios' | 'ios_pro' {
  return isProApp() ? 'ios_pro' : 'ios';
}

/** Upsert le token APNs courant et purge les anciens tokens de CETTE app. */
async function syncNativeTokenToDb(token: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const endpoint = `apns:${token}`;
  const platform = nativePlatform();
  await supabase
    .from('push_subscriptions' as any)
    .upsert({
      user_id: user.id,
      endpoint,
      p256dh: null,
      auth: null,
      platform,
    }, { onConflict: 'user_id,endpoint' });
  await supabase
    .from('push_subscriptions' as any)
    .delete()
    .eq('user_id', user.id)
    .eq('platform', platform)
    .neq('endpoint', endpoint);
}

async function deleteNativeSubscription(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from('push_subscriptions' as any)
    .delete()
    .eq('user_id', user.id)
    .eq('platform', nativePlatform());
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
    // App native Capacitor : le push passe par APNs (plugin), pas par le SW.
    // isPWA=true côté natif : toutes les surfaces qui gataient sur "iOS hors
    // PWA = pas de push" (OnboardingGate, Settings) fonctionnent sans change.
    if (isNative()) {
      setIsiOS(true);
      setIsPWA(true);
      setIsSupported(true);
      checkSubscription().finally(() => setReady(true));
      const onSync = () => checkSubscription();
      window.addEventListener('pushSubscriptionChanged', onSync);
      return () => window.removeEventListener('pushSubscriptionChanged', onSync);
    }

    const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    setIsiOS(isIOSDevice);

    const isPWAMode = window.matchMedia('(display-mode: standalone)').matches ||
                      (navigator as any).standalone === true;
    setIsPWA(isPWAMode);

    // Web push abandonné (stratégie app-first : les notifications passent par
    // l'app iOS, le web redirige vers l'app). Plus aucun prompt ni toggle push
    // sur web/PWA — isSupported reste false hors natif.
    setIsSupported(false);

    if ('Notification' in window) {
      setPermission(Notification.permission);
    }

    setReady(true);

    const onSync = () => checkSubscription();
    window.addEventListener('pushSubscriptionChanged', onSync);
    return () => window.removeEventListener('pushSubscriptionChanged', onSync);
  }, []);

  const checkSubscription = async () => {
    if (isNative()) {
      try {
        const { PushNotifications } = await import('@capacitor/push-notifications');
        const perm = await PushNotifications.checkPermissions();
        setPermission(perm.receive === 'granted' ? 'granted' : perm.receive === 'denied' ? 'denied' : 'default');

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { setIsSubscribed(false); return; }
        const { data } = await supabase
          .from('push_subscriptions' as any)
          .select('id')
          .eq('user_id', user.id)
          .eq('platform', nativePlatform())
          .limit(1);
        const hasRow = !!(data && data.length > 0);
        setIsSubscribed(hasRow);

        // Auto-refresh/auto-heal : APNs peut faire tourner le token (réinstall,
        // restore), et la permission a pu être accordée AVANT le login (le token
        // n'avait alors pas pu être stocké). Permission accordée + utilisateur
        // connecté + pas d'opt-out explicite → on (re)stocke silencieusement.
        const optedOut = localStorage.getItem('yuno:push-opted-out') === 'true';
        if (perm.receive === 'granted' && (hasRow || !optedOut)) {
          try {
            await syncNativeTokenToDb(await registerNativePush());
            if (!hasRow) setIsSubscribed(true);
          } catch (e) {
            console.warn('[Push] Native token refresh failed:', e);
          }
        }
      } catch {
        setIsSubscribed(false);
      }
      return;
    }

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

    if (isNative()) {
      try {
        const { PushNotifications } = await import('@capacitor/push-notifications');
        const perm = await PushNotifications.requestPermissions();
        if (perm.receive !== 'granted') {
          setPermission('denied');
          throw new Error('Permission denied');
        }
        setPermission('granted');
        localStorage.removeItem('yuno:push-opted-out');
        await syncNativeTokenToDb(await registerNativePush());
        setIsSubscribed(true);
        window.dispatchEvent(new Event('pushSubscriptionChanged'));
      } catch (error) {
        console.error('[Push] Native subscribe error:', error);
        throw error;
      } finally {
        setIsLoading(false);
      }
      return;
    }

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

    if (isNative()) {
      try {
        localStorage.setItem('yuno:push-opted-out', 'true');
        await deleteNativeSubscription();
        const { PushNotifications } = await import('@capacitor/push-notifications');
        await PushNotifications.unregister().catch(() => {});
        setIsSubscribed(false);
        window.dispatchEvent(new Event('pushSubscriptionChanged'));
      } catch (error) {
        console.error('[Push] Native unsubscribe error:', error);
        throw error;
      } finally {
        setIsLoading(false);
      }
      return;
    }

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
