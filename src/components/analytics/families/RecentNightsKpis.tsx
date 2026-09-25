/**
 * « Tes 4 dernières soirées » : les quatre chiffres de Ventes › Vue d'ensemble
 * (CA, entrées, dépense par tête, clients), comparés aux quatre d'avant, en
 * tête des accueils club et organisateur. MÊME RPC et MÊMES formules que
 * Ventes : l'accueil ne calcule plus son propre « CA » (il y en avait deux,
 * avec deux formules, sur le même écran). Chaque tuile ouvre Ventes.
 */
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSalesOverview } from '@/hooks/useSalesOverview';
import { DeltaBadge, KpiRow, KpiTile } from '@/components/analytics/kit';
import { KIT, useKpiFormat } from '@/components/analytics/kitFormat';
import { pillarKpis } from '@/lib/salesOverview';

export function RecentNightsKpis({ venueId, organizerUserId, salesHref }: {
  venueId?: string | null;
  organizerUserId?: string | null;
  /** Ventes › Vue d'ensemble. */
  salesHref: string;
}) {
  const { t } = useLanguage();
  const fmt = useKpiFormat();
  const { data, loading } = useSalesOverview({ venueId, organizerUserId }, 'last4');

  if (loading && !data) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-busy="true">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[104px] animate-pulse rounded-2xl" style={{ background: KIT.TRACK }} />
        ))}
      </div>
    );
  }
  // Pas encore de soirée passée : le bloc des prochaines soirées suffit.
  if (!data || data.current.nights === 0) return null;

  const n = data.current.nights;
  const prevN = data.previous?.nights ?? 0;
  const vs = prevN > 0 ? (prevN === 1 ? t('so.vs1') : t('so.vs').replace('{n}', String(prevN))) : undefined;
  const title = n === 1 ? t('rn.titleOne') : t('rn.title').replace('{n}', String(n));

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
        <h2 style={{ color: KIT.T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em' }}>{title}</h2>
        <Link to={salesHref} className="inline-flex items-center gap-1 text-[12.5px] font-medium" style={{ color: KIT.T2 }}>
          {t('rn.seeSales')}<ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>
      <KpiRow>
        {pillarKpis(data, 'all').map((k) => (
          <Link key={k.key} to={salesHref} className="block min-w-0 rounded-2xl focus-visible:outline focus-visible:outline-2">
            <KpiTile
              label={t(k.labelKey)}
              hint={t(k.hintKey)}
              value={fmt(k.value, k.format)}
              delta={<DeltaBadge current={k.value} previous={k.previous} format={k.format} lowerIsBetter={k.lowerIsBetter} vs={vs} />}
            />
          </Link>
        ))}
      </KpiRow>
    </section>
  );
}
