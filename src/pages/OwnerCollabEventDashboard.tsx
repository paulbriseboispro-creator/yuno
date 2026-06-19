import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { OwnerHeader } from '@/components/OwnerHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  ArrowLeft, Handshake, Lock, Eye, Ticket, Wine, UserPlus, FileText, Megaphone,
  BarChart3, Calendar, Clock, ExternalLink, CheckCircle2, XCircle, ScanLine, Users,
  TrendingUp, Euro, Activity, Radio, Sparkles,
} from 'lucide-react';
import { useEventNetGain } from '@/hooks/useEventNetGain';
import { formatInTimeZone } from 'date-fns-tz';
import { PARIS_TIMEZONE } from '@/lib/timezone';
import { fr, es, enUS } from 'date-fns/locale';
import { useLanguage } from '@/contexts/LanguageContext';

const dfLocaleCollab = (lng: string) => (lng === 'fr' ? fr : lng === 'es' ? es : enUS);
import { PurchaseSourceBreakdown } from '@/components/analytics/PurchaseSourceBreakdown';
import { OwnerTicketOrders } from '@/components/owner/OwnerTicketOrders';
import { OwnerVipOrders } from '@/components/owner/OwnerVipOrders';
import { OwnerDrinkOrders } from '@/components/owner/OwnerDrinkOrders';
import { EventGuestListModule } from '@/components/owner/co-event/EventGuestListModule';
import { EventInvoicesModule } from '@/components/owner/co-event/EventInvoicesModule';
import { EventPromotersModule } from '@/components/owner/co-event/EventPromotersModule';
import { EventAnalyticsModule } from '@/components/owner/co-event/EventAnalyticsModule';
import { EventLiveModule } from '@/components/owner/co-event/EventLiveModule';
import { EventTicketingSetupModule } from '@/components/owner/co-event/EventTicketingSetupModule';
import { EventTablesSetupModule } from '@/components/owner/co-event/EventTablesSetupModule';
import { toast } from 'sonner';

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

