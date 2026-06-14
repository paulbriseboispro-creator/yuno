import { useEffect, useState, useMemo, useId } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Area, AreaChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import {
  MapPin, CalendarDays, TrendingUp, TrendingDown, Minus, AlertTriangle, Plus, ArrowRight,
  CalendarOff, Eye, MousePointerClick, Store, Sparkles, ExternalLink, CalendarPlus, BarChart2, Link2,
} from 'lucide-react';
import { format, subDays, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  AffPage, AffCard, AffCardHeader, Pill, AffLinkButton, AffSpinner, AffEmpty,
  RED, POS, NEG, T1, T2, T3, C_HI, BORDER, F_BORDER, C_FAINT, INNER_BG, TILE_BG, CARD_BG, CARD_SHADOW,
} from '@/components/affiliate/affiliate-ui';

type NextEvent = {
  id: string;
  name: string;
  event_date: string;
  flyer_url: string | null;
  external_ticket_url: string | null;
  status: string;
  affiliate_venues: { name: string } | null;
};

type DailyPoint = { date: string; clicks: number; views: number };

const STATUS_TONE: Record<string, 'muted' | 'success' | 'warn'> = { draft: 'muted', published: 'success', featured: 'warn' };
const STATUS_LABEL: Record<string, string> = { draft: 'Brouillon', published: 'Publiée', featured: 'À la une' };

function InlineDelta({ value }: { value: number }) {
  const isPos = value > 0.05;
  const isNeg = value < -0.05;
  const color = isPos ? POS : isNeg ? NEG : T3;
  const Icon = isPos ? TrendingUp : isNeg ? TrendingDown : Minus;
  return (
    <span style={{ color, display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 650, fontVariantNumeric: 'tabular-nums' }}>
      <Icon style={{ width: 11, height: 11 }} />{isPos ? '+' : ''}{value.toFixed(0)}%
    </span>
  );
}

