// Accueil de la Console selon le produit du compte : l'accueil de la Suite, ou
// celui de Yuno CRM (billetterie connectée). Le produit se lit sur le compte
// (venues.product / organizer_profiles.product), jamais sur l'hôte.

import type { ReactNode } from 'react';
import { Suspense } from 'react';
import { lazyWithRetry } from '@/lib/lazyWithRetry';
import { useAccountProduct } from '@/lib/crmProduct';
import { AnalyticsLoading } from '@/components/analytics/kit';

const CrmHome = lazyWithRetry(() => import('@/pages/crm/CrmHome'));

export function ProductHome({ suite }: { suite: ReactNode }) {
  const { isCrm, loading } = useAccountProduct();
  if (loading) return <div className="p-6"><AnalyticsLoading rows={3} /></div>;
  if (!isCrm) return <>{suite}</>;
  return (
    <Suspense fallback={<div className="p-6"><AnalyticsLoading rows={3} /></div>}>
      <CrmHome />
    </Suspense>
  );
}
