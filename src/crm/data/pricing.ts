/**
 * La grille de Yuno CRM pour la page Tarifs (/crm/tarifs) : `crm_pricing_config`,
 * ouverte aux visiteurs (aucune donnée de compte). Une seule source pour les
 * prix affichés : la base, que le checkout et le serveur lisent aussi.
 */
import { useQuery } from '@tanstack/react-query';
import { rpc } from '@/crm/lib/rpc';
import { pricesForTier } from '@/crm/lib/pricing';
import type { CrmPricingConfig } from '@/crm/lib/pricing';

export function usePricingConfig() {
  return useQuery({
    queryKey: ['crm', 'public', 'pricing'],
    // Le niveau (seuil des 50 comptes) décide du prix montré ; s'il ne se lit
    // pas, on montre le lancement (le checkout facture le lancement en repli).
    queryFn: async () => {
      const [cfg, tier] = await Promise.all([
        rpc<CrmPricingConfig>('crm_pricing_config'),
        rpc<string>('crm_price_tier').catch(() => 'launch'),
      ]);
      return pricesForTier(cfg, tier === 'public' ? 'public' : 'launch');
    },
    staleTime: 10 * 60_000,
  });
}
