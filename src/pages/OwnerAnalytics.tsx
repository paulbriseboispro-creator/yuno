import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Link, useLocation } from 'react-router-dom';
import {
  Lock as LockIcon, CreditCard, MousePointerClick, TrendingUp, Activity, Megaphone, Target, Crown,
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { subMinutes } from 'date-fns';
import { useState, useEffect } from 'react';
import { OwnerHeader } from '@/components/OwnerHeader';
import { OwnerPageSkeleton } from '@/components/DashboardSkeleton';
import { useVenueContext } from '@/hooks/useVenueContext';
import { useSubscriptionPlan } from '@/hooks/useSubscriptionPlan';
import {
  useAnalyticsData, type AnalyticsMode, type DateRange, dateRangeToWindow,
  EMPTY_DRINK_ANALYTICS, EMPTY_TICKET_ANALYTICS, EMPTY_TABLE_ANALYTICS } from '@/hooks/useAnalyticsData';
import { usePromoterAnalytics } from '@/hooks/usePromoterAnalytics';
import { useCustomerAnalytics } from '@/hooks/useCustomerAnalytics';
import { AnalyticsEssentialView } from '@/components/analytics/AnalyticsEssentialView';
import { EventPostAnalysisView } from '@/components/owner/co-event/EventPostAnalysisView';
import { EventAnalyticsPicker } from '@/components/analytics/EventAnalyticsPicker';
import { AcquisitionDashboard } from '@/components/analytics/AcquisitionDashboard';
import { BehaviorAnalytics } from '@/components/analytics/BehaviorAnalytics';
import { EventAudienceDemographics } from '@/components/analytics/EventAudienceDemographics';
import { useAnalyticsRoute } from '@/hooks/useAnalyticsRoute';
import { eventReportHref } from '@/lib/analyticsNav';
import { AnalyticsFamilyNav } from '@/components/analytics/families/AnalyticsFamilyNav';
import { AnalyticsLoading } from '@/components/analytics/kit';
import { useNumberFormat } from '@/components/analytics/kitFormat';
import { CommunityOverviewView } from '@/components/analytics/families/CommunityOverviewView';
import { CommunityTastesView } from '@/components/analytics/families/CommunityTastesView';
import { TrafficView } from '@/components/analytics/families/TrafficView';
import { AudienceDashboard } from '@/components/audience/AudienceDashboard';
import { HypeEventForecast } from '@/components/hype/HypeEventForecast';
import { EmptyNote, ReportCard } from '@/components/event-report/ui';
import { useEventParam } from '@/hooks/useEventParam';
import { EventReportView } from '@/components/event-report/EventReportView';
import { LiveView } from '@/components/live-view/LiveView';
import { PurchaseBehaviorView } from '@/components/analytics/PurchaseBehaviorView';
import { SalesOverviewView } from '@/components/analytics/families/SalesOverviewView';
import { SalesPillarDetail } from '@/components/analytics/families/SalesPillarDetail';

// ─── Design tokens ────────────────────────────────────────────────────────────
const RED = '#E8192C';
const POS = 'var(--acc-34d399)';
const T1 = 'rgb(var(--ink)/var(--ink-a96,0.96))';
const T2 = 'rgb(var(--ink)/var(--ink-a58,0.58))';
const T3 = 'rgb(var(--ink)/var(--ink-a36,0.36))';
const C_HI = 'rgb(var(--ink)/var(--ink-a92,0.92))';
const C_MID = 'rgb(var(--ink)/var(--ink-a40,0.40))';
const C_FAINT = 'rgb(var(--ink)/0.06)';
const BORDER = 'rgb(var(--ink)/0.085)';
const CARD_BG = 'linear-gradient(180deg,rgb(var(--sheen)/.045) 0%,rgb(var(--sheen)/.008) 100%),var(--sf-0a0a0c)';
const CARD_SHADOW = '0 1px 0 rgb(var(--sheen)/.05) inset,0 18px 40px -28px rgb(0 0 0/calc(.9*var(--pro-shadow-a)))';

// ─── Premium card wrapper ─────────────────────────────────────────────────────
function PCard({
  children, className = '', style = {},
  icon, title, sub, right,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  icon?: React.ReactNode;
  title?: string;
  sub?: string;
  right?: React.ReactNode;
}) {
  return (
    <div
      className={`overflow-hidden relative ${className}`}
      style={{
        background: CARD_BG,
        border: `1px solid ${BORDER}`,
        borderRadius: 18,
        boxShadow: CARD_SHADOW,
        padding: 22,
        ...style,
      }}
    >
      {(title || icon) && (
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            {icon && (
              <div
                className="w-8 h-8 flex items-center justify-center rounded-xl flex-none"
                style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T2 }}
              >
                {icon}
              </div>
            )}
            <div>
              {title && <h3 className="m-0 text-[15.5px] font-semibold leading-tight" style={{ color: T1, letterSpacing: '-0.01em' }}>{title}</h3>}
              {sub && <p className="m-0 mt-0.5 text-xs" style={{ color: T3 }}>{sub}</p>}
            </div>
          </div>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

// ─── Zone heading (IA section separator) ──────────────────────────────────────
function ZoneHeading({ icon, label, id }: { icon: React.ReactNode; label: string; id?: string }) {
  return (
    <div id={id} className="flex items-center gap-2 px-1" style={id ? { scrollMarginTop: 84 } : undefined}>
      <span style={{ color: T2 }}>{icon}</span>
      <h3 className="text-[13px] font-semibold uppercase tracking-[0.08em]" style={{ color: T2 }}>{label}</h3>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function OwnerAnalytics() {
  const { t, language } = useLanguage();
  const { venueId } = useVenueContext();
  const { hasFeature } = useSubscriptionPlan();
  const hasAdvancedAnalytics = hasFeature('analytics_advanced');
  const hasExport = hasFeature('exports_csv');
  const hasVipTables = hasFeature('vip_tables');

  const [dateRange, setDateRange] = useState<DateRange>('7days');
  // `live` = la vue en direct (globe + flux) et `purchase` = le comportement
  // d'achat : des onglets de la page, pas des modes de données — les hooks
  // d'analytics restent sur « global » pendant qu'ils tournent.
  // Analytics en quatre familles (Ventes · Trafic · Communauté · En direct),
  // chacune rangée en vues ; tout vit dans l'URL (`?tab=&view=&event=`), les
  // anciens onglets (`global`, `event`, `purchase`) y sont traduits.
  const { family, view, go } = useAnalyticsRoute();
  const { eur: eurFmt } = useNumberFormat();
  const mode: AnalyticsMode = family === 'sales' && view === 'event' ? 'event' : 'global';
  const isLive = family === 'live';
  const isPurchase = family === 'community' && view === 'purchase';
  const analyticsBase = useLocation().pathname.replace(/\/$/, '');
  const consolePrefix = analyticsBase.replace(/\/analytics$/, '');
  const eventHref = (id: string) => eventReportHref(analyticsBase, id);
  // La soirée choisie vit dans l'URL (`?event=`) : un lien depuis la liste des
  // soirées ou le tableau de bord ouvre directement son analyse.
  const [selectedEventId, setSelectedEventId] = useEventParam();
  const [liveVisitors, setLiveVisitors] = useState(0);

  // Web-traffic zones (acquisition / engagement) share the page's main period
  // selector — one period control for the whole page, no separate hub filter.
  const webWindow = dateRangeToWindow(dateRange);


  // Chaque jeu de chiffres ne se charge que sur les vues qui le lisent :
  // Trafic, Communauté ou En direct n'attendent plus ~70 requêtes de Ventes.
  // Seul le plan Essentiel lit encore ce gros jeu de chiffres ; Ventes passe
  // par `get_sales_overview` et le détail replié charge le sien à l'ouverture.
  const needsSales = !hasAdvancedAnalytics;
  const {
    drinkAnalytics: drinkRaw, ticketAnalytics: ticketRaw, tableAnalytics: tableRaw, refundAnalytics, loading,
  } = useAnalyticsData({
    venueId, dateRange, mode, selectedEventId, enabled: needsSales,
  });
  const salesPending = needsSales && (loading || !drinkRaw || !ticketRaw || !tableRaw);
  const drinkAnalytics = drinkRaw ?? EMPTY_DRINK_ANALYTICS;
  const ticketAnalytics = ticketRaw ?? EMPTY_TICKET_ANALYTICS;
  const tableAnalytics = tableRaw ?? EMPTY_TABLE_ANALYTICS;
  const { promoterAnalytics, loading: promoterLoading } = usePromoterAnalytics({
    venueId, dateRange, mode, selectedEventId, enabled: family === 'sales' && view === 'partners',
  });
  const { customerAnalytics } = useCustomerAnalytics({ venueId, enabled: family === 'community' && view === 'overview' });

  useEffect(() => {
    if (!venueId) return;
    const fetchLive = async () => {
      const fiveMinutesAgo = subMinutes(new Date(), 5);
      const { data: liveData } = await supabase.from('visitor_sessions').select('id').eq('venue_id', venueId).gte('visited_at', fiveMinutesAgo.toISOString());
      setLiveVisitors(liveData?.length || 0);
    };
    fetchLive();
    const interval = setInterval(fetchLive, 10000);
    const channel = supabase
      .channel(`visitor_sessions_changes_${venueId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'visitor_sessions', filter: `venue_id=eq.${venueId}` }, () => fetchLive())
      .subscribe();
    return () => { clearInterval(interval); supabase.removeChannel(channel); };
  }, [venueId]);

  // ── Loading ──────────────────────────────────────────────────────────────────
  // Le plan Essentiel n'affiche que les ventes : il attend donc ses chiffres.
  // Les autres vues se rendent tout de suite ; Ventes montre son squelette
  // dans la page, sous la navigation.
  if (!hasAdvancedAnalytics && salesPending) return <OwnerPageSkeleton />;

  // ── Essential plan ───────────────────────────────────────────────────────────
  if (!hasAdvancedAnalytics) {
    return (
      <div className="min-h-screen pb-24" style={{ background: 'var(--sf-000000)' }}>
        <OwnerHeader
          title={t('owner.analytics')}
          rightContent={
            <div className="flex items-center gap-2 px-3 py-2 rounded-full"
              style={{ background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)' }}>
              <div className="h-2 w-2 rounded-full animate-pulse" style={{ background: POS }} />
              <span className="text-sm font-semibold" style={{ color: POS }}>
                {liveVisitors} <span className="font-normal opacity-70 hidden xs:inline">{t('owner.online')}</span>
              </span>
            </div>
          }
        />
        <div className="mx-auto max-w-7xl p-4 sm:p-6 space-y-6">
          <div className="flex gap-2 flex-wrap p-1.5 rounded-xl" style={{ background: 'rgb(var(--ink)/0.025)', border: `1px solid ${BORDER}` }}>
            {(['24h', '48h', '72h', '7days', '30days', 'alltime'] as DateRange[]).map(range => (
              <Button key={range} variant="ghost" onClick={() => setDateRange(range)} size="sm"
                className="text-xs h-8 rounded-lg transition-all duration-150 cursor-pointer"
                style={dateRange === range
                  ? { background: RED, color: '#fff', boxShadow: `0 0 15px -3px ${RED}55` }
                  : { color: T3 }}>
                {range === '7days' ? `7 ${t('owner.days')}` : range === '30days' ? `30 ${t('owner.days')}` : range === 'alltime' ? t('owner.allTime') : t(`owner.${range}`)}
              </Button>
            ))}
          </div>
          <AnalyticsEssentialView drinkAnalytics={drinkAnalytics} ticketAnalytics={ticketAnalytics} tableAnalytics={tableAnalytics} refundAnalytics={refundAnalytics} />
          <PCard>
            <div className="text-center py-2">
              <LockIcon className="h-8 w-8 mx-auto mb-3" style={{ color: RED }} />
              <p className="font-semibold mb-1" style={{ color: T1 }}>{t('analytics.advancedAvailable')}</p>
              <p className="text-sm mb-4" style={{ color: T3 }}>{t('analytics.advancedDesc')}</p>
              <Button asChild style={{ background: RED, color: '#fff' }}>
                <Link to="/owner/billing">{t('plan.upgradeTo')} Pro</Link>
              </Button>
            </div>
          </PCard>
        </div>
      </div>
    );
  }

  // ── Pro / Elite ──────────────────────────────────────────────────────────────

  // Montants au format de la langue : « 321 € » / « 3,1 k€ » en français,
  // « €321 » / « €3.1K » en anglais — jamais un « €321 » figé.
  const fmt = (n: number) => new Intl.NumberFormat(
    language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-GB',
    { style: 'currency', currency: 'EUR', notation: Math.abs(n) >= 10000 ? 'compact' : 'standard', maximumFractionDigits: Math.abs(n) >= 10000 ? 1 : 0 },
  ).format(n);

  // Période des vues qui lisent encore une fenêtre d'achats (Sources, Achats, Public).
  const periodOptions = [
    { key: '24h' as DateRange, label: '24h' },
    { key: '48h' as DateRange, label: '48h' },
    { key: '72h' as DateRange, label: '72h' },
    { key: '7days' as DateRange, label: `7 ${t('owner.days')}` },
    { key: '30days' as DateRange, label: `30 ${t('owner.days')}` },
    { key: 'alltime' as DateRange, label: t('owner.allTime') },
  ];

  // Event mode with no night chosen yet → show the calendar-style card picker.
  const showEventPicker = mode === 'event' && !selectedEventId;
  const hasPromoter = !!promoterAnalytics && promoterAnalytics.promoters.length > 0;

  // ── Zones rangées hors de Ventes › Vue d'ensemble (lot E) ────────────────
  const promoterZone = (<>
        {/* ── Promoter ROI ───────────────────────────────────────────────── */}
        {promoterAnalytics && promoterAnalytics.promoters.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.24 }} className="space-y-3">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { label: t('owner.an.attributedRevenue'), val: fmt(promoterAnalytics.totalAttributed), sub: `${promoterAnalytics.totalConversions} ${t('owner.an.conversions')}`, icon: <TrendingUp className="w-4 h-4" />, tone: T1 },
                { label: t('owner.an.commissions'), val: `−${fmt(promoterAnalytics.totalCommission)}`, sub: t('owner.an.owedToPromoters'), icon: <CreditCard className="w-4 h-4" />, tone: T1 },
                { label: t('owner.an.clickToSale'), val: `${promoterAnalytics.convRate.toFixed(0)}%`, sub: `${promoterAnalytics.totalClicks} ${t('owner.an.clicks')}`, icon: <MousePointerClick className="w-4 h-4" />, tone: T1 },
                { label: t('owner.an.promoterRoiShort'), val: promoterAnalytics.totalCommission > 0 ? `${promoterAnalytics.roi.toFixed(1)}x` : '—', sub: t('owner.an.revenuePerEuro'), icon: <Target className="w-4 h-4" />, tone: promoterAnalytics.roi >= 1 ? POS : T1 },
              ].map((tile, i) => (
                <PCard key={i}>
                  <div className="flex flex-col min-h-[104px]">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: T3 }}>{tile.label}</span>
                      <span style={{ color: T3 }}>{tile.icon}</span>
                    </div>
                    <div className="mt-2 text-[clamp(22px,2.6vw,30px)] font-[640] leading-none tabular-nums" style={{ color: tile.tone, letterSpacing: '-0.025em' }}>{tile.val}</div>
                    <div className="mt-auto pt-2 text-[11.5px]" style={{ color: T3 }}>{tile.sub}</div>
                  </div>
                </PCard>
              ))}
            </div>
            <PCard icon={<Megaphone className="w-4 h-4" />} title={t('owner.an.topPromoters')} sub={t('owner.an.byAttributedRevenue')}>
              <div className="divide-y" style={{ borderColor: BORDER }}>
                {promoterAnalytics.promoters.slice(0, 8).map((p, i) => {
                  const maxRev = promoterAnalytics.promoters[0]?.revenue || 1;
                  const barPct = maxRev > 0 ? (p.revenue / maxRev) * 100 : 0;
                  return (
                    <div key={p.id} className="grid items-center gap-4 py-3" style={{ gridTemplateColumns: '20px 1fr auto' }}>
                      <span className="text-[12.5px] tabular-nums" style={{ color: T3 }}>{String(i + 1).padStart(2, '0')}</span>
                      <div className="min-w-0">
                        <div className="text-sm font-[560] truncate" style={{ color: T1, letterSpacing: '-0.01em' }}>{p.name}</div>
                        <div className="text-[11.5px] mt-1" style={{ color: T3 }}>
                          {p.conversions} {t('owner.an.conversions')} · {p.clicks} {t('owner.an.clicks')} · {p.convRate.toFixed(0)}%
                        </div>
                        <div className="h-1 rounded mt-2 overflow-hidden" style={{ background: 'rgb(var(--ink)/0.06)' }}>
                          <div className="h-full rounded transition-all" style={{ width: `${barPct}%`, background: i === 0 ? `linear-gradient(90deg,${RED}88,${RED})` : `linear-gradient(90deg,${C_MID},${C_HI})` }} />
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-[620] tabular-nums" style={{ color: T1, letterSpacing: '-0.01em' }}>{fmt(p.revenue)}</div>
                        <div className="text-[11px] mt-1" style={{ color: T3 }}>−{fmt(p.commission)} {t('owner.an.commissionLower')}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </PCard>
          </motion.div>
        )}

  </>);
  // Communauté › Vue d'ensemble compte déjà la participation et la récence
  // (base de contacts). L'ancienne zone Fidélité les recomptait avec d'autres
  // définitions (« 96 % reviennent » sous « 54 % ne sont venus qu'une fois ») :
  // seule la liste des meilleurs clients, qu'on ne voit nulle part ailleurs,
  // reste ici.
  const loyaltyZone = (<>
        {customerAnalytics && customerAnalytics.topCustomers.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <PCard icon={<Crown className="w-4 h-4" />} title={t('owner.an.topCustomers')} sub={t('owner.an.byLifetimeSpend')}>
              <div className="grid gap-x-8 md:grid-cols-2">
                {customerAnalytics.topCustomers.slice(0, 10).map((c, i) => (
                  <div key={i} className="flex items-center gap-3 py-2.5" style={{ borderBottom: `1px solid ${BORDER}` }}>
                    <span className="text-[12.5px] tabular-nums w-5" style={{ color: T3 }}>{String(i + 1).padStart(2, '0')}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-[560] truncate" style={{ color: T1 }}>{c.name}</div>
                      <div className="text-[11.5px]" style={{ color: T3 }}>{c.visitNights} {t('owner.an.nights')}</div>
                    </div>
                    <div className="text-sm font-[620] tabular-nums" style={{ color: T1 }}>{eurFmt(c.totalSpent)}</div>
                  </div>
                ))}
              </div>
            </PCard>
          </motion.div>
        )}
  </>);
  const audienceZone = (<>
        {/* ── Zone · Audience (age & gender of participants) ────────────── */}
        {mode === 'global' && venueId && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="space-y-3">
            <EventAudienceDemographics scope={{ kind: 'venue', id: venueId }} from={webWindow.from} to={webWindow.to} />
          </motion.div>
        )}

  </>);
  const webZone = (<div className="space-y-4">
        {/* ── Zone · Web traffic ────────────────────────────────────────── */}
        {venueId && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.22 }} className="space-y-3">
            <AcquisitionDashboard scope={{ kind: 'venue', id: venueId }} from={webWindow.from} to={webWindow.to} />
          </motion.div>
        )}

        {/* ── Zone · Web engagement ─────────────────────────────────────── */}
        {venueId && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.24 }} className="space-y-3">
            <ZoneHeading icon={<Activity className="w-4 h-4" />} label={t('owner.an.zoneEngagement')} />
            <BehaviorAnalytics scope={{ kind: 'venue', id: venueId }} from={webWindow.from} to={webWindow.to} />
          </motion.div>
        )}

  </div>);
  // Contrôles (période, export) : seulement là où ils changent quelque chose.
  // Ventes porte sa propre période (en soirées) et son export.
  const showControls = (family === 'traffic' && view === 'sources')
    || (family === 'community' && (view === 'purchase' || view === 'demographics'));

  return (
    <div className="min-h-screen pb-28" style={{ background: 'var(--sf-000000)' }}>
      {/* Top ambient vignette */}
      <div className="fixed inset-0 pointer-events-none z-0"
        style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgb(var(--ink)/.025),transparent 55%)' }} />

      <OwnerHeader
        title={t('owner.analytics')}
        rightContent={
          <div className="flex items-center gap-2 px-3 py-2 rounded-full"
            style={{ background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)' }}>
            <div className="relative">
              <div className="h-2 w-2 rounded-full" style={{ background: POS }} />
              <div className="absolute inset-0 h-2 w-2 rounded-full animate-ping opacity-75" style={{ background: POS }} />
            </div>
            <span className="text-sm font-semibold tabular-nums" style={{ color: POS }}>
              {liveVisitors} <span className="font-normal opacity-70 hidden xs:inline">{t('owner.online')}</span>
            </span>
          </div>
        }
      />

      <div className="relative z-10 mx-auto max-w-[1340px] px-4 sm:px-6 pt-2 space-y-4">

        {/* ── Controls row ──────────────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
          <AnalyticsFamilyNav family={family} view={view} go={go} hideQuestion={isLive || mode === 'event'} />
          {showControls && (
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 flex-wrap">
            {mode === 'global' && (
              <div className="flex gap-1 flex-wrap p-1 rounded-xl"
                style={{ background: 'rgb(var(--ink)/0.025)', border: `1px solid ${BORDER}` }}>
                {periodOptions.map(opt => (
                  <button
                    key={opt.key}
                    onClick={() => setDateRange(opt.key)}
                    className="px-3 py-1.5 rounded-lg text-[12.5px] font-medium cursor-pointer transition-all duration-150"
                    style={dateRange === opt.key
                      ? { color: '#fff', background: RED, boxShadow: `0 0 14px -4px ${RED}88` }
                      : { color: T3 }}>
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          )}
        </motion.div>

        {isPurchase ? (
          <PurchaseBehaviorView venueId={venueId} dateRange={dateRange} />
        ) : family === 'community' && view === 'overview' ? (
          <CommunityOverviewView scope={{ venueId }} contactsHref={`${consolePrefix}/campaigns/contacts`} eventHref={eventHref}>
            {loyaltyZone}
          </CommunityOverviewView>
        ) : family === 'community' && view === 'subscribers' ? (
          venueId ? (
            <AudienceDashboard
              embedded
              subject={{ type: 'venue', id: venueId }}
              actions={
                <Link
                  to={`${consolePrefix}/push`}
                  className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-semibold transition-opacity hover:opacity-90"
                  style={{ background: RED, color: '#fff' }}
                >
                  <Megaphone className="w-4 h-4" />
                  {t('anf.notifyFollowers')}
                </Link>
              }
            />
          ) : null
        ) : family === 'community' && view === 'tastes' ? (
          <CommunityTastesView scope={{ venueId }} />
        ) : family === 'community' && view === 'demographics' ? (
          audienceZone
        ) : family === 'traffic' && view === 'sources' ? (
          webZone
        ) : family === 'traffic' ? (
          <TrafficView scope={{ venueId }} mode={view === 'events' ? 'events' : 'page'} publicPath={venueId ? `/club/${venueId}` : null} eventHref={eventHref} />
        ) : family === 'sales' && view === 'partners' ? (
          promoterLoading ? <AnalyticsLoading /> : hasPromoter ? promoterZone : <ReportCard><EmptyNote text={t('anf.pa.empty')} /></ReportCard>
        ) : isLive ? (
          <LiveView venueId={venueId} />
        ) : showEventPicker ? (
          <EventAnalyticsPicker
            venueId={venueId}
            onSelect={(id) => {
              setSelectedEventId(id);
              if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          />
        ) : (
        <>

        {/* Rapport de soirée : les cinq questions (ventes, courbe comparée,
            trafic, public, ce qui a fait vendre), verdict en tête une fois la
            soirée passée. */}
        {mode === 'event' && selectedEventId && (
          <EventReportView
            key={selectedEventId}
            eventId={selectedEventId}
            onEventChange={(id) => setSelectedEventId(id)}
            onBack={() => setSelectedEventId(null)}
            scope={{ venueId }}
            verdict={venueId ? <EventPostAnalysisView key={selectedEventId} eventId={selectedEventId} venueId={venueId} layout="summary" /> : undefined}
            demographics={venueId ? <EventAudienceDemographics scope={{ kind: 'venue', id: venueId }} eventId={selectedEventId} /> : undefined}
            forecast={venueId && hasFeature('hype_analysis') ? <HypeEventForecast venueId={venueId} eventId={selectedEventId} /> : undefined}
          />
        )}

        {/* Ventes › Vue d'ensemble : le bilan des dernières soirées, pilier par
            pilier, avec le détail hérité replié (plan de simplification). */}
        {mode === 'global' && (
          <SalesOverviewView
            venueId={venueId}
            eventHref={eventHref}
            eventsHref={`${consolePrefix}/events`}
            accountingHref={`${consolePrefix}/accounting`}
            canExport={hasExport}
            renderDetail={(pillar, period) => (
              <SalesPillarDetail venueId={venueId} pillar={pillar} period={period} hasVipTables={hasVipTables} />
            )}
          />
        )}

        </>
        )}

      </div>
    </div>
  );
}
