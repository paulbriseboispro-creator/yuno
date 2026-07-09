import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { isNative } from '@/lib/native';

/**
 * Attribution des clics de campagnes push. Les notifications de campagne
 * portent ?pc=<campaign_id> dans leur URL ; le clic web (service worker) et le
 * tap natif (pushNotificationActionPerformed) naviguent tous deux vers cette
 * URL — ce composant, monté une fois dans le Router, logge le clic dans
 * push_campaign_events (RLS : l'utilisateur n'insère que son propre clic)
 * puis nettoie le paramètre de l'URL. Un seul clic compté par (campagne, user).
 */
export function PushClickTracker() {
  const location = useLocation();
  const navigate = useNavigate();
  const logged = useRef(new Set<string>());

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const campaignId = params.get('pc');
    if (!campaignId) return;

    // Nettoyer l'URL immédiatement (le log part en arrière-plan).
    params.delete('pc');
    const cleaned = location.pathname + (params.toString() ? `?${params.toString()}` : '') + location.hash;
    navigate(cleaned, { replace: true });

    if (logged.current.has(campaignId)) return;
    logged.current.add(campaignId);

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
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
          if (error) console.warn('[PushClickTracker] log failed:', error.message);
        });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  return null;
}
