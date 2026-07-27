import { createContext, useContext } from 'react';
import type { FeedConfig } from '@/lib/notifications';

export type AffiliateRole = 'admin' | 'manager' | 'member';

/**
 * Identité résolue une seule fois par AffiliateLayout et partagée avec le
 * header (cloche), la boîte de réception et toute page qui a besoin de savoir
 * qui regarde : le chef d'agence (admin), un manager ou un promoteur (member).
 */
export interface AffiliateShell {
  role: AffiliateRole;
  /** id de la ligne `affiliates` (admin) ou affiliate_id du membre. */
  affiliateId: string | null;
  /** id de la ligne `affiliate_members` (manager/member), null pour l'admin. */
  memberId: string | null;
  feedConfig: FeedConfig | null;
}

const AffiliateShellContext = createContext<AffiliateShell | null>(null);

export const AffiliateShellProvider = AffiliateShellContext.Provider;

export function useAffiliateShell(): AffiliateShell | null {
  return useContext(AffiliateShellContext);
}
