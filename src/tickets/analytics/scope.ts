/**
 * La portée des Analyses de Yuno Tickets : le club (Console Club, Console
 * Manager) ou l'organisation (Console Organisateur) — `useVenueContext`, la
 * porte unique de la Console, jamais `useAuth().user.id`.
 */
import { useQuery } from '@tanstack/react-query';
import { useDashboardMode } from '@/contexts/DashboardModeContext';
import { useVenueContext } from '@/hooks/useVenueContext';
import { rpc } from '@/crm/lib/rpc';
import type { TixNights } from './data';

export interface TixScope {
  rpc: { p_venue_id: string | null; p_organizer_user_id: string | null };
  qk: string;
  ready: boolean;
  base: string;
}

export function useTixScope(): TixScope {
  const { basePath } = useDashboardMode();
  const v = useVenueContext();
  const venue = v.scope === 'organizer' ? null : (v.venueId ?? null);
  const org = v.scope === 'organizer' ? (v.organizerUserId ?? null) : null;
  return {
    rpc: { p_venue_id: venue, p_organizer_user_id: org },
    qk: venue ? `v:${venue}` : org ? `o:${org}` : 'none',
    ready: !v.loading && !!(venue || org),
    base: basePath,
  };
}

/** Les soirées de la portée (sélecteur « Soirée ») et l'accès à l'argent. */
export function useTixNights() {
  const s = useTixScope();
  return useQuery({
    queryKey: ['tix-ana', s.qk, 'nights'],
    queryFn: () => rpc<TixNights>('tix_ana_nights', s.rpc),
    enabled: s.ready,
    staleTime: 60_000,
  });
}

/**
 * Ce que la personne peut faire : voir les montants (le serveur les rend déjà à
 * null sans l'accès, `_tix_money_gate`) et préparer une campagne (la page
 * Campagnes garde sa propre porte).
 */
export function useTixCaps(): { money: boolean; write: boolean } {
  const nights = useTixNights();
  return { money: nights.data?.money ?? true, write: true };
}
