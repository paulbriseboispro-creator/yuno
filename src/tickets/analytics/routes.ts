/**
 * Les adresses des Analyses de Yuno Tickets et des écrans de la Console vers
 * lesquels elles renvoient. Une seule implémentation pour la Console Club
 * (`/owner`), Manager (`/manager`) et Organisateur (`/organizer-app`) : tout
 * part du préfixe de la Console (`useDashboardMode().basePath`).
 */
import { useMemo } from 'react';
import { useDashboardMode } from '@/contexts/DashboardModeContext';

export const TIX_ANA_SEGMENT = 'analyses';

export function tixRoutes(base: string) {
  const a = `${base}/${TIX_ANA_SEGMENT}`;
  return {
    sales: `${a}/sales`,
    traffic: `${a}/traffic`,
    community: `${a}/community`,
    guestlist: `${a}/guestlist`,
    journey: `${a}/journey`,
    /** Analyses › Guest list d'une soirée. */
    nightGuestList: (id: string) => `${a}/guestlist?e=${id}`,
    clients: `${base}/customers`,
    campaigns: `${base}/campaigns`,
    campaignNew: `${base}/campaigns/new`,
    campaignNewForEvent: (eventId: string) => `${base}/campaigns/new?event=${eventId}`,
    campaignReport: (id: string) => `${base}/campaigns/${id}/report`,
    campaignEdit: (id: string) => `${base}/campaigns/${id}/edit`,
    automations: `${base}/campaigns/automations`,
    guestListPage: (eventId: string) => `${base}/guest-list?event=${eventId}`,
  };
}

export type TixRoutes = ReturnType<typeof tixRoutes>;

export function useTixRoutes(): TixRoutes {
  const { basePath } = useDashboardMode();
  return useMemo(() => tixRoutes(basePath), [basePath]);
}
