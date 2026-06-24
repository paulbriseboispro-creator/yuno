import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { OwnerHeader } from '@/components/OwnerHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ArrowLeft, Handshake, Lock, Eye, Ticket, Wine, FileText, Megaphone,
  Clock, ExternalLink, Users, TrendingUp, Euro, Radio, Sparkles, Trophy,
  UsersRound, ChevronDown, UserPlus, ScanLine,
} from 'lucide-react';
import { useEventNetGain } from '@/hooks/useEventNetGain';
import { formatInTimeZone } from 'date-fns-tz';
import { PARIS_TIMEZONE } from '@/lib/timezone';
import { fr } from 'date-fns/locale';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { PurchaseSourceBreakdown } from '@/components/analytics/PurchaseSourceBreakdown';
import { OwnerTicketOrders } from '@/components/owner/OwnerTicketOrders';
import { OwnerVipOrders } from '@/components/owner/OwnerVipOrders';
import { OwnerDrinkOrders } from '@/components/owner/OwnerDrinkOrders';
import { EventGuestListModule } from '@/components/owner/co-event/EventGuestListModule';
import { EventInvoicesModule } from '@/components/owner/co-event/EventInvoicesModule';
import { EventLiveModule } from '@/components/owner/co-event/EventLiveModule';
import { EventPostAnalysisView } from '@/components/owner/co-event/EventPostAnalysisView';
import { EventAudienceDemographics } from '@/components/analytics/EventAudienceDemographics';
import { SplitContractBanner } from '@/components/SplitContractBanner';
import { CollabConversionClose } from '@/components/collab/CollabConversionClose';
import { normalizeSplitRules } from '@/lib/splitRules';

type Phase = 'before' | 'live' | 'after';

interface EventData {
  id: string;
  title: string;
  description: string | null;
  poster_url: string | null;
  start_at: string;
  end_at: string;
  is_active: boolean;
  organizer_user_id: string | null;
  partner_organizer_id: string | null;
  venue_id: string | null;
  partner_venue_id: string | null;
  event_mode: string | null;
  revenue_split_rules: any;
  split_locked_at: string | null;
}

interface PartnerProfile {
  display_name: string | null;
  avatar_url: string | null;
  slug: string | null;
}

interface VenueLite {
  id: string;
  name: string;
}

function computePhase(startAt: string, endAt: string): Phase {
  const now = Date.now();
  const start = new Date(startAt).getTime();
  const end = new Date(endAt).getTime();
  if (Number.isFinite(start) && now < start) return 'before';
  if (Number.isFinite(end) && now <= end) return 'live';
  return 'after';
}

