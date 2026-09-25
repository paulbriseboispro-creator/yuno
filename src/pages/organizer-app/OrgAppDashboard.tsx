import { useEffect, useMemo, useState } from 'react';
import { eventReportHref } from '@/lib/analyticsNav';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useActingOrganizer } from '@/hooks/useActingOrganizer';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { motion } from 'framer-motion';
import { Plus, AlertCircle, CreditCard, ArrowRight, Sparkles } from 'lucide-react';
import { useOrganizerStripe } from '@/hooks/useOrganizerStripe';
import { OrgPendingProposals } from '@/components/organizer-app/OrgPendingProposals';
import { UpcomingEventsBoard } from '@/components/events-sales/UpcomingEventsBoard';
import { format, subDays, startOfDay } from 'date-fns';
import { fr, enUS } from 'date-fns/locale';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { useHomeBanner } from '@/hooks/useHomeBanner';
import { HomeBannerBackdrop } from '@/components/home-banner/HomeBannerBackdrop';
import { HomeBannerEditButton } from '@/components/home-banner/HomeBannerEditButton';
import { HomeBannerEditor } from '@/components/home-banner/HomeBannerEditor';

// ─── Yuno Design Tokens (aligned with the Owner dashboard DA) ──────────────────
const RED       = '#E8192C';
const POS       = 'var(--acc-34d399)';
const T1        = 'rgb(var(--ink)/var(--ink-a96,0.96))';
const T2        = 'rgb(var(--ink)/var(--ink-a58,0.58))';
const T3        = 'rgb(var(--ink)/var(--ink-a36,0.36))';
const C_FAINT   = 'rgb(var(--ink)/0.06)';
const BORDER    = 'rgb(var(--ink)/0.085)';
const INNER_BG  = 'rgb(var(--ink)/0.032)';
const CARD_BG   = 'linear-gradient(180deg,rgb(var(--sheen)/.045) 0%,rgb(var(--sheen)/.008) 100%),var(--sf-0a0a0c)';
const CARD_SHADOW = '0 1px 0 rgb(var(--sheen)/.05) inset,0 18px 40px -28px rgb(0 0 0/calc(.9*var(--pro-shadow-a)))';

interface NextEvent {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  poster_url: string | null;
  location_name: string | null;
  location_city: string | null;
  max_tickets: number | null;
  partner_venue_id: string | null;
  venue_id: string | null;
}

interface Globals {
  ca30: number;
  tickets30: number;
  upcomingCount: number;
  uniqueBuyers30: number;
  conversionRate30: number;
  daily: { date: string; revenue: number }[];
}

type PeriodDays = 7 | 14 | 30;

