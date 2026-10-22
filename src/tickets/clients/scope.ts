/**
 * La portée des écrans Clients, Segments, Imports de Yuno Tickets : celle des
 * Analyses (src/tickets/analytics/scope.ts), le club ou l'organisation de la
 * Console. Le droit d'écrire suit les rôles qui écrivent déjà dans la Console
 * (club : propriétaire, manager ; organisation : fondateur, admin, éditeur) ;
 * le serveur le revérifie (`_tix_writable`).
 */
import { useActingOrganizer } from '@/hooks/useActingOrganizer';
import { useDashboardMode } from '@/contexts/DashboardModeContext';
import { useTixNights, useTixScope } from '@/tickets/analytics/scope';

export { useTixScope };

/**
 * `send` : la Console a des campagnes (Club, Organisateur) ; la Console
 * Manager n'en a pas, « Écrire à… » n'y est donc pas proposé.
 */
export function useTixCaps(): { money: boolean; write: boolean; send: boolean } {
  const nights = useTixNights();
  const { mode } = useDashboardMode();
  const org = useActingOrganizer({ enabled: mode === 'organizer' });
  const role = mode === 'organizer' ? org.role : null;
  const write = mode !== 'organizer' || role === 'owner' || role === 'admin' || role === 'editor';
  return { money: nights.data?.money ?? true, write, send: write && mode !== 'manager' };
}
