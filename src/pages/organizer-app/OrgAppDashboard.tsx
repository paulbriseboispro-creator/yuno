import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useProfileType } from '@/hooks/useProfileType';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { motion } from 'framer-motion';
import {
  CalendarDays, Ticket, Plus, TrendingUp, ScanLine, AlertCircle, CreditCard,
  Activity, Users, ArrowRight, Sparkles, MapPin, Clock, Wine,
} from 'lucide-react';
import { useOrganizerStripe } from '@/hooks/useOrganizerStripe';
import { format, formatDistanceToNow, subDays, startOfDay } from 'date-fns';
import { fr, enUS } from 'date-fns/locale';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis } from 'recharts';

// ─── Yuno Design Tokens (aligned with the Owner dashboard DA) ──────────────────
const RED       = '#E8192C';
const POS       = '#34D399';
const T1        = 'rgba(255,255,255,0.96)';
const T2        = 'rgba(255,255,255,0.58)';
const T3        = 'rgba(255,255,255,0.36)';
const C_FAINT   = 'rgba(255,255,255,0.06)';
const BORDER    = 'rgba(255,255,255,0.085)';
const INNER_BG  = 'rgba(255,255,255,0.032)';
const CARD_BG   = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

interface NextEvent {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  poster_url: string | null;
  image_url: string | null;
  location_name: string | null;
  location_city: string | null;
  max_tickets: number | null;
  partner_venue_id: string | null;
  venue_id: string | null;
}

interface NextEventStats {
  ticketsSold: number;
  revenue: number;
  netRevenue: number;
  checkins: number;
  tablesBooked: number;
  capacity: number | null;
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
  const { user } = useAuth();
  const { profile } = useProfileType();
  const { language } = useLanguage();
  const { canSell, status: stripeStatus, loading: stripeLoading } = useOrganizerStripe(user?.id);

  const [loading, setLoading] = useState(true);
  const [orgCover, setOrgCover] = useState<string | null>(null);
  const [orgCity, setOrgCity] = useState<string | null>(null);
  const [nextEvent, setNextEvent] = useState<NextEvent | null>(null);
  const [nextStats, setNextStats] = useState<NextEventStats | null>(null);
  const [period, setPeriod] = useState<PeriodDays>(30);
  const [globals, setGlobals] = useState<Globals>({
    ca30: 0, tickets30: 0, upcomingCount: 0, uniqueBuyers30: 0, conversionRate30: 0, daily: [],
  });
  const [topEvents, setTopEvents] = useState<{ id: string; title: string; revenue: number; tickets: number }[]>([]);

  const tt = (frTxt: string, en: string, es?: string) => translate(language, frTxt, en, es);
  const locale = language === 'fr' ? fr : enUS;

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        // 0. Org identity extras (cover + city) for the hero
        const [{ data: prof }, { data: orgProf }] = await Promise.all([
          supabase.from('profiles').select('city').eq('id', user.id).maybeSingle(),
          supabase.from('organizer_profiles').select('cover_url').eq('user_id', user.id).maybeSingle(),
        ]);
        setOrgCity(prof?.city ?? null);
        setOrgCover((orgProf as any)?.cover_url ?? null);

        // 1. Next upcoming event
        const { data: upcoming } = await supabase
          .from('events')
          .select('id, title, start_at, end_at, poster_url, image_url, location_name, location_city, max_tickets, partner_venue_id, venue_id')
          .or(`organizer_user_id.eq.${user.id},partner_organizer_id.eq.${user.id}`)
          .gte('end_at', new Date().toISOString())
          .order('start_at', { ascending: true })
          .limit(1);
        const next = upcoming?.[0] ?? null;
        setNextEvent(next);

