/**
 * Les adresses des écrans Clients, Segments, Imports de Yuno Tickets et des
 * écrans de la Console vers lesquels ils renvoient. Une seule implémentation
 * pour la Console Club (`/owner`), Manager (`/manager`) et Organisateur
 * (`/organizer-app`) : tout part du préfixe de la Console.
 *
 * Les écrans copiés du CRM écrivent `TIX_ROUTES.clients` comme le CRM écrivait
 * `CRM_ROUTES.clients` : `useTixClientRoutes()` rend l'objet de la Console en
 * cours, sous ce nom.
 */
import { useMemo } from 'react';
import { useDashboardMode } from '@/contexts/DashboardModeContext';

export const TIX_CLIENTS_SEGMENT = 'clients';

export function tixClientRoutes(base: string) {
  const c = `${base}/${TIX_CLIENTS_SEGMENT}`;
  return {
    clients: c,
    segments: `${c}/segments`,
    imports: `${c}/imports`,
    /** Les campagnes de la Console (e-mail, SMS, push). */
    campaigns: `${base}/campaigns`,
    campaignEdit: (id: string) => `${base}/campaigns/${id}/edit`,
    campaignReport: (id: string) => `${base}/campaigns/${id}/report`,
    sms: base === '/organizer-app' ? `${base}/sms` : `${base}/sms-campaigns`,
    push: `${base}/push`,
    /** La base de contacts (ancienne page) : imports d'avant cet écran. */
    contacts: `${base}/campaigns/contacts`,
    analyses: `${base}/analyses/sales`,
  };
}

export type TixClientRoutes = ReturnType<typeof tixClientRoutes>;

export function useTixClientRoutes(): TixClientRoutes {
  const { basePath } = useDashboardMode();
  return useMemo(() => tixClientRoutes(basePath), [basePath]);
}
