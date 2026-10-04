/**
 * La grille de Yuno CRM pour la page Tarifs (/crm/tarifs) : `crm_pricing_config`,
 * ouverte aux visiteurs (aucune donnée de compte). Une seule source pour les
 * prix affichés : la base, que le checkout et le serveur lisent aussi.
 */
import { useQuery } from '@tanstack/react-query';
import { rpc } from '@/crm/lib/rpc';
import type { CrmPricingConfig } from '@/crm/lib/pricing';

export function usePricingConfig() {
  return useQuery({
    queryKey: ['crm', 'public', 'pricing'],
    queryFn: () => rpc<CrmPricingConfig>('crm_pricing_config'),
    staleTime: 10 * 60_000,
  });
}
