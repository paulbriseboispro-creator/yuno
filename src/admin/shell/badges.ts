/**
 * Compteurs de la barre latérale (`badge` d'une entrée de src/admin/nav.ts).
 * Une clé nouvelle = un type `NavBadgeKey` + sa lecture ici, légère (un
 * `count` en tête, jamais une liste), relue toutes les 2 minutes.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { NavBadgeKey } from '../nav';
import { useTodayUrgentCount } from '../today/data';

export function useNavBadges(): Partial<Record<NavBadgeKey, number>> {
  const alerts = useQuery({
    queryKey: ['admin', 'nav-badge', 'alertsUnread'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('admin_notifications')
        .select('id', { count: 'exact', head: true })
        .is('read_at', null);
      if (error) return 0;
      return count ?? 0;
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
  // Rubrique « Aujourd'hui » : lignes urgentes de la file, pas encore traitées.
  const todayUrgent = useTodayUrgentCount();
  return { alertsUnread: alerts.data ?? 0, todayUrgent };
}
