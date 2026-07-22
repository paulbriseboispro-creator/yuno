import { useState, useEffect, useCallback } from 'react';
import { translate } from '@/i18n/orgTranslate';
import { Skeleton } from '@/components/ui/skeleton';
import { PromoterProfileTab } from '@/components/promoter/PromoterProfileTab';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { DateRangeFilter, type DateRange } from '@/components/promoter/DateRangeFilter';
import { PromoterScanTab } from '@/components/promoter/PromoterScanTab';
import { PromoterGuestListTab } from '@/components/promoter/PromoterGuestListTab';
import { PromoterPayoutInbox } from '@/components/promoter/PromoterPayoutInbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import {
  Copy, TrendingUp, Euro, Ticket, Calendar, ExternalLink,
  Megaphone, QrCode, Share2, Zap, Target, ChevronDown, ChevronUp,
  ScanLine, UserPlus, Gift, Users, Crown, Ban, Wine, Beer, Coins,
} from 'lucide-react';
import { Instagram } from '@/components/icons/Instagram';
import QRCode from 'qrcode';
import { shareContent } from '@/lib/share';
import type { PromoterStats, PromoterEventStats } from '@/types/promoter';


interface Promoter {
  id: string;
  user_id: string;
  venue_id: string | null;
  organizer_user_id?: string | null;
  promo_code: string;
  is_active: boolean;
  iban: string | null;
  bic: string | null;
  instagram_url: string | null;
  profile_image_url: string | null;
  ticket_commission_type: string;
  ticket_commission_value: number;
  table_commission_type: string;
  table_commission_value: number;
  can_scan_entries?: boolean;
  default_commission_template_id?: string;
  venue?: { id: string; name: string; logo_url?: string; custom_domain?: string };
  /** Resolved organizer name for organizer-scoped profiles (no venue). */
  organizerName?: string;
}

interface TemplateRules {
  ticket?: { type: string; value: number };
  table?: { type: string; value: number };
  reward_type?: string;
  reward_config?: Record<string, unknown>;
  tiers?: Array<{ min: number; max: number | null; reward_type: string; ticketValue?: number; reward_config?: Record<string, unknown> }>;
  customer_discount?: { type: string; value: number; label?: string };
}

interface Announcement {
  id: string;
  title: string;
  content: string;
  created_at: string;
}

interface EventAssignment {
  eventId: string;
  eventTitle: string;
  eventStartAt: string;
  eventEndAt: string;
  canAccessGuestlist: boolean;
  canAccessTables: boolean;
}

interface VenuePromoterContentProps {
  promoter: Promoter;
  stats: PromoterStats;
  announcements: Announcement[];
  onProfileSaved?: () => void;
  allPromoterProfiles?: Promoter[];
}

