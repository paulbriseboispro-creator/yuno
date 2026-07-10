import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

// Rail « Pour toi » (Explore) : ids d'events classés par la RPC
// get_for_you_events (embeddings pgvector, vecteur de goût = achats +
// favoris + venues suivies). Retourne un tableau vide si non connecté,
// opt-out personnalisation, ou pas assez de signal — le front masque
// alors la section (cold-start propre).
export function useForYouEvents(limit = 12) {
  const [ids, setIds] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || cancelled) return;
      // RPC pas encore dans les types générés (regen après db push).
      const { data, error } = await supabase.rpc('get_for_you_events' as never, { p_limit: limit } as never);
      if (cancelled || error || !Array.isArray(data)) return;
      setIds((data as { event_id: string }[]).map((r) => r.event_id));
    })();
    return () => { cancelled = true; };
  }, [limit]);

  return ids;
}
