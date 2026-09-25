/**
 * Bande de ventes d'une carte soirée (page Événements, club et organisateur).
 * Ce que Shotgun met sur chaque ligne de sa liste — J-N, CA total et du jour,
 * remplissage — étendu aux trois piliers Yuno. Rien à montrer (aucun pilier
 * ouvert, aucune vente, aucune visite) : la bande se tait.
 */
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { KIT } from '@/components/analytics/kitFormat';
import { pillarLines, showsRevenue, type EventSales } from '@/lib/eventsSales';
import { CountdownTile, EventMetricsGrid } from './EventSalesParts';

export function EventSalesStrip({ ev, statsHref }: { ev: EventSales; statsHref: string | null }) {
  const { t } = useLanguage();
  const lines = pillarLines(ev);
  const withRevenue = showsRevenue(ev);
  if (lines.length === 0 && !withRevenue && ev.visits.total === 0) return null;

  return (
    <div className="px-5 pb-3">
      <div
        className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl px-3.5 py-3 md:flex-nowrap"
        style={{ background: 'rgb(var(--ink)/0.03)', border: `1px solid ${KIT.BORDER}` }}
      >
        <CountdownTile ev={ev} size="sm" />
        {/* Mobile : compte à rebours + lien sur une ligne, chiffres en pleine
            largeur dessous. Desktop : tout sur une ligne. */}
        <EventMetricsGrid ev={ev} className="order-3 min-w-0 basis-full md:order-2 md:basis-0 md:flex-1" />
        {statsHref && (
          <Link
            to={statsHref}
            className="order-2 ml-auto inline-flex items-center gap-1 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[11.5px] font-semibold transition-colors md:order-3"
            style={{ color: KIT.T2, border: `1px solid ${KIT.BORDER}` }}
          >
            {t('evs.seeStats')}
            <ArrowRight className="h-3 w-3" aria-hidden />
          </Link>
        )}
      </div>
    </div>
  );
}