export default function AffiliateDashboard() {
  const { user } = useAuth();
  const [aff, setAff] = useState<{ id: string; name: string; city: string | null; avatar_url: string | null } | null>(null);
  const [venueCount, setVenueCount] = useState(0);
  const [eventCount, setEventCount] = useState(0);
  const [missingTicketUrl, setMissingTicketUrl] = useState(0);
  const [clicks30, setClicks30] = useState(0);
  const [clicksPrev30, setClicksPrev30] = useState(0);
  const [views30, setViews30] = useState(0);
  const [viewsPrev30, setViewsPrev30] = useState(0);
  const [daily, setDaily] = useState<DailyPoint[]>([]);
  const [upcoming, setUpcoming] = useState<NextEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) fetchData();
  }, [user]);

  const fetchData = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data: affRow } = await supabase
        .from('affiliates')
        .select('id, name, city, avatar_url')
        .eq('user_id', user.id)
        .single();
      if (!affRow) { setLoading(false); return; }
      setAff(affRow as any);

      const today = new Date().toISOString().split('T')[0];
      const since30 = subDays(new Date(), 30).toISOString();
      const since60 = subDays(new Date(), 60).toISOString();

      const [
        { count: venueC },
        { count: eventC },
        { count: missingC },
        { data: clickRows },
        { data: sessRows },
        { data: upcomingEvents },
      ] = await Promise.all([
        supabase.from('affiliate_venues').select('*', { count: 'exact', head: true }).eq('affiliate_id', affRow.id).eq('is_active', true),
        supabase.from('affiliate_events').select('*', { count: 'exact', head: true }).eq('affiliate_id', affRow.id).gte('event_date', today),
        supabase.from('affiliate_events').select('*', { count: 'exact', head: true }).eq('affiliate_id', affRow.id).gte('event_date', today).is('external_ticket_url', null),
        supabase.from('affiliate_clicks').select('clicked_at').eq('affiliate_id', affRow.id).gte('clicked_at', since60).limit(20000),
        (supabase.from('affiliate_visitor_sessions') as any).select('visited_at').eq('affiliate_id', affRow.id).eq('is_internal', false).gte('visited_at', since60).limit(20000),
        supabase.from('affiliate_events')
          .select('id, name, event_date, flyer_url, external_ticket_url, status, affiliate_venues(name)')
          .eq('affiliate_id', affRow.id)
          .gte('event_date', today)
          .order('event_date', { ascending: true })
          .limit(6),
      ]);

      setVenueCount(venueC ?? 0);
      setEventCount(eventC ?? 0);
      setMissingTicketUrl(missingC ?? 0);
      setUpcoming((upcomingEvents ?? []) as NextEvent[]);

      const clicks = (clickRows ?? []).map((r: any) => r.clicked_at as string);
      const views = (sessRows ?? []).map((r: any) => r.visited_at as string);

      const inLast30 = (iso: string) => iso >= since30;
      const inPrev30 = (iso: string) => iso >= since60 && iso < since30;
      setClicks30(clicks.filter(inLast30).length);
      setClicksPrev30(clicks.filter(inPrev30).length);
      setViews30(views.filter(inLast30).length);
      setViewsPrev30(views.filter(inPrev30).length);

      // Daily buckets (last 30 days)
      const cMap: Record<string, number> = {};
      const vMap: Record<string, number> = {};
      for (let i = 29; i >= 0; i--) {
        const d = format(subDays(new Date(), i), 'yyyy-MM-dd');
        cMap[d] = 0; vMap[d] = 0;
      }
      clicks.forEach(iso => { const d = iso.slice(0, 10); if (cMap[d] !== undefined) cMap[d]++; });
      views.forEach(iso => { const d = iso.slice(0, 10); if (vMap[d] !== undefined) vMap[d]++; });
      setDaily(Object.keys(cMap).map(date => ({ date, clicks: cMap[date], views: vMap[date] })));
    } finally {
      setLoading(false);
    }
  };

  const calcChange = (c: number, p: number) => (p === 0 ? (c > 0 ? 100 : 0) : ((c - p) / p) * 100);
  const nextEvent = upcoming[0] ?? null;

  if (loading) return <AffSpinner />;

  return (
    <AffPage>
      {/* ─── Hero ─────────────────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        className="relative overflow-hidden"
        style={{
          background: `radial-gradient(ellipse 70% 60% at 88% -20%, rgba(232,25,44,0.12) 0%, transparent 62%),
            linear-gradient(180deg,rgba(255,255,255,.03) 0%,rgba(255,255,255,.005) 100%),#0a0a0c`,
          border: `1px solid ${BORDER}`, borderRadius: 20, boxShadow: CARD_SHADOW,
        }}
      >
        <div className="pointer-events-none absolute -top-16 -right-12 w-56 h-56 rounded-full" style={{ background: 'rgba(232,25,44,0.10)', filter: 'blur(60px)' }} />
        <div className="relative flex items-center justify-between gap-4 flex-wrap" style={{ padding: 22 }}>
          <div className="flex items-center gap-4 min-w-0">
            {aff?.avatar_url ? (
              <img src={aff.avatar_url} alt="" className="h-14 w-14 rounded-2xl object-cover flex-none" style={{ border: '1.5px solid rgba(255,255,255,0.18)' }} />
            ) : (
              <div className="h-14 w-14 rounded-2xl flex items-center justify-center flex-none" style={{ background: 'rgba(232,25,44,0.16)', border: '1.5px solid rgba(232,25,44,0.3)' }}>
                <Store className="h-6 w-6" style={{ color: RED }} />
              </div>
            )}
            <div className="min-w-0">
              <h1 className="truncate" style={{ color: T1, fontSize: 'clamp(20px,2.6vw,26px)', fontWeight: 720, letterSpacing: '-0.02em', margin: 0 }}>
                {aff?.name ?? 'Espace affilié'}
              </h1>
              <p style={{ color: T3, fontSize: 13, marginTop: 3 }}>
                {aff?.city ? `${aff.city} · ` : ''}Tableau de bord affilié
              </p>
            </div>
          </div>

          {/* Next event mini card */}
          {nextEvent && (() => {
            const evDate = parseISO(nextEvent.event_date);
            const isToday = nextEvent.event_date === new Date().toISOString().split('T')[0];
            return (
              <div className="flex-none rounded-2xl px-4 py-3"
                style={{ background: isToday ? 'rgba(232,25,44,0.13)' : 'rgba(255,255,255,0.04)', border: `1px solid ${isToday ? 'rgba(232,25,44,0.3)' : BORDER}`, minWidth: 120 }}>
                <div className="flex items-center gap-1.5 mb-1.5">
                  {isToday && <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: RED }} />}
                  <span style={{ color: isToday ? RED : T3, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                    {isToday ? "Ce soir" : 'Prochaine'}
                  </span>
                </div>
                <div className="tabular-nums" style={{ color: T1, fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1 }}>
                  {format(evDate, 'd MMM', { locale: fr })}
                </div>
                <div className="truncate" style={{ color: T3, fontSize: 10.5, marginTop: 4, maxWidth: 140 }}>{nextEvent.name}</div>
              </div>
            );
          })()}
        </div>
      </motion.div>

      {/* Alert: missing ticket URLs */}
      {missingTicketUrl > 0 && (
        <Link to="/affiliate/events" className="block">
          <div className="flex items-center justify-between gap-3 rounded-2xl px-4 py-3.5"
            style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.22)' }}>
            <div className="flex items-center gap-3 min-w-0">
              <AlertTriangle className="h-4 w-4 flex-none" style={{ color: '#FBBF24' }} />
              <span style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>
                {missingTicketUrl} soirée{missingTicketUrl > 1 ? 's' : ''} sans lien billetterie
              </span>
            </div>
            <span style={{ color: T3, fontSize: 11.5 }}>Corriger →</span>
          </div>
        </Link>
      )}

      {/* ─── Dashboard grid ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={MapPin} label="Clubs actifs" value={venueCount} hint="partenaires" to="/affiliate/venues" />
        <StatCard icon={CalendarDays} label="Soirées à venir" value={eventCount} hint="à l'affiche" to="/affiliate/events" />
        <StatCard icon={MousePointerClick} label="Clics (30 j)" value={clicks30.toLocaleString()} delta={calcChange(clicks30, clicksPrev30)} tone="red" to="/affiliate/analytics" />
        <StatCard icon={Eye} label="Vues (30 j)" value={views30.toLocaleString()} delta={calcChange(views30, viewsPrev30)} to="/affiliate/analytics" />
      </div>

      {/* Trend chart */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }}>
        <TrendChart data={daily} />
      </motion.div>

      {/* Next event hero + quick actions */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-3">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.24 }}>
          <NextEventHero nextEvent={nextEvent} />
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <QuickActions />
        </motion.div>
      </div>

      {/* Upcoming events */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.36 }}>
        <AffCard padding={20}>
          <AffCardHeader
            icon={CalendarDays}
            title="Prochaines soirées"
            subtitle="Les 6 dates à venir"
            right={
              <Link to="/affiliate/events" className="inline-flex items-center gap-1 text-[12.5px] font-medium transition-colors" style={{ color: T2 }}
                onMouseEnter={(e) => (e.currentTarget.style.color = T1)} onMouseLeave={(e) => (e.currentTarget.style.color = T2)}>
                Voir tout <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            }
          />
          {upcoming.length === 0 ? (
            <AffEmpty icon={CalendarOff} title="Aucune soirée à venir"
              description="Créez votre première soirée pour la voir apparaître ici."
              action={<AffLinkButton to="/affiliate/events/new" size="sm"><Plus className="h-4 w-4" /> Nouvelle soirée</AffLinkButton>} />
          ) : (
            <div className="divide-y" style={{ borderColor: BORDER }}>
              {upcoming.map((event, i) => (
                <motion.div key={event.id}
                  initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.4 + i * 0.04 }}
                  className="flex items-center gap-4 py-3">
                  <div className="w-12 flex-none text-center rounded-xl py-1.5" style={{ background: C_FAINT, border: `1px solid ${BORDER}` }}>
                    <p style={{ color: T3, fontSize: 9.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{format(parseISO(event.event_date), 'MMM', { locale: fr })}</p>
                    <p className="tabular-nums" style={{ color: T1, fontSize: 18, fontWeight: 700, lineHeight: 1 }}>{format(parseISO(event.event_date), 'd')}</p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{event.name}</p>
                    <p className="truncate" style={{ color: T3, fontSize: 11.5, marginTop: 1 }}>{event.affiliate_venues?.name ?? 'Sans club'}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-none">
                    {!event.external_ticket_url && <AlertTriangle className="h-3.5 w-3.5" style={{ color: '#FBBF24' }} aria-label="Lien ticket manquant" />}
                    <Pill tone={STATUS_TONE[event.status] ?? 'muted'}>{STATUS_LABEL[event.status] ?? event.status}</Pill>
                    <Link to={`/affiliate/events/${event.id}/edit`} className="text-[12px] font-medium transition-colors hidden sm:inline" style={{ color: T3 }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = RED)} onMouseLeave={(e) => (e.currentTarget.style.color = T3)}>Éditer</Link>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </AffCard>
      </motion.div>
    </AffPage>
  );
}

// ─── Stat card (with optional delta + link) ───────────────────────────────────
function StatCard({ icon: Icon, label, value, hint, delta, tone, to }: {
  icon: any; label: string; value: React.ReactNode; hint?: string; delta?: number; tone?: 'red'; to?: string;
}) {
  const inner = (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '18px 20px', height: '100%' }}>
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 flex items-center justify-center rounded-lg flex-none" style={{ background: C_FAINT, border: `1px solid ${BORDER}` }}>
          <Icon className="w-3.5 h-3.5" style={{ color: tone === 'red' ? RED : T2 }} />
        </div>
        <span style={{ color: T3, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}</span>
      </div>
      <p className="tabular-nums" style={{ color: T1, fontSize: 'clamp(22px,2.6vw,28px)', fontWeight: 640, letterSpacing: '-0.025em', lineHeight: 1 }}>{value}</p>
      <div className="flex items-center gap-1.5 mt-2.5">
        {delta !== undefined ? <InlineDelta value={delta} /> : null}
        {hint && <span style={{ color: T3, fontSize: 11 }}>{hint}</span>}
      </div>
    </div>
  );
  return to ? <Link to={to} className="block h-full">{inner}</Link> : inner;
}

// ─── Trend chart (clics + vues, 30 days) ──────────────────────────────────────
function TrendTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, borderRadius: 10, padding: '10px 14px' }}>
      <p style={{ color: T3, fontSize: 11, marginBottom: 4 }}>{format(parseISO(String(label)), 'd MMM', { locale: fr })}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} className="tabular-nums" style={{ color: p.dataKey === 'clicks' ? RED : C_HI, fontSize: 13, fontWeight: 620 }}>
          {p.dataKey === 'clicks' ? 'Clics' : 'Vues'} : {p.value}
        </p>
      ))}
    </div>
  );
}

