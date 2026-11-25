import { useEffect, useId, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Service VIP fiable (P4.8) : relit la liste dès qu'une réservation de table change
 * (Realtime) et au retour au premier plan de l'onglet. Le canal est nommé par
 * instance (`useId`) : deux composants montés sur la même page ne partagent jamais
 * un canal déjà abonné. Les rafales sont regroupées (700 ms).
 */
export function useVipLiveRefresh(enabled: boolean, refresh: () => void, scopeKey: string) {
  const id = useId();
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => refreshRef.current(), 700);
    };
    const channel = supabase
      .channel(`vip-service-${scopeKey}-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'table_reservations' }, schedule)
      .subscribe();
    const onVisible = () => { if (document.visibilityState === 'visible') schedule(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', schedule);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', schedule);
      void supabase.removeChannel(channel);
    };
  }, [enabled, scopeKey, id]);
}
