import { useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { isNative } from '@/lib/native';
import { claimPushToken, ensurePushTokenRegistered } from '@/lib/pushToken';

/**
 * Gardien du token push — monté une fois dans le Router, ne rend rien.
 * Web : no-op. Natif : tant qu'un compte est connecté, sa ligne
 * push_subscriptions existe et pointe sur le token APNs COURANT :
 *  - au montage et à chaque changement de compte (connexion, switch) ;
 *  - à chaque retour au premier plan (l'app est restée des jours en fond,
 *    APNs a pu tourner le token, un autre compte a pu passer par là) ;
 *  - à chaque événement `registration` (rotation poussée par le système).
 * Voir src/lib/pushToken.ts pour la logique (idempotente, bornée à 12 h).
 */
export function PushTokenKeeper() {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!isNative() || !userId) return;
    let alive = true;
    const cleanups: Array<() => void> = [];

    void ensurePushTokenRegistered(userId);

    import('@capacitor/app').then(({ App }) => {
      const sub = App.addListener('appStateChange', ({ isActive }) => {
        if (isActive && alive) void ensurePushTokenRegistered(userId);
      });
      cleanups.push(() => { sub.then((s) => s.remove()).catch(() => {}); });
    }).catch(() => {});

    import('@capacitor/push-notifications').then(({ PushNotifications }) => {
      const sub = PushNotifications.addListener('registration', (token) => {
        if (alive) void claimPushToken(userId, token.value);
      });
      cleanups.push(() => { sub.then((s) => s.remove()).catch(() => {}); });
    }).catch(() => {});

    return () => {
      alive = false;
      cleanups.forEach((fn) => fn());
    };
  }, [userId]);

  return null;
}
