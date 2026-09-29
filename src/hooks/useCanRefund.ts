import { useContext } from 'react';
import { useDashboardMode } from '@/contexts/DashboardModeContext';
import { ManagerVenueContext } from '@/contexts/ManagerVenueContext';
import { useActingOrganizer } from '@/hooks/useActingOrganizer';

/**
 * L'appelant peut-il rembourser depuis ce tableau de bord ? Miroir de ce que
 * owner-refund accorde (`refundAllowed`, supabase/functions/_shared/sale-refund.ts) :
 * - club : le propriétaire, ou un manager à qui il a donné « Remboursements » ;
 * - organisateur : le fondateur, ou un membre d'équipe autorisé (admin, ou droit
 *   « Effectuer des remboursements »).
 * Un bouton qui mène à un refus serveur est pire que pas de bouton.
 */
export function useCanRefund(): boolean {
  const { mode } = useDashboardMode();
  const managerContext = useContext(ManagerVenueContext);
  const acting = useActingOrganizer({ enabled: mode === 'organizer' });
  if (mode === 'manager') return !!managerContext?.permissions.canManageRefunds;
  if (mode === 'organizer') return acting.can.refund;
  return mode === 'owner';
}