export function VenuePromoterContent({ promoter, stats, announcements, onProfileSaved, allPromoterProfiles }: VenuePromoterContentProps) {
  const { t, language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const navigate = useNavigate();
  const venue = promoter.venue;
  // A promoter profile is scoped either to a club (venue_id) or to an organizer.
  const isOrg = !promoter.venue_id && !!promoter.organizer_user_id;
  const scopeName = venue?.name || promoter.organizerName || 'Organisateur';
  const [tab, setTab] = useState('overview');
  const [dateRange, setDateRange] = useState<DateRange>('upcoming');
  const [eventFilter, setEventFilter] = useState<string | null>(null);
  const [events, setEvents] = useState<Array<{ id: string; title: string; start_at: string; end_at: string }>>([]);
  const [eventStats, setEventStats] = useState<PromoterEventStats[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventStatsLoading, setEventStatsLoading] = useState(true);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [sourceTag, setSourceTag] = useState('');
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null);
  const [templateRules, setTemplateRules] = useState<TemplateRules | null>(null);

  // Assignments with permissions
  const [assignments, setAssignments] = useState<EventAssignment[]>([]);
  const [selectedScanEvent, setSelectedScanEvent] = useState<string>('');
  const [selectedGuestListEvent, setSelectedGuestListEvent] = useState<string>('');

  // Night mode
  const [liveEvent, setLiveEvent] = useState<{ id: string; title: string } | null>(null);
  const [liveStats, setLiveStats] = useState({ tickets: 0, revenue: 0, commission: 0, goal: 0, goalTarget: 0 });

  // Team info
  const [teamInfo, setTeamInfo] = useState<{ name: string; leaderName: string | null; memberCount: number; isLeader: boolean; teamId: string | null } | null>(null);
  const [teamMembers, setTeamMembers] = useState<Array<{ id: string; label: string; clicks: number; conversions: number; revenue: number; commission: number }>>([]);

  // L'interrupteur « Scanner les entrées » de la fiche owner fait foi. Il était
  // ignoré ici (codé en dur à true) : l'owner croyait retirer le scan à un
  // promoteur sans aucun effet. La policy RLS s'appuie sur le même drapeau, donc
  // masquer l'onglet et refuser l'écriture disent désormais la même chose.
  const canScan = promoter.can_scan_entries ?? false;
  
  // Linkage authoritative : guest list & scan ne portent QUE sur les soirées
  // rattachées (assignations actives). Plus de fallback « toutes les soirées » —
  // un promoteur non rattaché à une soirée n'en gère ni la guest list ni le scan,
  // cohérent avec « Mes Événements » et le linktree public.
  const guestListEvents = assignments.filter(a => a.canAccessGuestlist);
  const hasGuestListAccess = guestListEvents.length > 0;

  const scanEvents = assignments;

  const getBaseUrl = () => 'https://yunoapp.eu';

  // Public ref link for one event — organizer events use the venue-agnostic /event/:id page;
  // venue events open the club page with the event highlighted.
  const eventRefLink = (eventId: string) =>
    isOrg
      ? `${getBaseUrl()}/event/${eventId}?ref=${promoter.promo_code}${sourceTag ? `&src=${sourceTag}` : ''}`
      : `${getBaseUrl()}/club/${venue?.id}?ref=${promoter.promo_code}&event=${eventId}${sourceTag ? `&src=${sourceTag}` : ''}`;

  // General promo link uses the /promoteur/ route
  const promoLink = promoter.promo_code
    ? `${getBaseUrl()}/promoteur/${promoter.promo_code}${sourceTag ? `?src=${sourceTag}` : ''}`
    : null;

  // Event-specific link
  const eventPromoLink = eventFilter ? eventRefLink(eventFilter) : null;

  // Fetch upcoming/active events — by venue for club promoters, by organizer for organizer promoters.
  useEffect(() => {
    if (!venue?.id && !promoter.organizer_user_id) return;
    setEventsLoading(true);
    (async () => {
      const now = new Date().toISOString();
      const base = supabase.from('events')
        .select('id, title, start_at, end_at')
        .gte('end_at', now)
        .order('start_at', { ascending: true })
        .limit(50);
      // Le club peut être hôte (venue_id) OU partenaire d'un co-event
      // (partner_venue_id) : ses promoteurs travaillent les deux.
      const { data } = isOrg
        ? await base.or(`organizer_user_id.eq.${promoter.organizer_user_id},partner_organizer_id.eq.${promoter.organizer_user_id}`)
        : await base.or(`venue_id.eq.${venue!.id},partner_venue_id.eq.${venue!.id}`);
      setEvents(data || []);
      setEventsLoading(false);
    })();
  }, [venue?.id, promoter.organizer_user_id, isOrg]);

  // Fetch commission template
  useEffect(() => {
    if (!promoter.default_commission_template_id) return;
    (async () => {
      const { data } = await supabase.from('commission_templates')
        .select('rules')
        .eq('id', promoter.default_commission_template_id!)
        .single();
      if (data?.rules) {
        setTemplateRules(data.rules as unknown as TemplateRules);
      }
    })();
  }, [promoter.default_commission_template_id]);

  // Fetch assignments
  useEffect(() => {
    if (!promoter.id) return;
    (async () => {
      const { data } = await supabase.from('promoter_event_assignments')
        .select('event_id, can_access_guestlist, can_access_tables')
        .eq('promoter_id', promoter.id)
        .eq('status', 'active');
      if (!data || data.length === 0) { setAssignments([]); return; }
      const eventIds = data.map(a => a.event_id);
      const { data: evts } = await supabase.from('events')
        .select('id, title, start_at, end_at').in('id', eventIds);
      const evtMap = new Map((evts || []).map(e => [e.id, e]));
      setAssignments(data.map(a => {
        const evt = evtMap.get(a.event_id);
        return {
          eventId: a.event_id,
          eventTitle: evt?.title || '',
          eventStartAt: evt?.start_at || '',
          eventEndAt: evt?.end_at || '',
          canAccessGuestlist: a.can_access_guestlist ?? false,
          canAccessTables: a.can_access_tables ?? true,
        };
      }));
    })();
  }, [promoter.id]);

  // Fetch team info
  useEffect(() => {
    if (!promoter.id) return;
    (async () => {
      const { data: promo } = await supabase.from('promoters')
        .select('team_id').eq('id', promoter.id).single();
      if (!promo?.team_id) return;

      const { data: team } = await supabase.from('promoter_teams')
        .select('id, name, leader_promoter_id').eq('id', promo.team_id).single();
      if (!team) return;

      const isLeader = team.leader_promoter_id === promoter.id;

      const { count } = await supabase.from('promoters')
        .select('*', { count: 'exact', head: true })
        .eq('team_id', promo.team_id);

      let leaderName: string | null = null;
      if (team.leader_promoter_id) {
        const { data: leader } = await supabase.from('promoters')
          .select('promo_code, profiles!promoters_user_id_fkey(first_name, last_name)')
          .eq('id', team.leader_promoter_id).single();
        if (leader) {
          const prof = (leader as any).profiles;
          leaderName = prof?.first_name ? `${prof.first_name} ${prof.last_name || ''}`.trim() : leader.promo_code;
        }
      }

      setTeamInfo({ name: team.name, leaderName, memberCount: count || 0, isLeader, teamId: promo.team_id });

      // If leader, fetch team member stats
      if (isLeader) {
        const { data: members } = await supabase.from('promoters')
          .select('id, promo_code, first_name, last_name, user_id')
          .eq('team_id', promo.team_id).eq('is_active', true);
        if (!members) return;
        const memberIds = members.map(m => m.id);
        const { data: convs } = await supabase.from('promoter_conversions')
          .select('promoter_id, amount, commission').in('promoter_id', memberIds);
        const { data: clicks } = await supabase.from('promoter_clicks')
          .select('promoter_id').in('promoter_id', memberIds);
        const convMap: Record<string, { c: number; r: number; co: number }> = {};
        (convs || []).forEach(c => {
          if (!convMap[c.promoter_id]) convMap[c.promoter_id] = { c: 0, r: 0, co: 0 };
          convMap[c.promoter_id].c++;
          convMap[c.promoter_id].r += Number(c.amount || 0);
          convMap[c.promoter_id].co += Number(c.commission || 0);
        });
        const clickMap: Record<string, number> = {};
        (clicks || []).forEach(c => { clickMap[c.promoter_id] = (clickMap[c.promoter_id] || 0) + 1; });

        const userIds = members.map(m => m.user_id).filter(Boolean);
        const profMap: Record<string, { first_name: string | null; last_name: string | null }> = {};
        if (userIds.length) {
          const { data: profiles } = await supabase.from('profiles').select('id, first_name, last_name').in('id', userIds);
          (profiles || []).forEach(p => { profMap[p.id] = p; });
        }

        setTeamMembers(members.map(m => {
          const prof = profMap[m.user_id];
          const label = prof?.first_name ? `${prof.first_name} ${prof.last_name || ''}`.trim()
            : m.first_name ? `${m.first_name} ${m.last_name || ''}`.trim() : m.promo_code;
          const cs = convMap[m.id] || { c: 0, r: 0, co: 0 };
          return { id: m.id, label, clicks: clickMap[m.id] || 0, conversions: cs.c, revenue: cs.r, commission: cs.co };
        }).sort((a, b) => b.revenue - a.revenue));
      }
    })();
  }, [promoter.id]);

  // Auto-détection de la soirée à scanner : l'event en cours (live) d'abord,
  // sinon le prochain à venir. Le promoteur n'a plus à choisir — le sélecteur
  // ne sert qu'à déroger quand plusieurs soirées se chevauchent.
  useEffect(() => {
    if (selectedScanEvent || scanEvents.length === 0) return;
    const now = new Date();
    const live = scanEvents.find(a => a.eventStartAt && new Date(a.eventStartAt) <= now && new Date(a.eventEndAt) >= now);
    const next = [...scanEvents]
      .filter(a => a.eventEndAt && new Date(a.eventEndAt) >= now)
      .sort((a, b) => new Date(a.eventStartAt).getTime() - new Date(b.eventStartAt).getTime())[0];
    const auto = live || next;
    if (auto) setSelectedScanEvent(auto.eventId);
  }, [scanEvents, selectedScanEvent]);

  // Check for active event (night mode)
  useEffect(() => {
    if (!events.length) return;
    const now = new Date();
    const active = events.find(e => new Date(e.start_at) <= now && new Date(e.end_at) >= now);
    if (active) {
      setLiveEvent({ id: active.id, title: active.title });
    } else {
      setLiveEvent(null);
    }
  }, [events]);

  // Poll live stats
  useEffect(() => {
    if (!liveEvent) return;
    const poll = async () => {
      const { data: convs } = await supabase.from('promoter_conversions')
        .select('amount, commission, conversion_type')
        .eq('promoter_id', promoter.id)
        .eq('event_id', liveEvent.id);
      const tickets = convs?.filter(c => c.conversion_type === 'ticket' && (c.amount || 0) > 0).length || 0;
      const revenue = convs?.reduce((s, c) => s + (c.amount || 0), 0) || 0;
      const commission = convs?.reduce((s, c) => s + (c.commission || 0), 0) || 0;

      const { data: assignment } = await supabase.from('promoter_event_assignments')
        .select('goal_target')
        .eq('promoter_id', promoter.id)
        .eq('event_id', liveEvent.id)
        .maybeSingle();

      setLiveStats({
        tickets, revenue, commission,
        goal: assignment?.goal_target ? Math.min(100, (tickets / assignment.goal_target) * 100) : 0,
        goalTarget: assignment?.goal_target || 0,
      });
    };
    poll();
    const interval = setInterval(poll, 30000);
    return () => clearInterval(interval);
  }, [liveEvent, promoter.id]);

  // Fetch per-event stats (Smart Mixed)
  const fetchEventStats = useCallback(async () => {
    if (!promoter.id) return;
    setEventStatsLoading(true);

    // Linkage authoritative : « Mes Événements » ne montre QUE les soirées
    // auxquelles le promoteur est rattaché (assignations actives) — exactement le
    // même jeu que son linktree public. Le rattachement à toutes les soirées du
    // club se fait côté owner via le toggle « Relier à tous les événements »
    // (auto_assign_events, qui backfill les assignations). Pas de rattachement ⇒
    // rien à promouvoir, donc rien à afficher.
    const { data: assgn } = await supabase.from('promoter_event_assignments')
      .select('event_id, goal_target')
      .eq('promoter_id', promoter.id)
      .eq('status', 'active');

    const eventIds = (assgn || []).map(a => a.event_id);
    if (!eventIds.length) { setEventStats([]); setEventStatsLoading(false); return; }

    const { data: evtsRaw } = await supabase.from('events')
      .select('id, title, start_at, end_at').in('id', eventIds);

    // Le sélecteur de date choisit QUELLES soirées afficher, pas une fenêtre
    // glissante sur les stats (chaque carte montre le bilan complet de sa soirée).
    // « À venir » (défaut) : soirées live + à venir, la live/la plus proche en
    // tête — le promoteur voit d'abord ce qu'il vend ce soir. Les fenêtres passées
    // (7/30/90 j) : soirées terminées dans la période, la plus récente d'abord.
    const nowMs = Date.now();
    const windowDays = dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : dateRange === '90d' ? 90 : 0;
    const endMs = (e: { start_at: string; end_at: string }) =>
      new Date(e.end_at || e.start_at).getTime();
    const filtered = (evtsRaw || [])
      .filter(e => {
        if (dateRange === 'upcoming') return endMs(e) >= nowMs;
        if (dateRange === 'all') return true;
        return endMs(e) < nowMs && new Date(e.start_at).getTime() >= nowMs - windowDays * 86400000;
      })
      .sort((a, b) => {
        const sa = new Date(a.start_at).getTime(), sb = new Date(b.start_at).getTime();
        return dateRange === 'upcoming' ? sa - sb : sb - sa;
      });

    const shownIds = filtered.map(e => e.id);
    if (!shownIds.length) { setEventStats([]); setEventStatsLoading(false); return; }

    const { data: clicks } = await supabase.from('promoter_clicks').select('event_id').eq('promoter_id', promoter.id).in('event_id', shownIds);
    const { data: convs } = await supabase.from('promoter_conversions').select('event_id, amount, commission, conversion_type').eq('promoter_id', promoter.id).in('event_id', shownIds);

    const clickMap: Record<string, number> = {};
    (clicks || []).forEach(c => { if (c.event_id) clickMap[c.event_id] = (clickMap[c.event_id] || 0) + 1; });

    const convMap: Record<string, { tickets: number; tables: number; revenue: number; commission: number }> = {};
    (convs || []).forEach(c => {
      if (!c.event_id) return;
      if (!convMap[c.event_id]) convMap[c.event_id] = { tickets: 0, tables: 0, revenue: 0, commission: 0 };
      if (c.conversion_type === 'ticket' && (c.amount || 0) > 0) convMap[c.event_id].tickets++;
      else if (c.conversion_type === 'table' && (c.amount || 0) > 0) convMap[c.event_id].tables++;
      convMap[c.event_id].revenue += c.amount || 0;
      convMap[c.event_id].commission += c.commission || 0;
    });

    const goalMap = new Map((assgn || []).map(a => [a.event_id, a.goal_target]));

    setEventStats(filtered.map(e => {
      const cl = clickMap[e.id] || 0;
      const cv = convMap[e.id] || { tickets: 0, tables: 0, revenue: 0, commission: 0 };
      const gt = goalMap.get(e.id) || undefined;
      return {
        eventId: e.id,
        eventTitle: e.title,
        eventDate: e.start_at,
        clicks: cl,
        ticketsSold: cv.tickets,
        tablesReserved: cv.tables,
        revenue: cv.revenue,
        commission: cv.commission,
        conversionRate: cl > 0 ? (cv.tickets / cl) * 100 : 0,
        goalTarget: gt,
        goalProgress: gt ? Math.min(100, (cv.tickets / gt) * 100) : undefined,
      };
    }));
    setEventStatsLoading(false);
  }, [promoter.id, dateRange]);

  useEffect(() => { if (tab === 'events') fetchEventStats(); }, [tab, fetchEventStats]);

  // QR code
  useEffect(() => {
    if (!promoLink) return;
    QRCode.toDataURL(promoLink, { width: 256, margin: 2 }).then(setQrDataUrl).catch(() => {});
  }, [promoLink]);

  const copyLink = () => {
    if (!promoLink) return;
    navigator.clipboard.writeText(promoLink);
    toast.success(t('promoter.linkCopied'));
  };

  const shareLink = async () => {
    if (!promoLink) { copyLink(); return; }
    const outcome = await shareContent({ title: `${scopeName} — ${promoter.promo_code}`, url: promoLink });
    if (outcome === 'copied') toast.success(t('promoter.linkCopied'));
  };

  const getEventStatus = (start: string, end?: string) => {
    const now = new Date();
    const s = new Date(start);
    if (end && new Date(end) < now) return 'past';
    if (s > now) return 'upcoming';
    return 'active';
  };

  const fmt = (n: number) => n.toFixed(0);
  const fmtEur = (n: number) => `${n.toFixed(2)}€`;

  // Build tabs list
  const tabItems: Array<{ value: string; label: string }> = [
    { value: 'overview', label: t('promoter.overview') },
    { value: 'events', label: t('promoter.myEvents') },
    { value: 'links', label: t('promoter.linkTools') },
  ];
  if (canScan) tabItems.push({ value: 'scan', label: t('promoterScan.title') });
  if (hasGuestListAccess) tabItems.push({ value: 'guestlist', label: t('promoterGuestlist.title') });
  if (teamInfo?.isLeader) tabItems.push({ value: 'team', label: 'Equipe' });
  // Profil en dernier : c'est de la config perso, pas un outil de soirée.
  tabItems.push({ value: 'profile', label: 'Profil' });

  return (
    <div className="space-y-4">
      {/* Night Mode Banner */}
      {liveEvent && (
        <Card className="border-primary bg-primary/10 animate-pulse-subtle">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Zap className="h-5 w-5 shrink-0 text-primary" />
              <Badge variant="default" className="bg-primary animate-pulse shrink-0">{t('promoter.liveNow')}</Badge>
              <span className="min-w-0 flex-1 truncate font-semibold text-sm">{liveEvent.title}</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center sm:gap-3">
              <div className="min-w-0">
                <p className="truncate text-xl font-bold tabular-nums sm:text-2xl">{liveStats.tickets}</p>
                <p className="truncate text-xs text-muted-foreground">{t('promoter.liveTickets')}</p>
              </div>
              <div className="min-w-0">
                <p className="truncate text-xl font-bold tabular-nums sm:text-2xl">{fmtEur(liveStats.revenue)}</p>
                <p className="truncate text-xs text-muted-foreground">{t('promoter.liveRevenue')}</p>
              </div>
              <div className="min-w-0">
                <p className="truncate text-xl font-bold tabular-nums text-primary sm:text-2xl">{fmtEur(liveStats.commission)}</p>
                <p className="truncate text-xs text-muted-foreground">{t('promoter.liveCommission')}</p>
              </div>
            </div>
            {liveStats.goalTarget > 0 && (
              <div className="mt-3">
                <div className="flex justify-between gap-2 text-xs text-muted-foreground mb-1">
                  <span className="min-w-0 truncate">{t('promoter.goalBar')}</span>
                  <span className="shrink-0 tabular-nums">{liveStats.tickets}/{liveStats.goalTarget}</span>
                </div>
                <Progress value={liveStats.goal} className="h-2" />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <div className="overflow-x-auto -mx-4 px-4 scrollbar-hide">
          <TabsList className="inline-flex w-max h-auto p-1 gap-0.5">
            {tabItems.map(ti => (
              <TabsTrigger key={ti.value} value={ti.value} className="min-h-[40px] text-xs py-2 px-3 whitespace-nowrap">{ti.label}</TabsTrigger>
            ))}
          </TabsList>
        </div>

        {/* ── OVERVIEW ── */}
        <TabsContent value="overview" className="space-y-4 mt-4">
          {/* KPI Grid */}
          <div className="grid grid-cols-2 gap-3">
            <Card>
              <CardContent className="p-4 text-center">
                <TrendingUp className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
                <p className="text-2xl font-bold">{stats.totalClicks}</p>
                <p className="text-xs text-muted-foreground">{t('promoter.clicks')}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <Ticket className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
                <p className="text-2xl font-bold">{stats.ticketsSold}</p>
                <p className="text-xs text-muted-foreground">{t('promoter.ticketsSold')}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <Calendar className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
                <p className="text-2xl font-bold">{stats.tablesReserved}</p>
                <p className="text-xs text-muted-foreground">{t('promoter.tablesReserved')}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <Euro className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
                <p className="text-xl font-bold tabular-nums sm:text-2xl">{fmtEur(stats.totalRevenue)}</p>
                <p className="text-xs text-muted-foreground">{t('promoter.totalRevenue')}</p>
              </CardContent>
            </Card>
          </div>

          {/* Wallet — what you'll receive / total earned / already paid */}
          <Card className="border-primary/30">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-muted-foreground">{tt('À recevoir', 'To receive')}</p>
                  <p className="truncate text-2xl font-bold tabular-nums text-primary sm:text-3xl">{fmtEur(stats.pendingCommission)}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs text-muted-foreground">{t('promoter.conversionRate')}</p>
                  <p className="text-lg font-semibold tabular-nums">{stats.conversionRate.toFixed(1)}%</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border">
                <div className="min-w-0 text-center">
                  <p className="truncate text-sm font-semibold tabular-nums">{fmtEur(stats.totalCommission)}</p>
                  <p className="truncate text-xs text-muted-foreground">{tt('Total généré', 'Total earned')}</p>
                </div>
                <div className="min-w-0 text-center">
                  <p className="truncate text-sm font-semibold tabular-nums text-green-500">{fmtEur(stats.paidCommission)}</p>
                  <p className="truncate text-xs text-muted-foreground">{t('promoter.paid')}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Règlements — accusé de réception, litige, reçus contresignés.
              Placé juste sous le portefeuille : c'est la suite logique de « À
              recevoir », et la seule action qui solde réellement les commissions. */}
          <PromoterPayoutInbox
            promoterId={promoter.id}
            promoterIban={promoter.iban}
            payerName={scopeName}
            onSettled={onProfileSaved}
          />

          {/* Commission Rules & Rewards - from template */}
          <Card>
            <CardHeader className="px-4 pb-2 pt-4 sm:px-6 sm:pt-6">
              <CardTitle className="text-base flex items-center gap-2">
                <Gift className="h-4 w-4 shrink-0" />
                <span className="min-w-0 truncate">{t('promoter.commission')} — {scopeName}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 px-4 pb-4 text-sm sm:px-6 sm:pb-6">
              {templateRules ? (
                <>
                  {/* Only show flat ticket/table rules if NO tiers are defined */}
                  {(!templateRules.tiers || templateRules.tiers.length === 0) && (
                    <>
                      {templateRules.ticket && (
                        <div className="flex justify-between gap-3">
                          <span className="min-w-0 truncate text-muted-foreground">{t('promoter.ticketsSold')}</span>
                          <span className="shrink-0 whitespace-nowrap font-medium">
                            {templateRules.ticket.type === 'percentage' ? `${templateRules.ticket.value}%` : `${templateRules.ticket.value}€`}
                          </span>
                        </div>
                      )}
                      {templateRules.table && (
                        <div className="flex justify-between gap-3">
                          <span className="min-w-0 truncate text-muted-foreground">{t('promoter.tablesReserved')}</span>
                          <span className="shrink-0 whitespace-nowrap font-medium">
                            {templateRules.table.type === 'percentage' ? `${templateRules.table.value}%` : `${templateRules.table.value}€`}
                          </span>
                        </div>
                      )}
                    </>
                  )}
                  {templateRules.tiers && templateRules.tiers.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground mb-1">Paliers de récompenses :</p>
                      {templateRules.tiers.map((tier, i) => {
                        const rewardLabel = tier.reward_type === 'none' ? 'Pas de recompense'
                          : tier.reward_type === 'free_entry' ? 'Entree gratuite'
                          : tier.reward_type === 'vip' ? 'Table VIP'
                          : tier.reward_type === 'drinks' ? 'Boissons offertes'
                          : tier.reward_type === 'money' ? `${tier.ticketValue || 0}€`
                          : tier.reward_type;
                        return (
                          <div key={i} className="flex items-center justify-between gap-3 text-xs">
                            <span className="min-w-0 truncate">{tier.min}{tier.max ? `–${tier.max}` : '+'} ventes</span>
                            <Badge variant="outline" className="shrink-0 text-[10px]">{rewardLabel}</Badge>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {/* Customer discount info */}
                  {templateRules.customer_discount && (
                    <div className="pt-2 border-t border-border">
                      <p className="text-xs font-medium text-muted-foreground mb-1">Avantage client :</p>
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <span className="min-w-0 truncate">{templateRules.customer_discount.label || 'Réduction via votre lien'}</span>
                        <Badge variant="secondary" className="shrink-0 text-[10px]">
                          {templateRules.customer_discount.type === 'percentage'
                            ? `-${templateRules.customer_discount.value}%`
                            : `-${templateRules.customer_discount.value}€`}
                        </Badge>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="flex justify-between gap-3">
                    <span className="min-w-0 truncate text-muted-foreground">{t('promoter.ticketsSold')}</span>
                    <span className="shrink-0 whitespace-nowrap font-medium">
                      {promoter.ticket_commission_type === 'percentage'
                        ? `${promoter.ticket_commission_value}%`
                        : `${promoter.ticket_commission_value}€`}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="min-w-0 truncate text-muted-foreground">{t('promoter.tablesReserved')}</span>
                    <span className="shrink-0 whitespace-nowrap font-medium">
                      {promoter.table_commission_type === 'percentage'
                        ? `${promoter.table_commission_value}%`
                        : `${promoter.table_commission_value}€`}
                    </span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Guest-list allocation is managed on the club's Guest List page now. */}

          {teamInfo && (
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <p className="min-w-0 flex-1 truncate font-semibold text-sm">{teamInfo.name}</p>
                  <Badge variant="secondary" className="shrink-0 whitespace-nowrap text-xs">{teamInfo.memberCount} membres</Badge>
                </div>
                {teamInfo.leaderName && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1 truncate"><Crown className="h-3 w-3 shrink-0 text-primary" /> Chef d'equipe : {teamInfo.leaderName}</p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Announcements */}
          {announcements.length > 0 && (
            <Card>
              <CardHeader className="px-4 pb-2 pt-4 sm:px-6 sm:pt-6">
                <CardTitle className="text-base flex items-center gap-2">
                  <Megaphone className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 truncate">{scopeName}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 px-4 pb-4 sm:px-6 sm:pb-6">
                {announcements.map((a) => (
                  <div key={a.id} className="p-3 bg-muted rounded-lg">
                    <p className="font-medium text-sm break-words">{a.title}</p>
                    <p className="text-xs text-muted-foreground mt-1 break-words">{a.content}</p>
                    <p className="text-xs text-muted-foreground mt-2">
                      {new Date(a.created_at).toLocaleDateString(language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-US')}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── MY EVENTS ── */}
        <TabsContent value="events" className="space-y-4 mt-4">
          <DateRangeFilter value={dateRange} onChange={setDateRange} includeUpcoming />

          {eventStatsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <Card key={i}><CardContent className="p-4 space-y-3">
                  <Skeleton className="h-5 w-2/3" />
                  <div className="grid grid-cols-4 gap-2">
                    {[1, 2, 3, 4].map(j => <Skeleton key={j} className="h-12" />)}
                  </div>
                </CardContent></Card>
              ))}
            </div>
          ) : eventStats.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground">{t('promoter.noEvents')}</CardContent></Card>
          ) : (
            <div className="space-y-3">
              {eventStats.map((es) => {
                const evtData = events.find(e => e.id === es.eventId);
                const status = getEventStatus(es.eventDate, evtData?.end_at);
                const isExpanded = expandedEvent === es.eventId;
                return (
                  <Card key={es.eventId} className="overflow-hidden cursor-pointer hover:border-primary/50 transition-colors"
>
                    <div
                      onClick={() => navigate(`/promoter/event/${es.eventId}`)}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <h3 className="min-w-0 flex-1 font-semibold text-sm truncate">{es.eventTitle}</h3>
                            <Badge variant={status === 'active' ? 'default' : status === 'upcoming' ? 'secondary' : 'outline'} className="text-xs shrink-0">
                              {status === 'active' ? t('promoter.active') : status === 'upcoming' ? t('promoter.upcomingEvents') : t('promoter.pastEvents')}
                            </Badge>
                          </div>
                          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                          <div className="min-w-0">
                            <p className="truncate text-lg font-bold tabular-nums">{es.ticketsSold}</p>
                            <p className="truncate text-xs text-muted-foreground">{t('promoter.ticketsSold')}</p>
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-lg font-bold tabular-nums">{fmtEur(es.revenue)}</p>
                            <p className="truncate text-xs text-muted-foreground">{t('promoter.revenue')}</p>
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-lg font-bold tabular-nums text-primary">{fmtEur(es.commission)}</p>
                            <p className="truncate text-xs text-muted-foreground">{t('promoter.commission')}</p>
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-lg font-bold tabular-nums">{es.conversionRate.toFixed(1)}%</p>
                            <p className="truncate text-xs text-muted-foreground">{t('promoter.conversionRate')}</p>
                          </div>
                        </div>
                        {es.goalTarget && es.goalProgress !== undefined && (
                          <div className="mt-3">
                            <div className="flex justify-between gap-2 text-xs text-muted-foreground mb-1">
                              <span className="min-w-0 truncate">{t('promoter.goalProgress')}</span>
                              <span className="shrink-0 tabular-nums">{es.ticketsSold}/{es.goalTarget}</span>
                            </div>
                            <Progress value={es.goalProgress} className="h-1.5" />
                          </div>
                        )}
                      </CardContent>
                    </div>
                  </Card>

                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ── LINK & SHARING TOOLS ── */}
        <TabsContent value="links" className="space-y-4 mt-4">
          {/* Main Link */}
          <Card className="border-primary/30 bg-primary/5">
            <CardHeader className="px-4 pb-2 pt-4 sm:px-6 sm:pt-6">
              <CardTitle className="text-base flex items-center gap-2">
                <ExternalLink className="h-4 w-4 shrink-0" />
                <span className="min-w-0 truncate">{t('promoter.promoLink')}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 px-4 pb-4 sm:px-6 sm:pb-6">
              {/* Event filter */}
              <Select value={eventFilter || 'all'} onValueChange={(v) => setEventFilter(v === 'all' ? null : v)}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder={t('promoter.filterByEvent')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('promoter.allEvents')}</SelectItem>
                  {events.map(e => (
                    <SelectItem key={e.id} value={e.id}>
                      {/* Titre saisi par le club → tronquer plutôt qu'élargir le popup hors écran. */}
                      <span className="block max-w-[min(72vw,18rem)] truncate">{e.title}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Source tag */}
              <Select value={sourceTag || 'none'} onValueChange={(v) => setSourceTag(v === 'none' ? '' : v)}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder={t('promoter.sourceTag')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('promoter.sourceTag')} —</SelectItem>
                  <SelectItem value="instagram">Instagram</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="tiktok">TikTok</SelectItem>
                  <SelectItem value="snapchat">Snapchat</SelectItem>
                  <SelectItem value="qr">QR Code</SelectItem>
                </SelectContent>
              </Select>

              {(eventFilter ? eventPromoLink : promoLink) && (
                <>
                  <div className="flex gap-2">
                    <Input value={(eventFilter ? eventPromoLink : promoLink)!} readOnly className="min-w-0 flex-1 text-xs font-mono bg-background/50" />
                    <Button size="icon" variant="outline" className="shrink-0" onClick={() => {
                      navigator.clipboard.writeText((eventFilter ? eventPromoLink : promoLink)!);
                      toast.success(t('promoter.linkCopied'));
                    }}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" className="flex-1" onClick={shareLink}>
                      <Share2 className="h-4 w-4 mr-2" />
                      {t('promoter.shareLink')}
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* QR Code */}
          {qrDataUrl && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <QrCode className="h-4 w-4" />
                  {t('promoter.qrCode')}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex justify-center">
                <img src={qrDataUrl} alt="QR Code" className="w-48 h-48 rounded-lg" />
              </CardContent>
            </Card>
          )}

          {/* Promo Code Badge */}
          <Card>
            <CardContent className="p-4 flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-muted-foreground">Code promo</p>
                <p className="truncate text-xl font-bold font-mono">{promoter.promo_code}</p>
              </div>
              {promoter.instagram_url && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-10 shrink-0"
                  onClick={() => window.open(promoter.instagram_url!, '_blank')}
                >
                  <Instagram className="h-4 w-4 mr-1" />
                  Instagram
                </Button>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── SCAN ── */}
        {canScan && (
          <TabsContent value="scan" className="space-y-4 mt-4">
            {/* La soirée est détectée automatiquement (live, sinon la prochaine).
                Le sélecteur n'apparaît que s'il y a plusieurs candidates. */}
            {scanEvents.length > 1 && (
              <Select value={selectedScanEvent} onValueChange={setSelectedScanEvent}>
                <SelectTrigger>
                  <SelectValue placeholder={t('promoter.filterByEvent')} />
                </SelectTrigger>
                <SelectContent>
                  {scanEvents.map(a => (
                    <SelectItem key={a.eventId} value={a.eventId}>
                      <span className="block max-w-[min(72vw,18rem)] truncate">{a.eventTitle}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {selectedScanEvent ? (
              <PromoterScanTab
                promoterId={promoter.id}
                eventId={selectedScanEvent}
                eventTitle={scanEvents.find(a => a.eventId === selectedScanEvent)?.eventTitle || ''}
              />
            ) : (
              <Card><CardContent className="p-8 text-center text-muted-foreground text-sm">
                {t('promoterScan.noEventToScan')}
              </CardContent></Card>
            )}
          </TabsContent>
        )}

        {/* ── GUEST LIST ── */}
        {hasGuestListAccess && (
          <TabsContent value="guestlist" className="space-y-4 mt-4">
            <PromoterGuestListTab
              promoterProfiles={allPromoterProfiles || [promoter]}
            />
          </TabsContent>
        )}

        {/* ── TEAM (Leader only) ── */}
        {teamInfo?.isLeader && (
          <TabsContent value="team" className="space-y-4 mt-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Users className="h-4 w-4 shrink-0 text-primary" />
                  <h3 className="min-w-0 flex-1 truncate font-semibold text-sm">{teamInfo.name}</h3>
                  <Badge variant="secondary" className="shrink-0 whitespace-nowrap text-xs">{teamMembers.length} membres</Badge>
                </div>
                <p className="text-xs text-muted-foreground mb-4">Performance de votre equipe</p>
                <div className="grid grid-cols-3 gap-2 mb-4">
                  <div className="min-w-0 bg-muted/50 rounded-lg p-2 text-center">
                    <p className="truncate text-lg font-bold tabular-nums">{teamMembers.reduce((s, m) => s + m.conversions, 0)}</p>
                    <p className="truncate text-[10px] text-muted-foreground">Ventes</p>
                  </div>
                  <div className="min-w-0 bg-muted/50 rounded-lg p-2 text-center">
                    <p className="truncate text-lg font-bold tabular-nums">{teamMembers.reduce((s, m) => s + m.revenue, 0).toFixed(0)}€</p>
                    <p className="truncate text-[10px] text-muted-foreground">CA total</p>
                  </div>
                  <div className="min-w-0 bg-muted/50 rounded-lg p-2 text-center">
                    <p className="truncate text-lg font-bold tabular-nums text-primary">{teamMembers.reduce((s, m) => s + m.commission, 0).toFixed(0)}€</p>
                    <p className="truncate text-[10px] text-muted-foreground">Commission</p>
                  </div>
                </div>
                <div className="space-y-2">
                  {teamMembers.map((m, idx) => (
                    <div key={m.id} className="p-3 bg-muted/30 rounded-lg">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="shrink-0 text-xs font-bold text-muted-foreground">#{idx + 1}</span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{m.label}</span>
                        {m.id === promoter.id && <Badge variant="outline" className="shrink-0 whitespace-nowrap text-[10px]"><Crown className="h-2.5 w-2.5 mr-0.5" /> Vous</Badge>}
                      </div>
                      <div className="grid grid-cols-4 gap-2 text-center">
                        <div className="min-w-0"><p className="truncate text-xs font-bold tabular-nums">{m.clicks}</p><p className="truncate text-[9px] text-muted-foreground">Clicks</p></div>
                        <div className="min-w-0"><p className="truncate text-xs font-bold tabular-nums">{m.conversions}</p><p className="truncate text-[9px] text-muted-foreground">Ventes</p></div>
                        <div className="min-w-0"><p className="truncate text-xs font-bold tabular-nums">{m.revenue.toFixed(0)}€</p><p className="truncate text-[9px] text-muted-foreground">CA</p></div>
                        <div className="min-w-0"><p className="truncate text-xs font-bold tabular-nums text-primary">{m.commission.toFixed(0)}€</p><p className="truncate text-[9px] text-muted-foreground">Comm.</p></div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* ── PROFILE ── */}
        <TabsContent value="profile" className="space-y-4 mt-4">
          <PromoterProfileTab promoter={promoter} allPromoterProfiles={allPromoterProfiles} onSaved={onProfileSaved} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