export default function OwnerCollabEventDashboard() {
  const { eventId } = useParams<{ eventId: string }>();
  const { user } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'overview';

  const [event, setEvent] = useState<EventData | null>(null);
  const [organizer, setOrganizer] = useState<PartnerProfile | null>(null);
  const [leadVenue, setLeadVenue] = useState<VenueLite | null>(null);
  const [myVenueId, setMyVenueId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !eventId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      // 1. Find this owner's venue
      const { data: v } = await supabase
        .from('venues').select('id').eq('owner_id', user.id).limit(1).maybeSingle();
      if (cancelled) return;
      if (v) setMyVenueId(v.id);

      // 2. Fetch event (RLS will allow if user is lead, partner_venue_owner, or partner_organizer)
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

      // 3. Fetch lead organizer profile
      const orgId = ev.organizer_user_id ?? ev.partner_organizer_id;
      if (orgId) {
        const { data: prof } = await supabase
          .from('organizer_profiles' as any)
          .select('display_name, avatar_url, slug')
          .eq('user_id', orgId)
          .maybeSingle();
        if (!cancelled) setOrganizer((prof as unknown) as PartnerProfile);
      }

      // 4. Fetch lead venue if relevant
      if (ev.venue_id) {
        const { data: lv } = await supabase
          .from('venues').select('id, name').eq('id', ev.venue_id).maybeSingle();
        if (!cancelled) setLeadVenue(lv as VenueLite);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user, eventId]);

  const role = useMemo(() => {
    if (!event || !myVenueId) return 'unknown';
    if (event.venue_id === myVenueId) return 'lead_venue';
    if (event.partner_venue_id === myVenueId) return 'partner_venue';
    return 'unknown';
  }, [event, myVenueId]);

  if (loading) {
    return (
      <div className="min-h-screen dashboard-gradient-bg">
        <OwnerHeader title={t('collabDash.title')} />
        <div className="container mx-auto px-4 py-6 max-w-6xl space-y-4">
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
        <div className="container mx-auto px-4 py-6 max-w-6xl">
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
  const leadName = role === 'lead_venue' ? 'toi' : (orgName);
  const isPartnerVenue = role === 'partner_venue';

  return (
    <div className="min-h-screen dashboard-gradient-bg">
      <OwnerHeader title={t('collabDash.title')} />
      <div className="container mx-auto px-3 sm:px-4 py-4 sm:py-6 max-w-6xl space-y-5">
        <Button variant="ghost" size="sm" onClick={() => navigate('/owner/collaborations')} className="gap-1.5 -ml-2">
          <ArrowLeft className="h-4 w-4" /> Collaborations
        </Button>

        {/* HERO */}
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
                {event.is_active ? (
                  <Badge variant="success">{t('partnerships.status.active')}</Badge>
                ) : (
                  <Badge variant="secondary">{t('collabDash.inactive')}</Badge>
                )}
                {event.split_locked_at && (
                  <Badge variant="outline" className="gap-1 text-[10px]">
                    <Lock className="h-2.5 w-2.5" /> {t('collabDash.splitLocked')}
                  </Badge>
                )}
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold leading-tight">{event.title}</h1>
              <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5" />
                  {formatInTimeZone(new Date(event.start_at), PARIS_TIMEZONE, "EEEE d MMM yyyy · HH'h'mm", { locale: fr })}
                </div>
                {organizer && (
                  <div className="flex items-center gap-2">
                    <Megaphone className="h-3.5 w-3.5" />
                    {t('owner.cdash.organizerLabel')} {organizer.slug ? (
                      <Link to={`/o/${organizer.slug}`} className="text-primary hover:underline inline-flex items-center gap-1">
                        {orgName} <ExternalLink className="h-3 w-3" />
                      </Link>
                    ) : <span className="text-foreground">{orgName}</span>}
                  </div>
                )}
                {leadVenue && (
                  <div className="flex items-center gap-2">
                    <Users className="h-3.5 w-3.5" />
                    {t('owner.cdash.venueLabel')} <span className="text-foreground">{leadVenue.name}</span>
                  </div>
                )}
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

        {/* KPI BAND */}
        <KpiBand eventId={event.id} venueId={myVenueId} />

        {/* TABS */}
        <Tabs value={tab} onValueChange={(v) => setParams({ tab: v })}>
          <ScrollArea className="w-full">
            <TabsList className="inline-flex w-max">
              <TabsTrigger value="overview" className="gap-1.5"><Activity className="h-3.5 w-3.5" /> {t('collabDash.tabOverview')}</TabsTrigger>
              <TabsTrigger value="live" className="gap-1.5"><Radio className="h-3.5 w-3.5" /> {t('collabDash.tabLive')}</TabsTrigger>
              <TabsTrigger value="tickets" className="gap-1.5"><Ticket className="h-3.5 w-3.5" /> {t('collabDash.tabTickets')}</TabsTrigger>
              <TabsTrigger value="tables" className="gap-1.5"><Wine className="h-3.5 w-3.5" /> {t('collabDash.tabTables')}</TabsTrigger>
              <TabsTrigger value="guestlist" className="gap-1.5"><UserPlus className="h-3.5 w-3.5" /> {t('collabDash.tabGuestlist')}</TabsTrigger>
              <TabsTrigger value="scans" className="gap-1.5"><ScanLine className="h-3.5 w-3.5" /> {t('collabDash.tabScans')}</TabsTrigger>
              <TabsTrigger value="invoices" className="gap-1.5"><FileText className="h-3.5 w-3.5" /> {t('collabDash.tabInvoices')}</TabsTrigger>
              <TabsTrigger value="promoters" className="gap-1.5"><Megaphone className="h-3.5 w-3.5" /> {t('collabDash.tabPromoters')}</TabsTrigger>
              <TabsTrigger value="analytics" className="gap-1.5"><BarChart3 className="h-3.5 w-3.5" /> {t('collabDash.tabAnalytics')}</TabsTrigger>
            </TabsList>
          </ScrollArea>

          <TabsContent value="overview" className="mt-5 space-y-4">
            <OverviewPanel eventId={event.id} splitRules={event.revenue_split_rules} />
          </TabsContent>
          <TabsContent value="live" className="mt-5">
            <EventLiveModule eventId={event.id} venueId={event.venue_id ?? event.partner_venue_id} />
          </TabsContent>
          <TabsContent value="tickets" className="mt-5 space-y-4">
            <EventTicketingSetupModule eventId={event.id} />
            <Card className="owner-card border-0">
              <CardHeader><CardTitle className="text-base">{t('collabDash.ordersTickets')}</CardTitle></CardHeader>
              <CardContent><OwnerTicketOrders eventId={event.id} /></CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="tables" className="mt-5 space-y-4">
            <EventTablesSetupModule eventId={event.id} />
            <Card className="owner-card border-0">
              <CardHeader><CardTitle className="text-base">{t('collabDash.reservationsVip')}</CardTitle></CardHeader>
              <CardContent><OwnerVipOrders eventId={event.id} /></CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="guestlist" className="mt-5">
            <EventGuestListModule eventId={event.id} readOnly={isPartnerVenue} />
          </TabsContent>
          <TabsContent value="scans" className="mt-5">
            <ScansPanel eventId={event.id} />
          </TabsContent>
          <TabsContent value="invoices" className="mt-5">
            <EventInvoicesModule eventId={event.id} />
          </TabsContent>
          <TabsContent value="promoters" className="mt-5">
            <EventPromotersModule eventId={event.id} />
          </TabsContent>
          <TabsContent value="analytics" className="mt-5 space-y-4">
            <EventAnalyticsModule eventId={event.id} venueId={event.venue_id ?? event.partner_venue_id} />
            <Card className="owner-card border-0">
              <CardHeader><CardTitle className="text-base">{t('collabDash.drinksSold')}</CardTitle></CardHeader>
              <CardContent><OwnerDrinkOrders eventId={event.id} /></CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

/* =========================================================================
 * KPI BAND
 * ========================================================================= */
function KpiBand({ eventId, venueId }: { eventId: string; venueId: string | null }) {
  const { t } = useLanguage();
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
      const [t, tr, gl] = await Promise.all([
        supabase.from('tickets').select('total_price, quantity, entry_scanned, status').eq('event_id', eventId).eq('status', 'paid'),
        supabase.from('table_reservations').select('total_price, status').eq('event_id', eventId).eq('status', 'confirmed'),
        supabase.from('guest_list_entries').select('id, entry_scanned, guest_lists!inner(event_id)').eq('guest_lists.event_id', eventId),
      ]);
      if (cancelled) return;
      const tickets = t.data || [];
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

  if (!data) {
    return <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">{[0,1,2,3,4].map(i => <Skeleton key={i} className="h-24" />)}</div>;
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      <KpiCard icon={Euro} label={t('collabDash.kpiTicketRevenue')} value={`${data.ticketRevenue.toFixed(2)} €`} sub={`${data.ticketsSold} ${t('collabDash.soldWord')} · ${data.ticketsScanned} ${t('collabDash.scannedWord')}`} />
      <KpiCard icon={Wine} label={t('collabDash.kpiTableRevenue')} value={`${data.tableRevenue.toFixed(2)} €`} sub={`${data.tablesBooked} ${t('collabDash.bookedWord')}`} />
      <KpiCard icon={UserPlus} label={t('collabDash.tabGuestlist')} value={`${data.glEntries}`} sub={`${data.glScanned} ${t('collabDash.enteredWord')}`} />
      <KpiCard icon={TrendingUp} label={t('collabDash.kpiTotalRevenue')} value={`${(data.ticketRevenue + data.tableRevenue).toFixed(2)} €`} sub={t('collabDash.ticketsPlusTables')} />
      <KpiCard
        icon={Sparkles}
        label={t('collabDash.kpiNetGain')}
        value={netGain.loading ? '…' : `${netGain.netEuros.toFixed(2)} €`}
        sub={t('collabDash.netGainSub')}
        highlight
      />
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, sub, highlight }: { icon: any; label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <Card className={`owner-card border-0 ${highlight ? 'ring-1 ring-primary/30 bg-primary/[0.04]' : ''}`}>
      <CardContent className="p-4">
        <div className={`flex items-center gap-2 text-xs mb-1 ${highlight ? 'text-primary' : 'text-muted-foreground'}`}>
          <Icon className="h-3.5 w-3.5" /> {label}
        </div>
        <div className={`text-2xl font-bold ${highlight ? 'text-primary' : ''}`}>{value}</div>
        {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

/* =========================================================================
 * OVERVIEW
 * ========================================================================= */
function OverviewPanel({ eventId, splitRules }: { eventId: string; splitRules: any }) {
  const { t } = useLanguage();
  return (
    <div className="space-y-4">
      <Card className="owner-card border-0">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" /> {t('collabDash.salesBreakdown')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <PurchaseSourceBreakdown eventId={eventId} />
        </CardContent>
      </Card>

      {splitRules && (
        <Card className="owner-card border-0">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Euro className="h-4 w-4 text-primary" /> {t('collabDash.revenueSplitContract')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <SplitContractView rules={splitRules} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SplitContractView({ rules }: { rules: any }) {
  const { t } = useLanguage();
  if (!rules) return <p className="text-sm text-muted-foreground">{t('collabDash.noContract')}</p>;
  const entries = Object.entries(rules).filter(([k]) => typeof rules[k] === 'object' && rules[k] !== null);
  return (
    <div className="space-y-2 text-sm">
      {entries.map(([key, val]: [string, any]) => (
        <div key={key} className="flex items-center justify-between p-2 rounded-md bg-muted/30">
          <span className="capitalize text-muted-foreground">{key.replace(/_/g, ' ')}</span>
          <div className="flex gap-2 text-xs">
            <span>Club <strong className="text-foreground">{val.venue ?? 0}%</strong></span>
            <span>{t('partnerships.org')} <strong className="text-foreground">{val.organizer ?? 0}%</strong></span>
          </div>
        </div>
      ))}
    </div>
  );
}

/* =========================================================================
 * TICKETS PANEL
 * ========================================================================= */
function TicketsPanel({ eventId }: { eventId: string }) {
  const [tickets, setTickets] = useState<any[]>([]);
  const [rounds, setRounds] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [tk, rd] = await Promise.all([
        supabase.from('tickets').select('id, full_name, user_email, quantity, total_price, ticket_type, entry_scanned, status, created_at').eq('event_id', eventId).order('created_at', { ascending: false }).limit(200),
        supabase.from('ticket_rounds').select('*').eq('event_id', eventId).order('round_order', { ascending: true }),
      ]);
      if (cancelled) return;
      setTickets(tk.data || []);
      setRounds(rd.data || []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [eventId]);

  if (loading) return <Skeleton className="h-64 w-full" />;

  const paid = tickets.filter(t => t.status === 'paid');

  return (
    <div className="space-y-4">
      {rounds.length > 0 && (
        <Card className="owner-card border-0">
          <CardHeader><CardTitle className="text-base">Rounds de billetterie</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {rounds.map(r => {
                const sold = paid.filter(t => t.ticket_type === r.name).reduce((a, t) => a + (t.quantity || 1), 0);
                const cap = r.max_tickets || 0;
                const pct = cap ? Math.min(100, (sold / cap) * 100) : 0;
                return (
                  <div key={r.id} className="p-3 rounded-md bg-muted/30">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{r.name}</span>
                      <span className="text-muted-foreground text-xs">{sold} / {cap} · {Number(r.price).toFixed(2)} €</span>
                    </div>
                    <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="owner-card border-0">
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span>Billets vendus ({paid.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {paid.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Aucun billet vendu.</p>
          ) : (
            <div className="divide-y divide-border/50">
              {paid.slice(0, 50).map(t => (
                <div key={t.id} className="py-2 flex items-center justify-between text-sm">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{t.full_name || t.user_email}</div>
                    <div className="text-xs text-muted-foreground">{t.ticket_type} · {t.quantity || 1}x</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {t.entry_scanned ? (
                      <Badge variant="success" className="text-[10px] gap-1"><CheckCircle2 className="h-2.5 w-2.5" /> Scanné</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">En attente</Badge>
                    )}
                    <span className="font-mono text-xs">{Number(t.total_price).toFixed(2)} €</span>
                  </div>
                </div>
              ))}
              {paid.length > 50 && (
                <p className="text-xs text-muted-foreground text-center py-3">+ {paid.length - 50} autres billets</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* =========================================================================
 * TABLES PANEL
 * ========================================================================= */
function TablesPanel({ eventId }: { eventId: string }) {
  const [reservations, setReservations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('table_reservations')
        .select('id, full_name, user_email, phone, guests_count, total_price, deposit, minimum_spend, status, table_number, created_at, table_zones(name)')
        .eq('event_id', eventId)
        .order('created_at', { ascending: false });
      if (!cancelled) {
        setReservations(data || []);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [eventId]);

  if (loading) return <Skeleton className="h-64 w-full" />;

  const confirmed = reservations.filter(r => r.status === 'confirmed');

  return (
    <Card className="owner-card border-0">
      <CardHeader>
        <CardTitle className="text-base">Réservations VIP ({confirmed.length})</CardTitle>
      </CardHeader>
      <CardContent>
        {confirmed.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Aucune réservation.</p>
        ) : (
          <div className="divide-y divide-border/50">
            {confirmed.map(r => (
              <div key={r.id} className="py-3 flex items-center justify-between text-sm gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{r.full_name}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {r.table_zones?.name || '—'} · {r.guests_count} pers. {r.table_number ? ` · Table #${r.table_number}` : ' · Non placée'}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-xs">{Number(r.total_price).toFixed(2)} €</div>
                  {r.minimum_spend && <div className="text-[10px] text-muted-foreground">Min. {Number(r.minimum_spend).toFixed(0)} €</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* =========================================================================
 * GUEST LIST PANEL
 * ========================================================================= */
function GuestListPanel({ eventId }: { eventId: string }) {
  const [guestList, setGuestList] = useState<any | null>(null);
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: gl } = await supabase
        .from('guest_lists')
        .select('id, quota, free_before_time, includes_drink, is_active, share_token')
        .eq('event_id', eventId)
        .maybeSingle();
      if (!gl) {
        if (!cancelled) { setLoading(false); }
        return;
      }
      const { data: ent } = await supabase
        .from('guest_list_entries')
        .select('id, full_name, email, gender, status, entry_scanned, entry_type, created_at, promoter_id')
        .eq('guest_list_id', gl.id)
        .order('created_at', { ascending: false });
      if (!cancelled) {
        setGuestList(gl);
        setEntries(ent || []);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [eventId]);

  if (loading) return <Skeleton className="h-64 w-full" />;
  if (!guestList) {
    return (
      <Card className="owner-card border-0 p-8 text-center">
        <UserPlus className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
        <p className="text-sm text-muted-foreground">Aucune guest list configurée pour cette soirée.</p>
      </Card>
    );
  }

  const shareLink = `${window.location.origin}/g/${guestList.share_token}`;

  return (
    <div className="space-y-4">
      <Card className="owner-card border-0">
        <CardContent className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div><div className="text-xs text-muted-foreground">Quota</div><div className="text-xl font-bold">{guestList.quota}</div></div>
          <div><div className="text-xs text-muted-foreground">Inscrits</div><div className="text-xl font-bold">{entries.length}</div></div>
          <div><div className="text-xs text-muted-foreground">Scannés</div><div className="text-xl font-bold">{entries.filter(e => e.entry_scanned).length}</div></div>
          <div><div className="text-xs text-muted-foreground">Statut</div><Badge variant={guestList.is_active ? 'success' : 'secondary'} className="mt-1">{guestList.is_active ? 'Actif' : 'Fermé'}</Badge></div>
        </CardContent>
      </Card>
      <Card className="owner-card border-0">
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span>Inscriptions</span>
            <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => { navigator.clipboard.writeText(shareLink); toast.success('Lien copié'); }}>
              Copier le lien
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Aucune inscription.</p>
          ) : (
            <div className="divide-y divide-border/50">
              {entries.slice(0, 100).map(e => (
                <div key={e.id} className="py-2 flex items-center justify-between text-sm">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{e.full_name}</div>
                    <div className="text-xs text-muted-foreground">{e.email}{e.gender ? ` · ${e.gender}` : ''}{e.entry_type ? ` · ${e.entry_type}` : ''}</div>
                  </div>
                  {e.entry_scanned ? (
                    <Badge variant="success" className="text-[10px] gap-1"><CheckCircle2 className="h-2.5 w-2.5" /> Entré</Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px]">En attente</Badge>
                  )}
                </div>
              ))}
              {entries.length > 100 && <p className="text-xs text-muted-foreground text-center py-3">+ {entries.length - 100} autres</p>}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* =========================================================================
 * SCANS PANEL
 * ========================================================================= */
function ScansPanel({ eventId }: { eventId: string }) {
  const { t } = useLanguage();
  const [recent, setRecent] = useState<any[]>([]);
  const [stats, setStats] = useState({ total: 0, scanned: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('tickets')
        .select('id, full_name, user_email, ticket_type, entry_scanned, entry_scanned_at')
        .eq('event_id', eventId)
        .eq('status', 'paid')
        .order('entry_scanned_at', { ascending: false, nullsFirst: false })
        .limit(100);
      if (cancelled) return;
      const tickets = data || [];
      setStats({ total: tickets.length, scanned: tickets.filter(t => t.entry_scanned).length });
      setRecent(tickets.filter(t => t.entry_scanned).slice(0, 30));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [eventId]);

  if (loading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-4">
      <Card className="owner-card border-0">
        <CardContent className="p-4 grid grid-cols-3 gap-3">
          <div><div className="text-xs text-muted-foreground">{t('collabDash.paidTickets')}</div><div className="text-2xl font-bold">{stats.total}</div></div>
          <div><div className="text-xs text-muted-foreground">{t('collabDash.scannedWord')}</div><div className="text-2xl font-bold text-emerald-500">{stats.scanned}</div></div>
          <div><div className="text-xs text-muted-foreground">{t('collabDash.remaining')}</div><div className="text-2xl font-bold text-muted-foreground">{stats.total - stats.scanned}</div></div>
        </CardContent>
      </Card>
      <Card className="owner-card border-0">
        <CardHeader><CardTitle className="text-base">{t('collabDash.lastScans')}</CardTitle></CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">{t('collabDash.noScans')}</p>
          ) : (
            <div className="divide-y divide-border/50">
              {recent.map(t => (
                <div key={t.id} className="py-2 flex items-center justify-between text-sm">
                  <div>
                    <div className="font-medium">{t.full_name || t.user_email}</div>
                    <div className="text-xs text-muted-foreground">{t.ticket_type}</div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t.entry_scanned_at ? formatInTimeZone(new Date(t.entry_scanned_at), PARIS_TIMEZONE, 'HH:mm') : '—'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* =========================================================================
 * INVOICES PANEL
 * ========================================================================= */
function InvoicesPanel({ eventId }: { eventId: string }) {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('invoice_numbers')
        .select('id, invoice_number, ticket_id, table_reservation_id, order_id, created_at, venue_id, organizer_user_id')
        .or(`ticket_id.in.(select id from tickets where event_id = '${eventId}'),table_reservation_id.in.(select id from table_reservations where event_id = '${eventId}'),order_id.in.(select id from orders where event_id = '${eventId}')`)
        .order('created_at', { ascending: false })
        .limit(200);
      // Fallback: do it in two queries since the .or with subselect might not work
      const [tk, tr, od] = await Promise.all([
        supabase.from('tickets').select('id').eq('event_id', eventId),
        supabase.from('table_reservations').select('id').eq('event_id', eventId),
        supabase.from('orders').select('id').eq('event_id', eventId),
      ]);
      const tIds = (tk.data || []).map(x => x.id);
      const rIds = (tr.data || []).map(x => x.id);
      const oIds = (od.data || []).map(x => x.id);
      const filters: string[] = [];
      if (tIds.length) filters.push(`ticket_id.in.(${tIds.join(',')})`);
      if (rIds.length) filters.push(`table_reservation_id.in.(${rIds.join(',')})`);
      if (oIds.length) filters.push(`order_id.in.(${oIds.join(',')})`);
      if (filters.length === 0) {
        if (!cancelled) { setInvoices([]); setLoading(false); }
        return;
      }
      const { data: inv } = await supabase
        .from('invoice_numbers')
        .select('id, invoice_number, ticket_id, table_reservation_id, order_id, created_at')
        .or(filters.join(','))
        .order('created_at', { ascending: false })
        .limit(300);
      if (!cancelled) {
        setInvoices(inv || []);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [eventId]);

  if (loading) return <Skeleton className="h-64 w-full" />;

  return (
    <Card className="owner-card border-0">
      <CardHeader>
        <CardTitle className="text-base">Factures émises ({invoices.length})</CardTitle>
      </CardHeader>
      <CardContent>
        {invoices.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Aucune facture pour cette soirée.</p>
        ) : (
          <div className="divide-y divide-border/50">
            {invoices.map(inv => {
              const type = inv.ticket_id ? 'Billet' : inv.table_reservation_id ? 'Table' : 'Commande';
              return (
                <div key={inv.id} className="py-2 flex items-center justify-between text-sm">
                  <div>
                    <div className="font-mono font-medium">{inv.invoice_number}</div>
                    <div className="text-xs text-muted-foreground">{type} · {formatInTimeZone(new Date(inv.created_at), PARIS_TIMEZONE, 'dd/MM/yyyy HH:mm')}</div>
                  </div>
                  <Badge variant="outline" className="text-[10px]">{type}</Badge>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* PromotersPanel and AnalyticsPanel are now provided by reusable modules:
 * - EventPromotersModule (src/components/owner/co-event/EventPromotersModule.tsx)
 * - EventAnalyticsModule (src/components/owner/co-event/EventAnalyticsModule.tsx)
 */
