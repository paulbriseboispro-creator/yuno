import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { isNative } from '@/lib/native';

/**
 * Attribution des clics de notifications push. Deux familles, deux paramètres :
 *
 *  • ?pc=<campaign_id>       — campagnes (manuelles + automatisations en fan-out)
 *                              → push_campaign_events (un clic par campagne/user).
 *  • ?an=<notification_key>  — push automatiques unitaires (achat, remboursement,
 *                              commande prête, rappels…) → auto_push_events,
 *                              agrégés par type dans /admin/notifications.
 *
 * Le clic web (service worker) et le tap natif (pushNotificationActionPerformed)
 * naviguent tous deux vers l'URL de la notification — ce composant, monté une
 * fois dans le Router, logge le clic (RLS : l'utilisateur n'insère que le sien)
 * puis nettoie le(s) paramètre(s) de l'URL.
 */
export function PushClickTracker() {
  const location = useLocation();
  const navigate = useNavigate();
  const logged = useRef(new Set<string>());

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const campaignId = params.get('pc');
    const autoKey = params.get('an');
    if (!campaignId && !autoKey) return;

    // Nettoyer l'URL immédiatement (le log part en arrière-plan).
    params.delete('pc');
    params.delete('an');
    const cleaned = location.pathname + (params.toString() ? `?${params.toString()}` : '') + location.hash;
    navigate(cleaned, { replace: true });

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;

      if (campaignId && !logged.current.has(`pc:${campaignId}`)) {
        logged.current.add(`pc:${campaignId}`);
        supabase
          .from('push_campaign_events' as never)
          .upsert(
            {
              campaign_id: campaignId,
              user_id: user.id,
              event_type: 'clicked',
              platform: isNative() ? 'ios' : 'web',
            } as never,
            { onConflict: 'campaign_id,user_id,event_type', ignoreDuplicates: true },
          )
          .then(({ error }) => {
            if (error) console.warn('[PushClickTracker] campaign log failed:', error.message);
          });
      }

      if (autoKey && !logged.current.has(`an:${autoKey}`)) {
        logged.current.add(`an:${autoKey}`);
        supabase
          .from('auto_push_events' as never)
          .insert({
            notification_key: autoKey,
            user_id: user.id,
            event_type: 'clicked',
            platform: isNative() ? 'ios' : 'web',
          } as never)
          .then(({ error }) => {
            if (error) console.warn('[PushClickTracker] auto log failed:', error.message);
          });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  return null;
}