export default function OrgAppDashboard() {
  const { organizerId, organizationName, organizationLogoUrl, can } = useActingOrganizer();
  const { language } = useLanguage();
  const { canSell, status: stripeStatus, loading: stripeLoading } = useOrganizerStripe(organizerId);

  const [loading, setLoading] = useState(true);
  const [orgCover, setOrgCover] = useState<string | null>(null);
  const { banner: homeBanner, loaded: bannerLoaded, setBanner: setHomeBanner } = useHomeBanner(organizerId ? { kind: 'organizer', id: organizerId } : null);
  const [bannerEditorOpen, setBannerEditorOpen] = useState(false);
  const [orgCity, setOrgCity] = useState<string | null>(null);
  const [nextEvent, setNextEvent] = useState<NextEvent | null>(null);
  const [period, setPeriod] = useState<PeriodDays>(30);
  const [globals, setGlobals] = useState<Globals>({
    ca30: 0, tickets30: 0, upcomingCount: 0, uniqueBuyers30: 0, conversionRate30: 0, daily: [],
  });
  const [topEvents, setTopEvents] = useState<{ id: string; title: string; revenue: number; tickets: number }[]>([]);

  const tt = (frTxt: string, en: string, es?: string) => translate(language, frTxt, en, es);
  const locale = language === 'fr' ? fr : enUS;

  useEffect(() => {
    if (!organizerId) return;
    (async () => {
      try {
        // 0. Org identity extras for the hero (city) and the banner editor
        //    (public cover, offered as a starting point — never shown as is)
        const [{ data: prof }, { data: orgProf }] = await Promise.all([
          supabase.from('profiles').select('city').eq('id', organizerId).maybeSingle(),
          supabase.from('organizer_profiles').select('cover_url').eq('user_id', organizerId).maybeSingle(),
        ]);
        setOrgCity(prof?.city ?? null);
        setOrgCover((orgProf as any)?.cover_url ?? null);

        // 1. Next upcoming event
        const { data: upcoming } = await supabase
          .from('events')
          .select('id, title, start_at, end_at, poster_url, location_name, location_city, max_tickets, partner_venue_id, venue_id')
          .or(`organizer_user_id.eq.${organizerId},partner_organizer_id.eq.${organizerId}`)
          .gte('end_at', new Date().toISOString())
          .order('start_at', { ascending: true })
          .limit(1);
        const next = upcoming?.[0] ?? null;
        setNextEvent(next);

        // 2. Globals 30j
        const since = subDays(new Date(), 30);
        const { data: allEvents } = await supabase
          .from('events')
          .select('id, title')
          .or(`organizer_user_id.eq.${organizerId},partner_organizer_id.eq.${organizerId}`);
        const eventIds = (allEvents ?? []).map(e => e.id);
        const upcomingCount = upcoming?.length ? (await supabase
          .from('events')
          .select('id', { count: 'exact', head: true })
          .or(`organizer_user_id.eq.${organizerId},partner_organizer_id.eq.${organizerId}`)
          .gte('end_at', new Date().toISOString())).count ?? 0 : 0;

        let ca30 = 0, tickets30 = 0, uniqueBuyers30 = 0;
        const dailyMap: Record<string, number> = {};
        const eventTotals: Record<string, { revenue: number; tickets: number }> = {};

        if (eventIds.length > 0) {
          const { data: t30 } = await supabase
            .from('tickets')
            .select('total_price, quantity, user_email, created_at, event_id')
            .in('event_id', eventIds)
            .eq('status', 'paid')
            .gte('created_at', since.toISOString());
          const buyers = new Set<string>();
          (t30 ?? []).forEach((t: any) => {
            const amt = Number(t.total_price ?? 0);
            ca30 += amt;
            tickets30 += t.quantity ?? 1;
            if (t.user_email) buyers.add(t.user_email);
            const day = format(startOfDay(new Date(t.created_at)), 'MM-dd');
            dailyMap[day] = (dailyMap[day] ?? 0) + amt;
            if (!eventTotals[t.event_id]) eventTotals[t.event_id] = { revenue: 0, tickets: 0 };
            eventTotals[t.event_id].revenue += amt;
            eventTotals[t.event_id].tickets += t.quantity ?? 1;
          });
          uniqueBuyers30 = buyers.size;
        }

        // Build 30 day series (fill missing days with 0)
        const daily: { date: string; revenue: number }[] = [];
        for (let i = 29; i >= 0; i--) {
          const d = format(subDays(new Date(), i), 'MM-dd');
          daily.push({ date: d, revenue: dailyMap[d] ?? 0 });
        }

        setGlobals({
          ca30, tickets30, upcomingCount,
          uniqueBuyers30,
          conversionRate30: 0, // visitor sessions not tracked org-side yet
          daily,
        });

        // Top events
        const eventTitleMap = new Map((allEvents ?? []).map(e => [e.id, e.title]));
        const top = Object.entries(eventTotals)
          .map(([id, v]) => ({ id, title: eventTitleMap.get(id) ?? '—', ...v }))
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 3);
        setTopEvents(top);
      } finally {
        setLoading(false);
      }
    })();
  }, [organizerId]);

  const chartData = useMemo(() => globals.daily.slice(-period), [globals.daily, period]);
  const orgName = organizationName || 'Yuno';
  const orgLogo = organizationLogoUrl;

  return (
    <div className="px-4 pb-12">
      {/* ─── Org Hero ──────────────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="relative -mx-4 overflow-hidden"
        style={{ height: 240, borderRadius: '0 0 22px 22px' }}
        // Bannière cinéma (photo + voile) : sombre dans les deux thèmes.
        data-theme-island="dark"
      >
        {/* Fond : bannière d'accueil (pas la couverture 4:3 du profil public). */}
        <HomeBannerBackdrop banner={homeBanner} alt={orgName} />
        {bannerLoaded && can.manageOrganization && (
          <HomeBannerEditButton hasBanner={!!homeBanner} onClick={() => setBannerEditorOpen(true)} />
        )}

        <div className="relative flex h-full flex-col justify-end px-5 pb-5">
          <div className="flex items-end justify-between gap-3">
            {/* Identity */}
            <div className="flex min-w-0 items-end gap-3.5">
              {orgLogo ? (
                <img
                  src={orgLogo}
                  alt=""
                  className="h-[58px] w-[58px] flex-shrink-0 rounded-2xl object-cover"
                  style={{ border: '1.5px solid rgb(var(--ink)/0.18)', boxShadow: '0 0 0 1px rgba(0,0,0,0.55), 0 10px 32px -6px rgba(0,0,0,0.95)' }}
                />
              ) : (
                <div
                  className="flex h-[58px] w-[58px] flex-shrink-0 items-center justify-center rounded-2xl"
                  style={{ background: 'linear-gradient(135deg, rgba(232,25,44,0.22) 0%, rgba(232,25,44,0.06) 100%)', border: '1.5px solid rgba(232,25,44,0.32)', boxShadow: '0 0 0 1px rgba(0,0,0,0.55), 0 10px 32px -6px rgba(0,0,0,0.95)' }}
                >
                  <Sparkles className="h-6 w-6" style={{ color: RED }} />
                </div>
              )}
              <div className="min-w-0 pb-0.5">
                <div className="truncate" style={{ color: T1, fontSize: 23, fontWeight: 700, lineHeight: 1.15, letterSpacing: '-0.5px', textShadow: '0 2px 20px rgba(0,0,0,0.95)' }}>
                  {orgName}
                </div>
                <div style={{ color: T3, fontSize: 13, fontWeight: 500, marginTop: 4 }}>
                  {orgCity ? orgCity : tt('Organisateur', 'Organizer')}
                </div>
              </div>
            </div>

            {/* Next event chip */}
            {nextEvent && (() => {
              const evDate = new Date(nextEvent.start_at);
              const isToday = evDate.toDateString() === new Date().toDateString();
              return (
                <div
                  className="flex-shrink-0 rounded-2xl px-3.5 py-3"
                  style={{
                    background: isToday ? 'rgba(232,25,44,0.13)' : 'rgb(var(--ink)/0.04)',
                    border: isToday ? '1px solid rgba(232,25,44,0.3)' : `1px solid ${BORDER}`,
                    backdropFilter: 'blur(20px)',
                    minWidth: 110,
                  }}
                >
                  <div className="mb-1.5 flex items-center gap-1.5">
                    {isToday && <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: RED, boxShadow: `0 0 6px ${RED}` }} />}
                    <span style={{ color: isToday ? RED : T3, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                      {isToday ? tt('Ce soir', 'Tonight') : tt('Prochaine', 'Next')}
                    </span>
                  </div>
                  <div style={{ color: T1, fontSize: 15, fontWeight: 700 }}>
                    {format(evDate, 'd MMM', { locale })}
                  </div>
                  <div className="truncate" style={{ color: T2, fontSize: 11.5, maxWidth: 120 }}>
                    {nextEvent.title}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </motion.div>

      {organizerId && can.manageOrganization && (
        <HomeBannerEditor
          open={bannerEditorOpen}
          onOpenChange={setBannerEditorOpen}
          scope={{ kind: 'organizer', id: organizerId }}
          current={homeBanner}
          identity={{ name: orgName, subtitle: orgCity, logoUrl: orgLogo }}
          publicCover={orgCover ? { url: orgCover } : null}
          onSaved={setHomeBanner}
        />
      )}

      <div className="mt-4 space-y-4">
        {/* Title row + CTA */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 style={{ color: T1, fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em' }}>{tt('Mission Control', 'Mission Control')}</h1>
            <p style={{ color: T3, fontSize: 12, marginTop: 2 }}>{tt("Tout ce qui compte pour vos événements, en un coup d'œil.", 'Everything that matters at a glance.')}</p>
          </div>
          <Link
            to="/organizer-app/events?create=1"
            className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-semibold transition-all duration-150"
            style={{ background: RED, color: '#fff', boxShadow: `0 0 20px -6px ${RED}88` }}
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">{tt('Créer un événement', 'Create event')}</span>
          </Link>
        </div>

        {/* Stripe alert */}
        {can.manageOrganization && !stripeLoading && !canSell && (
          <div className="flex items-start gap-3 rounded-xl px-4 py-3" style={{ background: 'rgba(232,25,44,0.06)', border: '1px solid rgba(232,25,44,0.22)' }}>
            <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" style={{ color: RED }} />
            <div className="flex-1 min-w-0">
              <p style={{ color: T1, fontSize: 13, fontWeight: 560 }}>{tt('Activez les paiements pour vendre', 'Activate payments to start selling')}</p>
              <p style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>
                {stripeStatus === 'pending'
                  ? tt('Onboarding Stripe incomplet.', 'Stripe onboarding incomplete.')
                  : tt('Vos soirées et vos guest lists vivent en ligne sans Stripe. Billets, tables et boissons demandent un compte connecté.', 'Your events and guest lists go live without Stripe. Tickets, tables and drinks need a connected account.')}
              </p>
            </div>
            <Link
              to="/organizer-app/payments"
              className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-all duration-150"
              style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}
            >
              <CreditCard className="h-3.5 w-3.5" />
              {tt('Configurer', 'Configure')}
            </Link>
          </div>
        )}

        {/* ─── Pending co-event proposals (awaiting my acceptance) ──────────────── */}
        <OrgPendingProposals />

        {/* ─── KPI tiles (30d) ──────────────────────────────────────────────────── */}
        {/* Les chiffres d'ARGENT ne s'affichent que pour qui a le droit de les
            voir. La RLS laisse un scanner lire les billets d'une soirée — c'est
            ce qui lui permet de scanner — donc rien côté base n'empêcherait ce
            tableau de bord de lui annoncer le chiffre d'affaires. */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {can.viewFinance && (
            <KpiTile label={tt('CA brut', 'Gross revenue')} value={`${globals.ca30.toFixed(0)} €`} subtitle={tt('30 derniers jours', 'Last 30 days')} loading={loading} />
          )}
          <KpiTile label={tt('Billets vendus', 'Tickets sold')} value={globals.tickets30} subtitle={tt('30 derniers jours', 'Last 30 days')} loading={loading} />
          {can.viewInsights && (
            <KpiTile label={tt('Acheteurs uniques', 'Unique buyers')} value={globals.uniqueBuyers30} subtitle={tt('30 derniers jours', 'Last 30 days')} loading={loading} />
          )}
          <KpiTile label={tt('Soirées à venir', 'Upcoming events')} value={globals.upcomingCount} subtitle={tt('Total', 'Total')} loading={loading} />
        </div>

        {/* ─── Revenue chart ────────────────────────────────────────────────────── */}
        {can.viewFinance && (
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW }}>
          <div className="flex items-center justify-between px-5 pt-4">
            <div>
              <h2 style={{ color: T1, fontSize: 14, fontWeight: 600 }}>{tt('Revenus', 'Revenue')}</h2>
              <p style={{ color: T3, fontSize: 11, marginTop: 1 }}>{tt('Ventes de billets', 'Ticket sales')}</p>
            </div>
            <div className="flex items-center gap-1 rounded-lg p-0.5" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
              {([7, 14, 30] as PeriodDays[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className="rounded-md px-2.5 py-1 text-[11px] font-semibold transition-all duration-150"
                  style={period === p ? { background: 'rgb(var(--ink)/0.1)', color: T1 } : { background: 'transparent', color: T3 }}
                >
                  {p}{tt('j', 'd')}
                </button>
              ))}
            </div>
          </div>
          <div className="h-44 px-2 pb-3 pt-3">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 8, right: 12, left: 12, bottom: 0 }}>
                <defs>
                  <linearGradient id="orgRev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={RED} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={RED} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--ink)/0.05)" vertical={false} />
                <XAxis dataKey="date" hide />
                <Tooltip
                  contentStyle={{ background: 'var(--sf-0a0a0c)', border: `1px solid ${BORDER}`, borderRadius: 10, fontSize: 12, color: T1 }}
                  labelStyle={{ color: T3 }}
                  formatter={(v: any) => [`${Number(v).toFixed(2)} €`, tt('Revenu', 'Revenue')]}
                />
                <Area type="monotone" dataKey="revenue" stroke={RED} strokeWidth={2} fill="url(#orgRev)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
        )}

        {/* ─── Vos prochaines soirées — J-N, CA du jour, jauges ─────────────── */}
        {organizerId && (
          <UpcomingEventsBoard
            scope={{ organizerUserId: organizerId }}
            statsHref={(id) => (can.viewInsights ? eventReportHref('/organizer-app/analytics', id) : `/organizer-app/events/${id}`)}
            allHref="/organizer-app/events"
            liveHref={(id) => (can.editEvents ? `/organizer-app/events/${id}/live` : null)}
            emptyCta={can.editEvents ? { label: tt('Créer un événement', 'Create event', 'Crear un evento'), href: '/organizer-app/events?create=1' } : undefined}
          />
        )}

        {/* ─── Top events ───────────────────────────────────────────────────────── */}
        {can.viewFinance && topEvents.length > 0 && (
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 style={{ color: T1, fontSize: 14, fontWeight: 600 }}>{tt('Top soirées (30j)', 'Top events (30d)')}</h2>
              <Link to="/organizer-app/analytics" className="flex items-center gap-1 text-[11.5px]" style={{ color: T3 }}>
                {tt('Voir tout', 'See all')} <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {topEvents.map((e, i) => (
                <Link key={e.id} to={`/organizer-app/events/${e.id}`} className="block">
                  <div className="h-full p-4 transition-all duration-150" style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 16, boxShadow: CARD_SHADOW }}>
                    <div className="flex items-start gap-3">
                      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-sm font-bold" style={{ background: 'rgba(232,25,44,0.1)', color: RED }}>
                        #{i + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{e.title}</div>
                        <div style={{ color: T3, fontSize: 11.5, marginTop: 1 }}>{e.tickets} {tt('billets', 'tickets')}</div>
                        <div style={{ color: T1, fontSize: 17, fontWeight: 700, marginTop: 4 }}>{e.revenue.toFixed(0)} €</div>
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function KpiTile({ label, value, subtitle, loading }: { label: string; value: number | string; subtitle: string; loading: boolean }) {
  return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 16, boxShadow: CARD_SHADOW, padding: 18 }}>
      <div style={{ color: T3, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ color: T1, fontSize: 26, fontWeight: 700, marginTop: 8, fontVariantNumeric: 'tabular-nums' }}>
        {loading ? <span style={{ color: T3 }}>—</span> : value}
      </div>
      <div style={{ color: T3, fontSize: 11, marginTop: 6 }}>{subtitle}</div>
    </div>
  );
}