function TrendChart({ data }: { data: DailyPoint[] }) {
  const uid = useId().replace(/:/g, '');
  const totalClicks = useMemo(() => data.reduce((s, d) => s + d.clicks, 0), [data]);
  const totalViews = useMemo(() => data.reduce((s, d) => s + d.views, 0), [data]);
  const hasData = totalClicks > 0 || totalViews > 0;

  return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '20px 22px', overflow: 'hidden' }}>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', margin: 0 }}>Vues & clics — 30 jours</h3>
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-1.5" style={{ color: T3, fontSize: 11.5 }}>
            <span className="w-2 h-2 rounded-sm" style={{ background: RED }} /> {totalViews.toLocaleString()} vues
          </span>
          <span className="inline-flex items-center gap-1.5" style={{ color: T3, fontSize: 11.5 }}>
            <span className="w-2 h-2 rounded-sm" style={{ background: C_HI }} /> {totalClicks.toLocaleString()} clics
          </span>
        </div>
      </div>

      {!hasData ? (
        <div className="text-center py-10" style={{ color: T3, fontSize: 13 }}>Pas encore de données sur cette période.</div>
      ) : (
        <div style={{ width: '100%', height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ left: 0, right: 0, top: 8, bottom: 0 }}>
              <defs>
                <linearGradient id={`v-${uid}`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={RED} stopOpacity={0.26} />
                  <stop offset="100%" stopColor={RED} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid horizontal={false} strokeDasharray="2 2" stroke="rgba(255,255,255,0.055)" />
              <XAxis dataKey="date" axisLine={false} tickLine={false} tickMargin={8} minTickGap={28}
                tickFormatter={(v) => format(parseISO(String(v)), 'd/MM')} tick={{ fill: 'rgba(255,255,255,0.36)', fontSize: 10.5 }} />
              <YAxis hide />
              <Tooltip content={<TrendTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.08)', strokeWidth: 1 }} />
              <Area dataKey="views" type="monotone" stroke={RED} strokeWidth={2} fill={`url(#v-${uid})`} dot={false} />
              <Line dataKey="clicks" type="monotone" stroke={C_HI} strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="flex justify-end mt-3">
        <Link to="/affiliate/analytics" className="inline-flex items-center gap-1 text-[11.5px] font-medium" style={{ color: T3 }}>
          Voir les analytics <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}

// ─── Next event hero ──────────────────────────────────────────────────────────
function NextEventHero({ nextEvent }: { nextEvent: NextEvent | null }) {
  if (!nextEvent) {
    return (
      <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '40px 22px', textAlign: 'center', height: '100%' }}>
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl" style={{ background: C_FAINT, border: `1px solid ${BORDER}` }}>
          <CalendarDays className="h-6 w-6" style={{ color: T3 }} />
        </div>
        <h3 style={{ color: T1, fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Aucune soirée à venir</h3>
        <p style={{ color: T3, fontSize: 13, marginBottom: 20 }}>Créez votre première soirée pour démarrer.</p>
        <AffLinkButton to="/affiliate/events/new" size="sm"><Plus className="h-4 w-4" /> Nouvelle soirée</AffLinkButton>
      </div>
    );
  }

  return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, overflow: 'hidden', height: '100%' }}>
      <div className="grid sm:grid-cols-[180px_1fr] h-full">
        <div className="relative h-40 sm:h-full min-h-[150px]" style={{ background: INNER_BG }}>
          {nextEvent.flyer_url ? (
            <img src={nextEvent.flyer_url} alt={nextEvent.name} className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center" style={{ color: T3 }}><Sparkles className="h-10 w-10" /></div>
          )}
          <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 60%)' }} />
          <span className="absolute top-3 left-3 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider"
            style={{ background: 'rgba(0,0,0,0.75)', border: `1px solid ${BORDER}`, color: T2 }}>Prochaine soirée</span>
        </div>

        <div style={{ padding: '18px 20px' }} className="flex flex-col justify-between gap-4">
          <div>
            <h2 style={{ color: T1, fontSize: 17, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.2 }}>{nextEvent.name}</h2>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <span className="flex items-center gap-1" style={{ color: T3, fontSize: 12 }}>
                <CalendarDays className="h-3 w-3" />{format(parseISO(nextEvent.event_date), 'PPP', { locale: fr })}
              </span>
              {nextEvent.affiliate_venues?.name && <span style={{ color: T3, fontSize: 12 }}>· {nextEvent.affiliate_venues.name}</span>}
            </div>
            <div className="mt-3"><Pill tone={STATUS_TONE[nextEvent.status] ?? 'muted'}>{STATUS_LABEL[nextEvent.status] ?? nextEvent.status}</Pill></div>
          </div>

          <div className="flex flex-wrap gap-2">
            <AffLinkButton to={`/affiliate/events/${nextEvent.id}/edit`} size="sm">Gérer</AffLinkButton>
            {nextEvent.external_ticket_url
              ? <AffLinkButton href={nextEvent.external_ticket_url} external variant="secondary" size="sm"><ExternalLink className="h-3.5 w-3.5" /> Billetterie</AffLinkButton>
              : <AffLinkButton to={`/affiliate/events/${nextEvent.id}/edit`} variant="danger" size="sm"><AlertTriangle className="h-3.5 w-3.5" /> Ajouter le lien</AffLinkButton>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Quick actions ────────────────────────────────────────────────────────────
function QuickActions() {
  const actions = [
    { title: 'Nouvelle soirée', desc: 'Créer une soirée', to: '/affiliate/events/new', Icon: CalendarPlus },
    { title: 'Nouveau club', desc: 'Ajouter un club partenaire', to: '/affiliate/venues/new', Icon: Store },
    { title: 'Analytics', desc: 'Clics, vues & sources', to: '/affiliate/analytics', Icon: BarChart2 },
    { title: 'Mon Linktree agence', desc: 'Page publique', to: '/affiliate/settings', Icon: Link2 },
  ];
  return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '20px 22px', height: '100%' }}>
      <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', marginBottom: 14 }}>Actions rapides</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {actions.map(a => (
          <Link key={a.to} to={a.to} className="flex items-center gap-3 rounded-xl transition-all"
            style={{ padding: '10px 12px', textDecoration: 'none', background: TILE_BG, border: `1px solid ${F_BORDER}` }}>
            <div className="flex-none h-8 w-8 flex items-center justify-center rounded-lg" style={{ background: C_FAINT, border: `1px solid ${F_BORDER}` }}>
              <a.Icon className="h-4 w-4" style={{ color: T2 }} />
            </div>
            <div className="flex-1 min-w-0">
              <p style={{ color: T1, fontSize: 13, fontWeight: 560 }}>{a.title}</p>
              <p className="truncate" style={{ color: T3, fontSize: 11, marginTop: 1 }}>{a.desc}</p>
            </div>
            <ArrowRight className="h-4 w-4 flex-none" style={{ color: T3 }} />
          </Link>
        ))}
      </div>
    </div>
  );
}