        if (next) {
          const { data: nextTickets } = await supabase
            .from('tickets')
            .select('total_price, entry_scanned, quantity')
            .eq('event_id', next.id)
            .eq('status', 'paid');
          const ticketsSold = nextTickets?.reduce((s, t: any) => s + (t.quantity ?? 1), 0) ?? 0;
          const revenue = nextTickets?.reduce((s, t: any) => s + Number(t.total_price ?? 0), 0) ?? 0;
          const checkins = nextTickets?.filter((t: any) => t.entry_scanned).length ?? 0;
          const { count: tablesBooked } = await supabase
            .from('table_reservations')
            .select('id', { count: 'exact', head: true })
            .eq('event_id', next.id)
            .eq('status', 'paid');

          // Net revenue from revenue_distributions for this organizer
          const { data: distros } = await supabase
            .from('revenue_distributions')
            .select('primary_amount_cents, secondary_amount_cents, primary_recipient_organizer_id, secondary_recipient_organizer_id')
            .eq('event_id', next.id);
          let netCents = 0;
          (distros || []).forEach((d: any) => {
            if (d.primary_recipient_organizer_id === user.id) netCents += Number(d.primary_amount_cents || 0);
            else if (d.secondary_recipient_organizer_id === user.id) netCents += Number(d.secondary_amount_cents || 0);
          });
          // Fallback estimate: gross - Yuno fee (4% min 0.99 per ticket) - Stripe fee (1.5% + 0.25)
          const estimatedNet = (nextTickets || []).reduce((s: number, t: any) => {
            const total = Number(t.total_price || 0);
            const yuno = Math.max(0.99, total * 0.04);
            const stripe = total * 0.015 + 0.25;
            return s + Math.max(0, total - yuno - stripe);
          }, 0);
          const netRevenue = netCents > 0 ? netCents / 100 : estimatedNet;

          setNextStats({ ticketsSold, revenue, netRevenue, checkins, tablesBooked: tablesBooked ?? 0, capacity: next.max_tickets });
        }