export default function OwnerCollabEventDashboard() {
  const { eventId } = useParams<{ eventId: string }>();
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const tt = (frv: string, en: string, es?: string) => translate(language, frv, en, es);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Legacy deep-links from the collaborations hub (?tab=tickets|tables|guestlist|
  // invoices|scans|promoters) used to open a dedicated tab. The vitrine folds all
  // operational data into one drawer — honor those links by opening it on arrival.
  const opsDeepLink = ['tickets', 'tables', 'guestlist', 'invoices', 'scans', 'promoters'].includes(params.get('tab') ?? '');

  const [event, setEvent] = useState<EventData | null>(null);
  const [organizer, setOrganizer] = useState<PartnerProfile | null>(null);
  const [leadVenue, setLeadVenue] = useState<VenueLite | null>(null);
  const [myVenue, setMyVenue] = useState<VenueLite | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !eventId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      // 1. Find this owner's venue (id + name for the partnership framing)
      const { data: v } = await supabase
        .from('venues').select('id, name').eq('owner_id', user.id).limit(1).maybeSingle();
      if (cancelled) return;
      if (v) setMyVenue(v as VenueLite);

      // 2. Fetch event (RLS allows lead, partner_venue_owner, or partner_organizer)
      const { data: ev, error: evErr } = await supabase
        .from('events')
        .select('id, title, description, poster_url, start_at, end_at, is_active, organizer_user_id, partner_organizer_id, venue_id, partner_venue_id, event_mode, revenue_split_rules, split_locked_at')
        .eq('id', eventId)
        .maybeSingle();
      if (cancelled) return;

      if (evErr || !ev) {
        setError(t('collabDash.notFound'));
        setLoading(false);
        return;
      }
      setEvent(ev as EventData);

      // 3. Lead organizer profile (the collaborating identity)
      const orgId = ev.organizer_user_id ?? ev.partner_organizer_id;
      if (orgId) {
        const { data: prof } = await supabase
          .from('organizer_profiles' as any)
          .select('display_name, avatar_url, slug')
          .eq('user_id', orgId)
          .maybeSingle();
        if (!cancelled) setOrganizer((prof as unknown) as PartnerProfile);
      }

      // 4. Lead venue if relevant
      if (ev.venue_id) {
        const { data: lv } = await supabase
          .from('venues').select('id, name').eq('id', ev.venue_id).maybeSingle();
        if (!cancelled) setLeadVenue(lv as VenueLite);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user, eventId]);

  const myVenueId = myVenue?.id ?? null;

  const role = useMemo(() => {
    if (!event || !myVenueId) return 'unknown';
    if (event.venue_id === myVenueId) return 'lead_venue';
    if (event.partner_venue_id === myVenueId) return 'partner_venue';
    return 'unknown';
  }, [event, myVenueId]);

  const phase = useMemo<Phase>(() => (event ? computePhase(event.start_at, event.end_at) : 'before'), [event]);

  if (loading) {
    return (
      <div className="min-h-screen dashboard-gradient-bg">
        <OwnerHeader title={t('collabDash.title')} />
        <div className="container mx-auto px-4 py-6 max-w-5xl space-y-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="min-h-screen dashboard-gradient-bg">
        <OwnerHeader title={t('collabDash.title')} />
        <div className="container mx-auto px-4 py-6 max-w-5xl">
          <Card className="p-8 text-center">
            <p className="text-muted-foreground">{error ?? t('common.error')}</p>
            <Button variant="outline" className="mt-4" onClick={() => navigate('/owner/collaborations')}>
              <ArrowLeft className="h-4 w-4 mr-2" /> {t('owner.cdash.backToCollabs')}
            </Button>
          </Card>
        </div>
      </div>
    );
  }

  const orgName = organizer?.display_name ?? t('partnerships.organizerRole');
  const clubName = myVenue?.name ?? leadVenue?.name ?? tt('Votre club', 'Your club', 'Tu club');
  const isPartnerVenue = role === 'partner_venue';

  const phaseChip =
    phase === 'before' ? { label: tt('À venir', 'Upcoming', 'Próximo'), cls: 'border-primary/30 text-primary' }
    : phase === 'live' ? { label: tt('En direct', 'Live', 'En directo'), cls: 'border-emerald-500/40 text-emerald-400' }
    : { label: tt('Terminée', 'Ended', 'Finalizado'), cls: 'border-white/20 text-muted-foreground' };

  return (
    <div className="min-h-screen dashboard-gradient-bg">
      <OwnerHeader title={t('collabDash.title')} />
      <div className="container mx-auto px-3 sm:px-4 py-4 sm:py-6 max-w-5xl space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate('/owner/collaborations')} className="gap-1.5 -ml-2">
          <ArrowLeft className="h-4 w-4" /> Collaborations
        </Button>

        {/* ── PARTNERSHIP HERO — the "shared space" framing ────────────────── */}
        <Card className="owner-card border-0 overflow-hidden">
          <div className="flex flex-col sm:flex-row gap-4 p-4 sm:p-6">
            {event.poster_url && (
              <img
                src={event.poster_url}
                alt={event.title}
                className="w-full sm:w-32 h-44 sm:h-44 rounded-xl object-cover flex-shrink-0"
              />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 mb-2">
                <Badge variant="outline" className="border-primary/30 text-primary gap-1">
                  <Handshake className="h-3 w-3" /> {t('coInv.modeCoEvent')}
                </Badge>
                <Badge variant="outline" className={`gap-1 ${phaseChip.cls}`}>
                  {phase === 'live' && (
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                    </span>
                  )}
                  {phaseChip.label}
                </Badge>
                {event.split_locked_at && (
                  <Badge variant="outline" className="gap-1 text-[10px]">
                    <Lock className="h-2.5 w-2.5" /> {t('collabDash.splitLocked')}
                  </Badge>
                )}
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold leading-tight">{event.title}</h1>

              {/* Collaborating identities — club ↔ organizer */}
              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.04] border border-white/[0.08] px-2.5 py-1">
                  <Users className="h-3.5 w-3.5 text-primary" />
                  <span className="font-medium truncate max-w-[40vw]">{clubName}</span>
                </span>
                <Handshake className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.04] border border-white/[0.08] px-2.5 py-1">
                  <Megaphone className="h-3.5 w-3.5 text-primary" />
                  {organizer?.slug ? (
                    <Link to={`/o/${organizer.slug}`} className="font-medium hover:underline inline-flex items-center gap-1 truncate max-w-[40vw]">
                      {orgName} <ExternalLink className="h-3 w-3" />
                    </Link>
                  ) : <span className="font-medium truncate max-w-[40vw]">{orgName}</span>}
                </span>
              </div>

              <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                {formatInTimeZone(new Date(event.start_at), PARIS_TIMEZONE, "EEEE d MMM yyyy · HH'h'mm", { locale: fr })}
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm" className="text-xs">
                  <Link to={`/event/${event.id}`}>
                    <Eye className="h-3 w-3 mr-1" /> {t('owner.cdash.publicPage')}
                  </Link>
                </Button>
              </div>
            </div>
          </div>
          {isPartnerVenue && (
            <div className="border-t border-primary/20 bg-primary/5 px-4 py-2.5 flex items-center gap-2 text-xs">
              <Lock className="h-3.5 w-3.5 text-primary flex-shrink-0" />
              <span className="text-muted-foreground">
                {t('collabDash.metaPre')} <span className="text-foreground font-medium">{orgName}</span>.
                {' '}{t('collabDash.metaPost')}
              </span>
            </div>
          )}
        </Card>

        {/* ── CONTRACT — trust + sign action, kept high ────────────────────── */}
        <SplitContractBanner eventId={event.id} side="venue" />

        {/* ── HEADLINE — phase-aware money hook ────────────────────────────── */}
        <VitrineHeadline eventId={event.id} venueId={myVenueId} phase={phase} />

        {/* ── AUDIENCE — the differentiator, promoted to headline ──────────── */}
        {myVenueId && (
          <Section
            icon={UsersRound}
            title={tt('Qui est venu', 'Who showed up', 'Quién vino')}
            sub={tt('Âge, sexe et villes de votre public — agrégé et anonyme.', "Your crowd's age, gender and cities — aggregated and anonymous.", 'Edad, sexo y ciudades de tu público, agregado y anónimo.')}
          >
            <EventAudienceDemographics scope={{ kind: 'venue', id: myVenueId }} eventId={event.id} />
          </Section>
        )}

        {/* ── PHASE-SPECIFIC: live pulse OR post-event verdict ─────────────── */}
        {phase === 'live' && (
          <Section
            icon={Radio}
            title={tt('En direct', 'Live now', 'En directo')}
            sub={tt('Ventes, scans et affluence en temps réel.', 'Sales, scans and crowd in real time.', 'Ventas, escaneos y aforo en tiempo real.')}
          >
            <EventLiveModule eventId={event.id} venueId={event.venue_id ?? event.partner_venue_id} />
          </Section>
        )}
        {phase === 'after' && myVenueId && (
          <Section
            icon={Trophy}
            title={tt('Le verdict', 'The verdict', 'El veredicto')}
            sub={tt('Cette soirée a-t-elle été un succès ?', 'Was this night a success?', '¿Fue un éxito esta noche?')}
          >
            <EventPostAnalysisView key={event.id} eventId={event.id} venueId={myVenueId} />
          </Section>
        )}

        {/* ── PROOF — acquisition + split, the narrated result ─────────────── */}
        <Section
          icon={TrendingUp}
          title={tt('La soirée en preuve', 'The night, proven', 'La noche, en pruebas')}
          sub={tt("D'où viennent les ventes et comment le revenu se partage.", 'Where the sales come from and how revenue splits.', 'De dónde vienen las ventas y cómo se reparte el ingreso.')}
        >
          <Card className="owner-card border-0">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" /> {t('collabDash.salesBreakdown')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <PurchaseSourceBreakdown eventId={event.id} />
            </CardContent>
          </Card>
          {event.revenue_split_rules && (
            <Card className="owner-card border-0">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Euro className="h-4 w-4 text-primary" /> {t('collabDash.revenueSplitContract')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <SplitContractView rules={event.revenue_split_rules} />
              </CardContent>
            </Card>
          )}
        </Section>

        {/* ── CONVERSION CLOSE — only for clubs on the free collab plan ─────── */}
        <CollabConversionClose venueName={myVenue?.name} phase={phase} />

        {/* ── DETAILS — all operational tables behind one drawer ───────────── */}
        <DetailsDrawer eventId={event.id} isPartnerVenue={isPartnerVenue} initialOpen={opsDeepLink} />
      </div>
    </div>
  );
}

/* =========================================================================
 * SECTION WRAPPER — consistent chapter header (icon + title + subtitle)
 * ========================================================================= */
function Section({ icon: Icon, title, sub, children }: { icon: any; title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 flex items-center justify-center rounded-xl flex-none" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.085)' }}>
          <Icon className="w-4 h-4 text-primary" />
        </div>
        <div>
          <h2 className="text-base font-bold leading-tight tracking-tight">{title}</h2>
          {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

/* =========================================================================
 * HEADLINE — phase-aware money hook (net gain front and center) + KPI strip
 * ========================================================================= */
function VitrineHeadline({ eventId, venueId, phase }: { eventId: string; venueId: string | null; phase: Phase }) {
  const { t, language } = useLanguage();
  const tt = (frv: string, en: string, es?: string) => translate(language, frv, en, es);
  const [data, setData] = useState<{
    ticketRevenue: number; ticketsSold: number; ticketsScanned: number;
    tableRevenue: number; tablesBooked: number;
    glEntries: number; glScanned: number;
  } | null>(null);

  const netGain = useEventNetGain(
    venueId ? eventId : null,
    { kind: 'venue', venueId: venueId || '' },
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [tk, tr, gl] = await Promise.all([
        supabase.from('tickets').select('total_price, quantity, entry_scanned, status').eq('event_id', eventId).eq('status', 'paid'),
        supabase.from('table_reservations').select('total_price, status').eq('event_id', eventId).eq('status', 'confirmed'),
        supabase.from('guest_list_entries').select('id, entry_scanned, guest_lists!inner(event_id)').eq('guest_lists.event_id', eventId),
      ]);
      if (cancelled) return;
      const tickets = tk.data || [];
      const reservations = tr.data || [];
      const entries = (gl.data || []) as any[];
      setData({
        ticketRevenue: tickets.reduce((a, x: any) => a + Number(x.total_price || 0), 0),
        ticketsSold: tickets.reduce((a, x: any) => a + (x.quantity || 1), 0),
        ticketsScanned: tickets.filter((x: any) => x.entry_scanned).length,
        tableRevenue: reservations.reduce((a, x: any) => a + Number(x.total_price || 0), 0),
        tablesBooked: reservations.length,
        glEntries: entries.length,
        glScanned: entries.filter((e: any) => e.entry_scanned).length,
      });
    })();
    return () => { cancelled = true; };
  }, [eventId]);

  const heading =
    phase === 'after' ? tt('Verdict de la soirée', 'Night verdict', 'Veredicto de la noche')
    : phase === 'live' ? tt('Votre soirée est en cours', 'Your night is live', 'Tu noche está en directo')
    : tt('Votre soirée se prépare', 'Your night is taking shape', 'Tu noche toma forma');

  const netLabel =
    phase === 'after' ? tt('Votre gain net', 'Your net earnings', 'Tu ganancia neta')
    : phase === 'live' ? tt('Votre part nette', 'Your net share', 'Tu parte neta')
    : tt('Votre part nette à ce jour', 'Your net share so far', 'Tu parte neta hasta ahora');

  if (!data) return <Skeleton className="h-44 w-full rounded-2xl" />;

  const totalRevenue = data.ticketRevenue + data.tableRevenue;

  return (
    <Card className="owner-card border-0 overflow-hidden">
      <div className="relative p-5 sm:p-6">
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full" style={{ background: 'rgba(232,25,44,0.12)', filter: 'blur(50px)' }} />
        <div className="relative">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary">
            <Sparkles className="h-3.5 w-3.5" /> {heading}
          </div>
          <div className="mt-2 flex items-end gap-3 flex-wrap">
            <div>
              <div className="text-[11px] text-muted-foreground">{netLabel}</div>
              <div className="text-4xl sm:text-5xl font-bold tracking-tight text-primary tabular-nums">
                {netGain.loading ? '…' : `${netGain.netEuros.toFixed(2)} €`}
              </div>
            </div>
          </div>

          {/* Supporting KPI strip */}
          <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Kpi icon={Ticket} label={t('collabDash.kpiTicketRevenue')} value={`${data.ticketRevenue.toFixed(0)} €`} sub={`${data.ticketsSold} ${t('collabDash.soldWord')} · ${data.ticketsScanned} ${t('collabDash.scannedWord')}`} />
            <Kpi icon={Wine} label={t('collabDash.kpiTableRevenue')} value={`${data.tableRevenue.toFixed(0)} €`} sub={`${data.tablesBooked} ${t('collabDash.bookedWord')}`} />
            <Kpi icon={UserPlus} label={tt('Guest list', 'Guest list', 'Guest list')} value={`${data.glEntries}`} sub={`${data.glScanned} ${t('collabDash.enteredWord')}`} />
            <Kpi icon={TrendingUp} label={t('collabDash.kpiTotalRevenue')} value={`${totalRevenue.toFixed(0)} €`} sub={t('collabDash.ticketsPlusTables')} />
          </div>
        </div>
      </div>
    </Card>
  );
}

function Kpi({ icon: Icon, label, value, sub }: { icon: any; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className="text-xl font-bold tabular-nums">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5 truncate">{sub}</div>}
    </div>
  );
}

/* =========================================================================
 * SPLIT CONTRACT VIEW — normalized split rules per category
 * ========================================================================= */
function SplitContractView({ rules }: { rules: any }) {
  const { t } = useLanguage();
  // Coerce legacy flat { organizer, venue } rules into the canonical nested shape
  // so every category (tickets/tables/drinks) renders instead of just `drinks`.
  const normalized = normalizeSplitRules(rules);
  if (!normalized) return <p className="text-sm text-muted-foreground">{t('collabDash.noContract')}</p>;
  const entries = Object.entries(normalized).filter(([, v]) => typeof v === 'object' && v !== null);
  return (
    <div className="space-y-2 text-sm">
      {entries.map(([key, val]: [string, any]) => (
        <div key={key} className="flex items-center justify-between p-2 rounded-md bg-muted/30">
          <span className="capitalize text-muted-foreground">{key.replace(/_/g, ' ')}</span>
          <div className="flex gap-2 text-xs">
            <span>Club <strong className="text-foreground">{val.venue_pct ?? val.venue ?? 0}%</strong></span>
            <span>{t('partnerships.org')} <strong className="text-foreground">{val.organizer_pct ?? val.organizer ?? 0}%</strong></span>
          </div>
        </div>
      ))}
    </div>
  );
}

/* =========================================================================
 * DETAILS DRAWER — every operational table behind one toggle
 * ========================================================================= */
function DetailsDrawer({ eventId, isPartnerVenue, initialOpen = false }: { eventId: string; isPartnerVenue: boolean; initialOpen?: boolean }) {
  const { language } = useLanguage();
  const tt = (frv: string, en: string, es?: string) => translate(language, frv, en, es);
  const [open, setOpen] = useState(initialOpen);

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between owner-card rounded-xl px-4 h-12 cursor-pointer transition-colors hover:bg-white/[0.03] border-0"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          <FileText className="h-4 w-4 text-muted-foreground" />
          {tt('Détails de gestion', 'Management details', 'Detalles de gestión')}
        </span>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="space-y-4">
          <Card className="owner-card border-0">
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><UserPlus className="h-4 w-4" /> {tt('Guest list', 'Guest list', 'Guest list')}</CardTitle></CardHeader>
            <CardContent><EventGuestListModule eventId={eventId} readOnly={isPartnerVenue} /></CardContent>
          </Card>
          <Card className="owner-card border-0">
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Ticket className="h-4 w-4" /> {tt('Commandes billets', 'Ticket orders', 'Pedidos de entradas')}</CardTitle></CardHeader>
            <CardContent><OwnerTicketOrders eventId={eventId} /></CardContent>
          </Card>
          <Card className="owner-card border-0">
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Wine className="h-4 w-4" /> {tt('Réservations VIP', 'VIP reservations', 'Reservas VIP')}</CardTitle></CardHeader>
            <CardContent><OwnerVipOrders eventId={eventId} /></CardContent>
          </Card>
          <Card className="owner-card border-0">
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><ScanLine className="h-4 w-4" /> {tt('Boissons vendues', 'Drinks sold', 'Bebidas vendidas')}</CardTitle></CardHeader>
            <CardContent><OwnerDrinkOrders eventId={eventId} /></CardContent>
          </Card>
          <EventInvoicesModule eventId={eventId} />
        </div>
      )}
    </div>
  );
}
