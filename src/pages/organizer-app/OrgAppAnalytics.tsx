import { motion } from 'framer-motion';
import {
  CreditCard, TrendingUp, Activity, Loader2, Megaphone, Target, Crown, MousePointerClick,
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { useActingOrganizer } from '@/hooks/useActingOrganizer';
import { supabase } from '@/integrations/supabase/client';
import { subMinutes } from 'date-fns';
import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { type AnalyticsMode, type DateRange, dateRangeToWindow } from '@/hooks/useAnalyticsData';
import { usePromoterAnalytics } from '@/hooks/usePromoterAnalytics';
import { useCustomerAnalytics } from '@/hooks/useCustomerAnalytics';
import { useOrganizerEventIds } from '@/hooks/useOrganizerEventIds';
import { buildOrganizerScopeOr } from '@/components/analytics/scopeFilter';
import { EventAnalyticsPicker } from '@/components/analytics/EventAnalyticsPicker';
import { AcquisitionDashboard } from '@/components/analytics/AcquisitionDashboard';
import { BehaviorAnalytics } from '@/components/analytics/BehaviorAnalytics';
import { AudienceInsights } from '@/components/analytics/AudienceInsights';
import { EventAudienceDemographics } from '@/components/analytics/EventAudienceDemographics';
import { EventPostAnalysisView } from '@/components/owner/co-event/EventPostAnalysisView';
import { useAnalyticsRoute } from '@/hooks/useAnalyticsRoute';
import { eventReportHref } from '@/lib/analyticsNav';
import { AnalyticsFamilyNav } from '@/components/analytics/families/AnalyticsFamilyNav';
import { AnalyticsLoading } from '@/components/analytics/kit';
import { useNumberFormat } from '@/components/analytics/kitFormat';
import { CommunityOverviewView } from '@/components/analytics/families/CommunityOverviewView';
import { CommunityTastesView } from '@/components/analytics/families/CommunityTastesView';
import { TrafficView } from '@/components/analytics/families/TrafficView';
import { AudienceDashboard } from '@/components/audience/AudienceDashboard';
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
      style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 22, ...style }}
    >
      {(title || icon) && (
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            {icon && (
              <div className="w-8 h-8 flex items-center justify-center rounded-xl flex-none" style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T2 }}>
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

// ─── Small KPI tile (night / promoter / loyalty zones) ────────────────────────
function Tile({ label, val, sub, icon, tone }: { label: string; val: string; sub: string; icon: React.ReactNode; tone: string }) {
  return (
    <PCard>
      <div className="flex flex-col min-h-[104px]">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: T3 }}>{label}</span>
          <span style={{ color: T3 }}>{icon}</span>
        </div>
        <div className="mt-2 text-[clamp(22px,2.6vw,30px)] font-[640] leading-none tabular-nums" style={{ color: tone, letterSpacing: '-0.025em' }}>{val}</div>
        <div className="mt-auto pt-2 text-[11.5px]" style={{ color: T3 }}>{sub}</div>
      </div>
    </PCard>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
// Same analytical depth as the club page (OwnerAnalytics), organizer-scoped:
// overview KPIs with real period deltas, per-night ledger, the night (door),
// guest list, promoter ROI, loyalty (RFM), audience, web traffic, then the
// Tickets / VIP tables / Refunds pillars. Organizers don't sell drinks, so the
// drinks pillar and bar-side metrics are the only things missing on purpose.
export default function OrgAppAnalytics() {
  const { t, language } = useLanguage();
  const tt = (fr2: string, en: string, es2?: string) => translate(language, fr2, en, es2);
  // Scope organisation, pas scope personne : un membre d'équipe lit
  // l'analytique de l'organisation pour laquelle il travaille.
  const { organizerId } = useActingOrganizer();

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
  // Adresse publique de l'organisation (Trafic › Ma page → « Voir ma page »).
  const [orgSlug, setOrgSlug] = useState<string | null>(null);
  useEffect(() => {
    if (!organizerId) return;
    supabase.from('organizer_profiles').select('slug').eq('user_id', organizerId).maybeSingle()
      .then(({ data }) => setOrgSlug(data?.slug ?? null));
  }, [organizerId]);
  // La soirée choisie vit dans l'URL (`?event=`) : /organizer-app/analytics?event=<id>
  // ouvre directement son analyse (tuile « Analyse » de la page soirée, liste
  // des soirées, tableau de bord).
  const [selectedEventId, setSelectedEventId] = useEventParam();
  const [liveVisitors, setLiveVisitors] = useState(0);

  // Web-traffic zones share the page's main period selector (no separate filter).
  const webWindow = dateRangeToWindow(dateRange);

  const { eventIds, venueIds } = useOrganizerEventIds(organizerId);
  const { promoterAnalytics, loading: promoterLoading } = usePromoterAnalytics({
    organizerUserId: organizerId, dateRange, mode, selectedEventId, enabled: family === 'sales' && view === 'partners',
  });
  const { customerAnalytics } = useCustomerAnalytics({ organizerUserId: organizerId, enabled: family === 'community' && view === 'overview' });

  // Visitor funnel (organizer scope) + live count
  useEffect(() => {
    if (!organizerId) return;
    let cancelled = false;
    const orFilter = buildOrganizerScopeOr(organizerId, eventIds, venueIds);

    const fetchLive = async () => {
      const fiveMinutesAgo = subMinutes(new Date(), 5);
      let q: any = supabase.from('visitor_sessions').select('id').or(orFilter).gte('visited_at', fiveMinutesAgo.toISOString());
      if (mode === 'event' && selectedEventId) q = supabase.from('visitor_sessions').select('id').eq('event_id', selectedEventId).gte('visited_at', fiveMinutesAgo.toISOString());
      const { data } = await q;
      if (!cancelled) setLiveVisitors(data?.length ?? 0);
    };

    fetchLive();
    const interval = setInterval(fetchLive, 10000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [organizerId, eventIds.join(','), venueIds.join(','), mode, selectedEventId]);

  if (!organizerId) {
    return <div className="flex justify-center py-24"><Loader2 className="h-7 w-7 animate-spin" style={{ color: T3 }} /></div>;
  }

  // Montants au format de la langue : « 321 € » / « 3,1 k€ » en français,
  // « €321 » / « €3.1K » en anglais — jamais un « €321 » figé.
  const fmt = (n: number) => new Intl.NumberFormat(
    language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-GB',
    { style: 'currency', currency: 'EUR', notation: Math.abs(n) >= 10000 ? 'compact' : 'standard', maximumFractionDigits: Math.abs(n) >= 10000 ? 1 : 0 },
  ).format(n);

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
        {promoterAnalytics && hasPromoter && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.24 }} className="space-y-3">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { label: t('owner.an.attributedRevenue'), val: fmt(promoterAnalytics.totalAttributed), sub: `${promoterAnalytics.totalConversions} ${t('owner.an.conversions')}`, icon: <TrendingUp className="w-4 h-4" />, tone: T1 },
                { label: t('owner.an.commissions'), val: `−${fmt(promoterAnalytics.totalCommission)}`, sub: t('owner.an.owedToPromoters'), icon: <CreditCard className="w-4 h-4" />, tone: T1 },
                { label: t('owner.an.clickToSale'), val: `${promoterAnalytics.convRate.toFixed(0)}%`, sub: `${promoterAnalytics.totalClicks} ${t('owner.an.clicks')}`, icon: <MousePointerClick className="w-4 h-4" />, tone: T1 },
                { label: t('owner.an.promoterRoiShort'), val: promoterAnalytics.totalCommission > 0 ? `${promoterAnalytics.roi.toFixed(1)}x` : '—', sub: t('owner.an.revenuePerEuro'), icon: <Target className="w-4 h-4" />, tone: promoterAnalytics.roi >= 1 ? POS : T1 },
              ].map((tile, i) => <Tile key={i} {...tile} />)}
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
        {/* ── Zone · Audience (age & gender + follower insights) ─────────── */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="space-y-3">
          {mode === 'global' && (
            <EventAudienceDemographics scope={{ kind: 'organizer', id: organizerId }} from={webWindow.from} to={webWindow.to} />
          )}
          <AudienceInsights scope={{ kind: 'organizer', id: organizerId }} from={webWindow.from} to={webWindow.to} />
        </motion.div>

  </>);
  const webZone = (<div className="space-y-4">
        {/* ── Zone · Web traffic ────────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.22 }} className="space-y-3">
          <AcquisitionDashboard scope={{ kind: 'organizer', id: organizerId }} from={webWindow.from} to={webWindow.to} />
        </motion.div>

        {/* ── Zone · Web engagement ─────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.24 }} className="space-y-3">
          <ZoneHeading icon={<Activity className="w-4 h-4" />} label={t('owner.an.zoneEngagement')} />
          <BehaviorAnalytics scope={{ kind: 'organizer', id: organizerId }} from={webWindow.from} to={webWindow.to} />
        </motion.div>

  </div>);
  // Contrôles (période, export) : seulement là où ils changent quelque chose.
  // Ventes porte sa propre période (en soirées) et son export.
  const showControls = (family === 'traffic' && view === 'sources')
    || (family === 'community' && (view === 'purchase' || view === 'demographics'));

  return (
    <div className="min-h-screen pb-28" style={{ background: 'var(--sf-000000)' }}>
      <div className="fixed inset-0 pointer-events-none z-0" style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgb(var(--ink)/.025),transparent 55%)' }} />

      <div className="relative z-10 mx-auto max-w-[1340px] px-4 sm:px-6 pt-2 space-y-4">

        {/* Title + live pill */}
        <div className="flex items-center justify-between gap-3 pt-2">
          <div>
            <h1 style={{ color: T1, fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>{tt('Analytique', 'Analytics', 'Analítica')}</h1>
            <p style={{ color: T3, fontSize: 12, marginTop: 2 }}>{tt('Performances détaillées de toutes vos soirées.', 'Detailed performance across all your events.', 'Rendimiento detallado de todas tus noches.')}</p>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 rounded-full" style={{ background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)' }}>
            <div className="relative">
              <div className="h-2 w-2 rounded-full" style={{ background: POS }} />
              <div className="absolute inset-0 h-2 w-2 rounded-full animate-ping opacity-75" style={{ background: POS }} />
            </div>
            <span className="text-sm font-semibold tabular-nums" style={{ color: POS }}>
              {liveVisitors} <span className="font-normal opacity-70 hidden xs:inline">{t('owner.online')}</span>
            </span>
          </div>
        </div>

        {/* ── Controls row ──────────────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
          <AnalyticsFamilyNav family={family} view={view} go={go} hideQuestion={isLive || mode === 'event'} />
          {showControls && (
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 flex-wrap">
            {mode === 'global' && (
              <div className="flex gap-1 flex-wrap p-1 rounded-xl" style={{ background: 'rgb(var(--ink)/0.025)', border: `1px solid ${BORDER}` }}>
                {periodOptions.map(opt => (
                  <button key={opt.key} onClick={() => setDateRange(opt.key)}
                    className="px-3 py-1.5 rounded-lg text-[12.5px] font-medium cursor-pointer transition-all duration-150"
                    style={dateRange === opt.key ? { color: '#fff', background: RED, boxShadow: `0 0 14px -4px ${RED}88` } : { color: T3 }}>
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          )}
        </motion.div>

        {isPurchase ? (
          <PurchaseBehaviorView organizerUserId={organizerId} dateRange={dateRange} />
        ) : family === 'community' && view === 'overview' ? (
          <CommunityOverviewView scope={{ organizerUserId: organizerId }} contactsHref={`${consolePrefix}/campaigns/contacts`} eventHref={eventHref}>
            {loyaltyZone}
          </CommunityOverviewView>
        ) : family === 'community' && view === 'subscribers' ? (
          organizerId ? (
            <AudienceDashboard
              embedded
              subject={{ type: 'organizer', id: organizerId }}
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
          <CommunityTastesView scope={{ organizerUserId: organizerId }} />
        ) : family === 'community' && view === 'demographics' ? (
          audienceZone
        ) : family === 'traffic' && view === 'sources' ? (
          webZone
        ) : family === 'traffic' ? (
          <TrafficView scope={{ organizerUserId: organizerId }} mode={view === 'events' ? 'events' : 'page'} publicPath={orgSlug ? `/o/${orgSlug}` : null} eventHref={eventHref} />
        ) : family === 'sales' && view === 'partners' ? (
          promoterLoading ? <AnalyticsLoading /> : hasPromoter ? promoterZone : <ReportCard><EmptyNote text={t('anf.pa.empty')} /></ReportCard>
        ) : isLive ? (
          <LiveView organizerUserId={organizerId} />
        ) : showEventPicker ? (
          <EventAnalyticsPicker
            organizerUserId={organizerId}
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
            scope={{ organizerUserId: organizerId }}
            verdict={<EventPostAnalysisView key={selectedEventId} eventId={selectedEventId} venueId={null} organizerUserId={organizerId} layout="report" />}
            demographics={organizerId ? <EventAudienceDemographics scope={{ kind: 'organizer', id: organizerId }} eventId={selectedEventId} /> : undefined}
          />
        )}

        {/* Ventes › Vue d'ensemble : le bilan des dernières soirées, pilier par
            pilier, avec le détail hérité replié (plan de simplification). */}
        {mode === 'global' && (
          <SalesOverviewView
            organizerUserId={organizerId}
            eventHref={eventHref}
            eventsHref={`${consolePrefix}/events`}
            accountingHref={`${consolePrefix}/accounting`}
            renderDetail={(pillar, period) => (
              <SalesPillarDetail organizerUserId={organizerId} pillar={pillar} period={period} />
            )}
          />
        )}

        </>
        )}

      </div>
    </div>
  );
}