        // 2. Globals 30j
        const since = subDays(new Date(), 30);
        const { data: allEvents } = await supabase
          .from('events')
          .select('id, title')
          .or(`organizer_user_id.eq.${user.id},partner_organizer_id.eq.${user.id}`);
        const eventIds = (allEvents ?? []).map(e => e.id);
        const upcomingCount = upcoming?.length ? (await supabase
          .from('events')
          .select('id', { count: 'exact', head: true })
          .or(`organizer_user_id.eq.${user.id},partner_organizer_id.eq.${user.id}`)
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
  }, [user]);

  const fillRate = nextStats?.capacity && nextStats.capacity > 0
    ? Math.min(100, Math.round((nextStats.ticketsSold / nextStats.capacity) * 100))
    : null;
  const checkinRate = nextStats && nextStats.ticketsSold > 0
    ? Math.round((nextStats.checkins / nextStats.ticketsSold) * 100)
    : 0;

  const chartData = useMemo(() => globals.daily.slice(-period), [globals.daily, period]);
  const orgName = profile?.organizationName || 'Yuno';
  const orgLogo = profile?.organizationLogoUrl || null;

  return (
    <div className="px-4 pb-12">
      {/* ─── Org Hero ──────────────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="relative -mx-4 overflow-hidden"
        style={{ height: 240, borderRadius: '0 0 22px 22px' }}
      >
        {orgCover ? (
          <img
            src={orgCover}
            alt={orgName}
            className="absolute inset-0 h-full w-full object-cover object-center"
            style={{ filter: 'brightness(0.5) saturate(1.3)' }}
          />
        ) : (
          <>
            <div
              className="absolute inset-0"
              style={{
                background: `radial-gradient(ellipse 90% 70% at 80% -10%, rgba(232,25,44,0.24) 0%, transparent 58%),
                             radial-gradient(ellipse 70% 55% at 5% 110%, rgba(232,25,44,0.14) 0%, transparent 52%),
                             linear-gradient(155deg, #130508 0%, #0a0a0c 50%, #0c0a12 100%)`,
              }}
            />
            <div className="pointer-events-none absolute -top-24 -right-24 h-80 w-80 rounded-full" style={{ background: 'rgba(232,25,44,0.16)', filter: 'blur(80px)' }} />
            <div className="pointer-events-none absolute -bottom-28 left-2 h-64 w-64 rounded-full" style={{ background: 'rgba(232,25,44,0.09)', filter: 'blur(72px)' }} />
          </>
        )}

        <div
          className="absolute inset-0"
          style={{
            background: orgCover
              ? 'linear-gradient(to top, rgba(0,0,0,0.97) 0%, rgba(0,0,0,0.52) 38%, rgba(0,0,0,0.04) 100%)'
              : 'linear-gradient(to top, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.18) 65%, transparent 100%)',
          }}
        />

        <div className="relative flex h-full flex-col justify-end px-5 pb-5">
          <div className="flex items-end justify-between gap-3">
            {/* Identity */}
            <div className="flex min-w-0 items-end gap-3.5">
              {orgLogo ? (
                <img
                  src={orgLogo}
                  alt=""
                  className="h-[58px] w-[58px] flex-shrink-0 rounded-2xl object-cover"
                  style={{ border: '1.5px solid rgba(255,255,255,0.18)', boxShadow: '0 0 0 1px rgba(0,0,0,0.55), 0 10px 32px -6px rgba(0,0,0,0.95)' }}
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
                    background: isToday ? 'rgba(232,25,44,0.13)' : 'rgba(255,255,255,0.04)',
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
        {!stripeLoading && !canSell && (
          <div className="flex items-start gap-3 rounded-xl px-4 py-3" style={{ background: 'rgba(232,25,44,0.06)', border: '1px solid rgba(232,25,44,0.22)' }}>
            <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" style={{ color: RED }} />
            <div className="flex-1 min-w-0">
              <p style={{ color: T1, fontSize: 13, fontWeight: 560 }}>{tt('Activez les paiements pour vendre', 'Activate payments to start selling')}</p>
              <p style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>
                {stripeStatus === 'pending'
                  ? tt('Onboarding Stripe incomplet.', 'Stripe onboarding incomplete.')
                  : tt('Vous pouvez créer des événements, mais pas vendre de billets sans Stripe.', 'You can create events, but selling requires Stripe.')}
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

        {/* ─── KPI tiles (30d) ──────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiTile label={tt('CA brut', 'Gross revenue')} value={`${globals.ca30.toFixed(0)} €`} subtitle={tt('30 derniers jours', 'Last 30 days')} loading={loading} />
          <KpiTile label={tt('Billets vendus', 'Tickets sold')} value={globals.tickets30} subtitle={tt('30 derniers jours', 'Last 30 days')} loading={loading} />
          <KpiTile label={tt('Acheteurs uniques', 'Unique buyers')} value={globals.uniqueBuyers30} subtitle={tt('30 derniers jours', 'Last 30 days')} loading={loading} />
          <KpiTile label={tt('Soirées à venir', 'Upcoming events')} value={globals.upcomingCount} subtitle={tt('Total', 'Total')} loading={loading} />
        </div>

        {/* ─── Revenue chart ────────────────────────────────────────────────────── */}
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
                  style={period === p ? { background: 'rgba(255,255,255,0.1)', color: T1 } : { background: 'transparent', color: T3 }}
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
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="date" hide />
                <Tooltip
                  contentStyle={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, borderRadius: 10, fontSize: 12, color: T1 }}
                  labelStyle={{ color: T3 }}
                  formatter={(v: any) => [`${Number(v).toFixed(2)} €`, tt('Revenu', 'Revenue')]}
                />
                <Area type="monotone" dataKey="revenue" stroke={RED} strokeWidth={2} fill="url(#orgRev)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* ─── Next event card ──────────────────────────────────────────────────── */}
        {nextEvent ? (
          <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, overflow: 'hidden' }}>
            <div className="grid md:grid-cols-[240px_1fr]">
              <div className="relative h-40 md:h-full" style={{ background: INNER_BG }}>
                {(nextEvent.poster_url || nextEvent.image_url) ? (
                  <img src={nextEvent.poster_url || nextEvent.image_url || ''} alt={nextEvent.title} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center" style={{ color: T3 }}>
                    <Sparkles className="h-10 w-10" />
                  </div>
                )}
                <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.65) 0%, transparent 60%)' }} />
                <span className="absolute left-3 top-3 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide" style={{ background: 'rgba(0,0,0,0.6)', color: T1, backdropFilter: 'blur(8px)' }}>
                  {tt('Prochaine soirée', 'Next event')}
                </span>
              </div>
              <div className="space-y-4 p-5">
                <div className="min-w-0">
                  <h2 className="truncate" style={{ color: T1, fontSize: 19, fontWeight: 700 }}>{nextEvent.title}</h2>
                  <div className="mt-1 flex flex-wrap items-center gap-3" style={{ color: T3, fontSize: 12 }}>
                    <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{format(new Date(nextEvent.start_at), 'PPP p', { locale })}</span>
                    {(nextEvent.location_name || nextEvent.location_city) && (
                      <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{[nextEvent.location_name, nextEvent.location_city].filter(Boolean).join(' · ')}</span>
                    )}
                  </div>
                  <p style={{ color: RED, fontSize: 11.5, marginTop: 4, fontWeight: 560 }}>
                    {tt('Dans', 'In')} {formatDistanceToNow(new Date(nextEvent.start_at), { locale })}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <MiniStat icon={Ticket} label={tt('Vendus', 'Sold')} value={nextStats?.ticketsSold ?? 0} sub={fillRate !== null ? tt(`${fillRate}% rempli`, `${fillRate}% full`, `${fillRate}% lleno`) : undefined} />
                  <MiniStat icon={TrendingUp} label={tt('Revenu', 'Revenue')} value={`${(nextStats?.revenue ?? 0).toFixed(0)} €`} sub={nextStats ? `${tt('net', 'net')} ${nextStats.netRevenue.toFixed(0)} €` : undefined} />
                  <MiniStat icon={ScanLine} label={tt('Check-ins', 'Check-ins')} value={`${checkinRate}%`} sub={`${nextStats?.checkins ?? 0}/${nextStats?.ticketsSold ?? 0}`} />
                  <MiniStat icon={Wine} label={tt('Tables', 'Tables')} value={nextStats?.tablesBooked ?? 0} />
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  <Link to={`/organizer-app/events/${nextEvent.id}`} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold" style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.25)', color: '#FF5C63' }}>
                    {tt('Gérer', 'Manage')}
                  </Link>
                  <Link to="/organizer-app/checkin" className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium" style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T2 }}>
                    <ScanLine className="h-3.5 w-3.5" />Check-in
                  </Link>
                  <Link to="/organizer-app/analytics" className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium" style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T2 }}>
                    <Activity className="h-3.5 w-3.5" />{tt('Analytique', 'Analytics')}
                  </Link>
                </div>
              </div>
            </div>
          </div>
        ) : (
          !loading && (
            <div className="px-4 py-12 text-center" style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW }}>
              <CalendarDays className="mx-auto mb-3 h-10 w-10" style={{ color: 'rgba(255,255,255,0.14)' }} />
              <p style={{ color: T1, fontSize: 14, fontWeight: 560 }}>{tt('Aucune soirée à venir', 'No upcoming event')}</p>
              <p style={{ color: T3, fontSize: 12, marginTop: 4, marginBottom: 16 }}>{tt('Créez une soirée pour commencer.', 'Create an event to get started.')}</p>
              <Link to="/organizer-app/events?create=1" className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-semibold" style={{ background: RED, color: '#fff', boxShadow: `0 0 20px -6px ${RED}88` }}>
                <Plus className="h-4 w-4" />{tt('Créer un événement', 'Create event')}
              </Link>
            </div>
          )
        )}

        {/* ─── Top events ───────────────────────────────────────────────────────── */}
        {topEvents.length > 0 && (
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

function MiniStat({ icon: Icon, label, value, sub }: { icon: any; label: string; value: number | string; sub?: string }) {
  return (
    <div className="rounded-xl p-3" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
      <div className="mb-1 flex items-center justify-between">
        <span style={{ color: T3, fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}</span>
        <Icon className="h-3.5 w-3.5" style={{ color: RED }} />
      </div>
      <div style={{ color: T1, fontSize: 19, fontWeight: 700 }}>{value}</div>
      {sub && <div style={{ color: T3, fontSize: 10.5, marginTop: 1 }}>{sub}</div>}
    </div>
  );
}
