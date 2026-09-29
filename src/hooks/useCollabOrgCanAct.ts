import { useActingOrganizer } from '@/hooks/useActingOrganizer';

/**
 * Peut-on AGIR sur le contrat collab côté organisateur (proposer, signer,
 * avenants, pause / suppression, décompte, réception d'un virement) ?
 * Miroir exact de `collab_org_can_act()` (SQL, migration 20260929180000) : le
 * fondateur ou un ADMIN d'équipe. Un éditeur voit la collaboration, jamais un
 * bouton que le serveur refuserait. Côté club : toujours vrai (le club a ses
 * propres gardes, owner / manager).
 */
export function useCollabOrgCanAct(side: 'venue' | 'organizer' | null | undefined): boolean {
  const { role, loading } = useActingOrganizer({ enabled: side === 'organizer' });
  if (side !== 'organizer') return true;
  return !loading && (role === 'owner' || role === 'admin');
}
