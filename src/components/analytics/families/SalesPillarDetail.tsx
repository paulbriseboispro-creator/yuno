/**
 * Le détail replié d'un pilier de Ventes (club et organisateur). Ce sont les
 * analyses fines d'avant la simplification (options prises, zones et
 * consommations des tables, service du bar, guest list par détenteur,
 * remboursements) : elles ne se chargent qu'à l'ouverture, parce qu'elles
 * passent encore par `useAnalyticsData` (des dizaines de requêtes).
 *
 * Elles lisent les ACHATS d'une fenêtre (30 derniers jours, ou depuis le
 * début pour « Cette année » / « Toutes les soirées ») : la légende le dit.
 */
import { useLanguage } from '@/contexts/LanguageContext';
import {
  useAnalyticsData, dateRangeToWindow, type DateRange,
  EMPTY_DRINK_ANALYTICS, EMPTY_TABLE_ANALYTICS, EMPTY_TICKET_ANALYTICS,
} from '@/hooks/useAnalyticsData';
import { AnalyticsLoading, EmptyAnswer } from '@/components/analytics/kit';
import { KIT } from '@/components/analytics/kitFormat';
import { TicketPillarInsights } from '@/components/analytics/TicketPillarInsights';
import { DrinkOpsInsights } from '@/components/analytics/DrinkOpsInsights';
import { VipTablesPillar } from '@/components/analytics/VipTablesPillar';
import { GuestListAnalyticsSection } from '@/components/analytics/GuestListAnalyticsSection';
import { RefundAnalyticsSection } from '@/components/analytics/RefundAnalyticsSection';
import type { SalesPeriod, SalesPillar } from '@/lib/salesOverview';

export function SalesPillarDetail({ venueId, organizerUserId, pillar, period, hasVipTables = true }: {
  venueId?: string | null;
  organizerUserId?: string | null;
  pillar: SalesPillar;
  period: SalesPeriod;
  hasVipTables?: boolean;
}) {
  const { t } = useLanguage();
  const isOrg = !!organizerUserId && !venueId;
  const dateRange: DateRange = period === 'year' || period === 'all' ? 'alltime' : '30days';
  const window = dateRangeToWindow(dateRange);
  // GuestList et les tables ont leur propre RPC : pas besoin du gros hook.
  const needsHook = pillar === 'all' || pillar === 'tickets' || pillar === 'bar' || pillar === 'tables';
  const { drinkAnalytics, ticketAnalytics, tableAnalytics, refundAnalytics, loading } = useAnalyticsData({
    venueId: isOrg ? null : venueId,
    organizerUserId: isOrg ? organizerUserId : null,
    scope: isOrg ? 'organizer' : 'venue',
    dateRange,
    mode: 'global',
    selectedEventId: null,
    enabled: needsHook,
  });

  const caption = (
    <p className="px-1" style={{ color: KIT.T3, fontSize: 12 }}>
      {t(dateRange === 'alltime' ? 'so.detail.windowAll' : 'so.detail.window30')}
    </p>
  );

  if (needsHook && loading) return <AnalyticsLoading rows={1} />;

  switch (pillar) {
    case 'all':
      return (
        <>
          {caption}
          {refundAnalytics && refundAnalytics.totalRefundCount > 0
            ? <RefundAnalyticsSection data={refundAnalytics} />
            : <EmptyAnswer title={t('so.detail.noRefunds')} />}
        </>
      );
    case 'tickets':
      return <>{caption}<TicketPillarInsights data={ticketAnalytics ?? EMPTY_TICKET_ANALYTICS} /></>;
    case 'bar':
      return <>{caption}<DrinkOpsInsights data={drinkAnalytics ?? EMPTY_DRINK_ANALYTICS} /></>;
    case 'tables':
      return (
        <>
          {caption}
          <VipTablesPillar
            venueId={isOrg ? null : venueId}
            organizerUserId={isOrg ? organizerUserId : null}
            from={window.from}
            to={window.to}
            tableAnalytics={tableAnalytics ?? EMPTY_TABLE_ANALYTICS}
            hasVipTables={hasVipTables}
          />
        </>
      );
    case 'guestList':
      return (
        <>
          {caption}
          <GuestListAnalyticsSection
            venueId={isOrg ? null : venueId}
            organizerUserId={isOrg ? organizerUserId : null}
            from={window.from}
            to={window.to}
          />
        </>
      );
  }
}
