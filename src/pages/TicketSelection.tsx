import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useSearchParams, useLocation } from 'react-router-dom';
import { usePreviewNavigate } from '@/contexts/OwnerPreviewContext';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Minus, Plus, Users, Crown, Wine, Clock, ChevronDown, Lock, Ticket, Check } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { TicketRound, TableZone, TablePack, TicketSellingMode, getEventSalesStatus, calculateServiceFee } from '@/types/ticketing';
import { EventSalesStatus } from '@/components/ticketing/EventSalesStatus';
import { EventWaitlistForm } from '@/components/ticketing/EventWaitlistForm';
import { getOptimizedImageUrl } from '@/lib/imageOptimization';
import { toast } from 'sonner';
import { StickyCheckoutFooter } from '@/components/StickyCheckoutFooter';
import { CheckoutSteps } from '@/components/CheckoutSteps';
import { getStoredPromoCodeForVenue, usePromoterTracking } from '@/hooks/usePromoterTracking';
import { ClientFloorPlanPicker } from '@/components/vip/ClientFloorPlanPicker';
import { VenueFloorPlan } from '@/types';
import { useEventScarcity, type ScarcitySettings } from '@/hooks/useScarcitySettings';
import { cn } from '@/lib/utils';

type SelectionType = 'ticket' | 'table' | 'guestlist';
type Selection = {
  type: SelectionType;
  id: string;
  quantity: number;
  price: number;
  name: string;
  zoneId?: string;
  deposit?: number;
  depositType?: 'fixed' | 'percentage';
  gender?: 'female' | 'male';
};

export default function TicketSelection() {
  const { eventId, slug } = useParams();
  const navigate = usePreviewNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { t, language } = useLanguage();

  const [loading, setLoading] = useState(true);
  const [eventData, setEventData] = useState<{
    title: string; posterUrl?: string; startAt: string;
    ticketingEnabled: boolean; tablesEnabled: boolean; venueId: string | null;
    ticketSellingMode: TicketSellingMode; presaleStartAt?: string; publicSaleStartAt?: string;
    waitlistEnabled?: boolean; maxTickets?: number | null; roundsVisibility?: 'sequential' | 'preview_upcoming' | 'all_open';
    alcoholFree?: boolean; maxTicketsPerPerson?: number | null; salePasswordEnabled?: boolean;
  } | null>(null);
  const [hasPresaleAccess, setHasPresaleAccess] = useState(false);
  // Password-gated sale: unlocked state is per-event, persisted for the session.
  const [saleUnlocked, setSaleUnlocked] = useState(false);
  const [pwInput, setPwInput] = useState('');
  const [pwSubmitting, setPwSubmitting] = useState(false);
  const [ticketRounds, setTicketRounds] = useState<TicketRound[]>([]);
  const [, setNowTick] = useState(Date.now());
  const [zones, setZones] = useState<TableZone[]>([]);
  const [packs, setPacks] = useState<TablePack[]>([]);
  const [reservationsByZone, setReservationsByZone] = useState<Record<string, number>>({});
  const [guestList, setGuestList] = useState<{ id: string; quota: number; quotaFemale: number | null; quotaMale: number | null; freeBeforeTime: string; includesDrink: boolean; shareToken: string; count: number; femaleCount: number; maleCount: number } | null>(null);
  const [floorPlan, setFloorPlan] = useState<VenueFloorPlan | null>(null);

  const [selection, setSelection] = useState<Selection | null>(() => {
    const restored = (location.state as any)?.restoredSelection;
    return restored || null;
  });
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  // Tickets ⇄ Tables VIP quick-nav (only rendered when the event sells both).
  const [activeTab, setActiveTab] = useState<'tickets' | 'tables'>('tickets');
  const ticketsRef = useRef<HTMLDivElement>(null);
  const tablesRef = useRef<HTMLDivElement>(null);

  usePromoterTracking(eventData?.venueId || slug, eventId);
  const scarcitySettings = useEventScarcity(eventId);

  useEffect(() => {
    if (eventId) fetchData();
    // No eventId (malformed link): stop loading so the "event not found"
    // state renders instead of an infinite spinner.
    else setLoading(false);
  }, [eventId]);

  useEffect(() => {
    const interval = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Show VIP tiers cheapest → most expensive for the client. A zone's price is
  // its cheapest pack; zones with no packs fall to the end.
  const sortedZones = useMemo(() => {
    const zonePrice = (zoneId: string) => {
      const zp = packs.filter(p => p.zoneId === zoneId);
      return zp.length ? Math.min(...zp.map(p => p.basePrice)) : Infinity;
    };
    return [...zones].sort((a, b) => zonePrice(a.id) - zonePrice(b.id));
  }, [zones, packs]);

  useEffect(() => {
    if (!loading && sortedZones.length > 0 && !selectedZoneId) {
      setSelectedZoneId(sortedZones[0].id);
    }
  }, [loading, sortedZones, selectedZoneId]);

  const fetchData = async () => {
    try {
      const { data: ev, error } = await supabase
        .from('events')
        .select('title, poster_url, start_at, ticketing_enabled, tables_enabled, venue_id, partner_venue_id, tables_mode, ticket_selling_mode, presale_start_at, public_sale_start_at, waitlist_enabled, max_tickets, rounds_visibility, alcohol_free, max_tickets_per_person, sale_password_enabled')
        .eq('id', eventId)
        .single();
      if (error) throw error;

      const effectiveVenueId = ev.venue_id || (ev as any).partner_venue_id || null;
      const isBasicTables = (ev as any).tables_mode === 'basic' || !ev.venue_id;

      const evData = {
        title: ev.title, posterUrl: ev.poster_url || undefined,
        startAt: ev.start_at, ticketingEnabled: ev.ticketing_enabled, tablesEnabled: ev.tables_enabled,
        venueId: effectiveVenueId,
        ticketSellingMode: ((ev as any).ticket_selling_mode as TicketSellingMode) || 'rounds',
        presaleStartAt: ev.presale_start_at || undefined, publicSaleStartAt: ev.public_sale_start_at || undefined,
        waitlistEnabled: ev.waitlist_enabled || false, maxTickets: ev.max_tickets ?? null,
        roundsVisibility: ((ev as any).rounds_visibility as 'sequential' | 'preview_upcoming' | 'all_open') ?? 'sequential',
        alcoholFree: (ev as any).alcohol_free ?? false,
        maxTicketsPerPerson: (ev as any).max_tickets_per_person ?? null,
        salePasswordEnabled: (ev as any).sale_password_enabled ?? false,
      };
      setEventData(evData);

      // Restore prior unlock for password-gated sales (session-scoped).
      if (evData.salePasswordEnabled && sessionStorage.getItem(`yuno_sale_unlock_${eventId}`) === '1') {
        setSaleUnlocked(true);
      }

      if (ev.ticketing_enabled) {
        const { data: rounds } = await supabase.from('ticket_rounds').select('*').eq('event_id', eventId).order('position', { ascending: true });
        if (rounds) {
          setTicketRounds(rounds.map(r => ({
            id: r.id, eventId: r.event_id, name: r.name, description: r.description,
            price: Number(r.price), maxTickets: r.max_tickets, ticketsSold: r.tickets_sold,
            position: r.position, isActive: r.is_active, autoActivate: r.auto_activate,
            lastTicketsThreshold: r.last_tickets_threshold ?? 20, includesDrink: r.includes_drink ?? false,
            drinkDeadlineType: (r.drink_deadline_type as 'hours_after_start' | 'fixed_time') ?? 'hours_after_start',
            drinkDeadlineHours: r.drink_deadline_hours, drinkCutoffTime: r.drink_cutoff_time,
            entryDeadline: (r as any).entry_deadline ? (r as any).entry_deadline.substring(0, 5) : undefined,
            ticketType: ((r as any).ticket_type as 'standard' | 'vip') ?? 'standard',
            createdAt: r.created_at, updatedAt: r.updated_at,
          })));
        }
      }

      if (ev.tables_enabled) {
        const zoneQuery = isBasicTables
          ? supabase.from('table_zones').select('*').eq('event_id', eventId).order('position', { ascending: true })
          : supabase.from('table_zones').select('*').eq('venue_id', effectiveVenueId).order('position', { ascending: true });
        const { data: zonesData } = await zoneQuery;
        if (zonesData) {
          setZones(zonesData.map(z => ({
            id: z.id, venueId: z.venue_id, name: z.name, color: z.color,
            tablesCount: z.tables_count || 1, position: z.position,
            lastTablesThreshold: z.last_tables_threshold ?? 20, createdAt: z.created_at, updatedAt: z.updated_at,
          })));
        }

        const packQuery = isBasicTables
          ? supabase.from('table_packs').select('*').eq('event_id', eventId).eq('is_active', true).order('position', { ascending: true })
          : supabase.from('table_packs').select('*').eq('venue_id', effectiveVenueId).eq('is_active', true).order('position', { ascending: true });
        const { data: packsData } = await packQuery;

        const { data: eventSettingsData } = await supabase.from('event_table_settings').select('*').eq('event_id', eventId).single();
        let priceOverrides: Record<string, number> = {};
        if (eventSettingsData?.preset_id) {
          const { data: presetData } = await supabase.from('table_pack_presets').select('*').eq('id', eventSettingsData.preset_id).single();
          if (presetData?.packs) {
            (presetData.packs as { packId: string; customPrice: number | null }[]).forEach(pp => {
              if (pp.customPrice !== null) priceOverrides[pp.packId] = pp.customPrice;
            });
          }
        } else if (eventSettingsData?.custom_prices) {
          (eventSettingsData.custom_prices as { packId: string; customPrice: number | null }[]).forEach(cp => {
            if (cp.customPrice !== null) priceOverrides[cp.packId] = cp.customPrice;
          });
        }

        if (packsData) {
          setPacks(packsData.map(p => ({
            id: p.id, zoneId: p.zone_id, venueId: p.venue_id, name: p.name, description: p.description,
            basePrice: priceOverrides[p.id] ?? Number(p.base_price), baseCapacity: p.base_capacity,
            extraPersonPrice: p.extra_person_price ? Number(p.extra_person_price) : 0,
            maxExtraPersons: p.max_extra_persons ?? 0, deposit: p.deposit ? Number(p.deposit) : 0,
            depositType: ((p as any).deposit_type as 'fixed' | 'percentage') || 'fixed',
            includedItems: p.included_items, includedBottlesQuota: (p as any).included_bottles_quota || 0,
            minimumSpend: Number((p as any).minimum_spend) || 0, tablesCount: p.tables_count || 1,
            position: p.position, isActive: p.is_active, createdAt: p.created_at, updatedAt: p.updated_at,
          })));
        }

        const { data: reservationsData } = await supabase.from('table_reservations').select('zone_id').eq('event_id', eventId).eq('status', 'paid');
        if (reservationsData) {
          const countsByZone: Record<string, number> = {};
          reservationsData.forEach(r => { if (r.zone_id) countsByZone[r.zone_id] = (countsByZone[r.zone_id] || 0) + 1; });
          setReservationsByZone(countsByZone);
        }

        const { data: fpEvent } = await supabase.from('venue_floor_plans').select('*').eq('event_id', eventId!).maybeSingle();
        let fpData = fpEvent;
        if (!fpData && effectiveVenueId) {
          const { data: fpVenue } = await supabase.from('venue_floor_plans').select('*').eq('venue_id', effectiveVenueId).is('event_id', null).maybeSingle();
          fpData = fpVenue;
        }
        if (fpData) {
          setFloorPlan({
            id: fpData.id, venueId: fpData.venue_id,
            layout: fpData.layout as VenueFloorPlan['layout'],
            createdAt: fpData.created_at, updatedAt: fpData.updated_at,
            backgroundImageUrl: fpData.background_image_url || undefined,
          } as VenueFloorPlan & { backgroundImageUrl?: string });
        } else {
          setFloorPlan(null);
        }
      }

      const { data: glData } = await supabase.from('guest_lists').select('id, quota, quota_female, quota_male, free_before_time, includes_drink, share_token, visible_on_club_page')
        .eq('event_id', eventId!).eq('is_active', true).eq('visible_on_club_page', true).maybeSingle();
      if (glData) {
        const { count: c } = await supabase.from('guest_list_entries').select('*', { count: 'exact', head: true })
          .eq('guest_list_id', glData.id).neq('status', 'cancelled');
        // Gendered guest lists are published as two separate cards (Femme / Homme),
        // so we need each gender's fill to show remaining + sold-out per card.
        const hasGenderSplit = glData.quota_female !== null || glData.quota_male !== null;
        let fCount = 0, mCount = 0;
        if (hasGenderSplit) {
          const [{ count: fc }, { count: mc }] = await Promise.all([
            supabase.from('guest_list_entries').select('*', { count: 'exact', head: true }).eq('guest_list_id', glData.id).eq('gender', 'female').neq('status', 'cancelled'),
            supabase.from('guest_list_entries').select('*', { count: 'exact', head: true }).eq('guest_list_id', glData.id).eq('gender', 'male').neq('status', 'cancelled'),
          ]);
          fCount = fc || 0; mCount = mc || 0;
        }
        setGuestList({ id: glData.id, quota: glData.quota, quotaFemale: glData.quota_female, quotaMale: glData.quota_male, freeBeforeTime: glData.free_before_time?.substring(0, 5) || '02:00', includesDrink: glData.includes_drink, shareToken: glData.share_token, count: c || 0, femaleCount: fCount, maleCount: mCount });
      }

      const hasPromoRef = !!searchParams.get('ref') || !!getStoredPromoCodeForVenue(effectiveVenueId || undefined);
      if (hasPromoRef) {
        setHasPresaleAccess(true);
      } else {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const filters = [`user_id.eq.${user.id}`];
          const normalizedEmail = user.email?.toLowerCase().trim();
          if (normalizedEmail) filters.push(`email.eq.${normalizedEmail}`);
          const { data: wlEntry } = await supabase.from('event_waitlist').select('id, presale_access').eq('event_id', eventId!).or(filters.join(',')).maybeSingle();
          setHasPresaleAccess(!!wlEntry);
        } else {
          setHasPresaleAccess(false);
        }
      }
    } catch (err) {
      console.error(err);
      toast.error(t('tickets.errorLoading'));
    } finally {
      setLoading(false);
    }
  };

  const standardRounds = ticketRounds.filter(r => r.ticketType === 'standard');
  const vipRounds = ticketRounds.filter(r => r.ticketType === 'vip');
  const isTimedEntry = eventData?.ticketSellingMode === 'timed_entry';
  const isSimple = eventData?.ticketSellingMode === 'simple';
  const totalSoldAllRounds = ticketRounds.reduce((sum, r) => sum + r.ticketsSold, 0);
  const simpleGlobalSoldOut = isSimple && eventData?.maxTickets ? totalSoldAllRounds >= eventData.maxTickets : false;
  const allRoundsSoldOut = simpleGlobalSoldOut || (ticketRounds.length > 0 && ticketRounds.every(r => r.ticketsSold >= r.maxTickets));
  const salesStatus = eventData
    ? getEventSalesStatus({ presaleStartAt: eventData.presaleStartAt, publicSaleStartAt: eventData.publicSaleStartAt, waitlistEnabled: eventData.waitlistEnabled }, allRoundsSoldOut)
    : 'public_sale' as const;

  const visibility = eventData?.roundsVisibility ?? 'sequential';
  const getVisibleRounds = (rounds: TicketRound[]): Array<TicketRound & { _previewOnly?: boolean }> => {
    if (isSimple || isTimedEntry) return rounds;
    if (visibility === 'all_open') return rounds;
    if (visibility === 'sequential') {
      const visible: Array<TicketRound & { _previewOnly?: boolean }> = [];
      let foundAvailable = false;
      for (const r of rounds) {
        const soldOut = r.ticketsSold >= r.maxTickets;
        if (soldOut) { visible.push(r); }
        else if (!foundAvailable) { visible.push(r); foundAvailable = true; }
      }
      return visible;
    }
    const visible: Array<TicketRound & { _previewOnly?: boolean }> = [];
    let foundAvailable = false;
    for (const r of rounds) {
      const soldOut = r.ticketsSold >= r.maxTickets;
      if (soldOut) { visible.push(r); continue; }
      if (!foundAvailable) { visible.push(r); foundAvailable = true; }
      else { visible.push({ ...r, _previewOnly: true }); }
    }
    return visible;
  };

  const heroImage = eventData?.posterUrl;
  const salesIsOpen = salesStatus === 'public_sale' || (salesStatus === 'presale' && hasPresaleAccess);
  // Password-gated sale: hide everything buyable until the buyer unlocks.
  const saleLocked = !!eventData?.salePasswordEnabled && !saleUnlocked;
  // Per-order ticket cap mirrors the owner's per-person limit (server enforces
  // the true cumulative cap). No limit set → keep the historical default of 10.
  const ticketMax = eventData?.maxTicketsPerPerson ?? 10;

  // Tickets ⇄ Tables VIP quick-nav: only worth showing when the event sells both.
  const ticketsExist = salesIsOpen && !saleLocked && (standardRounds.length > 0 || vipRounds.length > 0);
  const tablesExist = salesIsOpen && !saleLocked && zones.length > 0;
  const showSectionTabs = ticketsExist && tablesExist;

  const scrollToSection = (ref: React.RefObject<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    // Offset for the sticky tab bar so the heading isn't tucked under it.
    const y = el.getBoundingClientRect().top + window.scrollY - 60;
    window.scrollTo({ top: y, behavior: 'smooth' });
  };

  // Scroll spy: highlight the tab for whichever section is in view.
  useEffect(() => {
    if (!showSectionTabs) return;
    const onScroll = () => {
      const top = tablesRef.current?.getBoundingClientRect().top;
      if (top == null) return;
      setActiveTab(top <= 72 ? 'tables' : 'tickets');
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, [showSectionTabs]);

  const handleUnlock = async () => {
    const pw = pwInput.trim();
    if (!pw || !eventId) return;
    setPwSubmitting(true);
    try {
      const { data, error } = await supabase.rpc('unlock_event_sale' as any, { p_event_id: eventId, p_password: pw });
      if (error) throw error;
      if (data === true) {
        setSaleUnlocked(true);
        sessionStorage.setItem(`yuno_sale_unlock_${eventId}`, '1');
        // Remembered so checkout can mint the per-buyer grant once the email is known.
        sessionStorage.setItem(`yuno_sale_pw_${eventId}`, pw);
        setPwInput('');
      } else {
        toast.error(t('tickets.salePasswordWrong'));
      }
    } catch (err) {
      console.error(err);
      toast.error(t('tickets.errorLoading'));
    } finally {
      setPwSubmitting(false);
    }
  };

  const selectItem = (type: SelectionType, id: string, price: number, name: string, zoneId?: string, deposit?: number, depositType?: 'fixed' | 'percentage') => {
    if (selection?.id === id) { setSelection(null); }
    else { setSelection({ type, id, quantity: 1, price, name, zoneId, deposit, depositType }); }
  };

  const updateQuantity = (delta: number) => {
    if (!selection) return;
    const cap = selection.type === 'ticket' ? ticketMax : 10;
    const newQty = selection.quantity + delta;
    if (newQty <= 0) { setSelection(null); }
    else if (newQty <= cap) { setSelection({ ...selection, quantity: newQty }); }
  };

  const handleContinue = () => {
    if (!selection) return;
    const ref = (searchParams.get('ref') || '').trim();
    const src = (searchParams.get('src') || '').trim();
    if (selection.type === 'guestlist') {
      // Public guest list → stay in the normal Yuno reservation flow, no jump to
      // the standalone share-link page. A gendered selection carries its gender so
      // checkout skips the in-page gender picker entirely.
      const params = new URLSearchParams();
      if (selection.gender) params.set('gender', selection.gender);
      if (ref) params.set('ref', ref);
      if (src) params.set('src', src);
      const suffix = params.toString() ? `?${params.toString()}` : '';
      navigate(`/club/${slug}/event/${eventId}/guestlist-checkout${suffix}`);
      return;
    }
    if (selection.type === 'ticket') {
      const params = new URLSearchParams();
      if (ref) params.set('ref', ref);
      if (src) params.set('src', src);
      const suffix = params.toString() ? `?${params.toString()}` : '';
      navigate(`/club/${slug}/event/${eventId}/tickets/${selection.id}${suffix}`);
      return;
    }
    const tableParams = new URLSearchParams();
    if (selection.zoneId) tableParams.set('zone', selection.zoneId);
    tableParams.set('guests', String(selection.quantity));
    if (ref) tableParams.set('ref', ref);
    if (src) tableParams.set('src', src);
    navigate(`/club/${slug}/event/${eventId}/table/${selection.id}?${tableParams.toString()}`);
  };

  const total = selection ? selection.price * selection.quantity : 0;
  const totalWithFees = (() => {
    if (total <= 0 || !selection) return 0;
    if (selection.type === 'table' && selection.deposit !== undefined && selection.deposit > 0) {
      let depositAmount: number;
      if (selection.depositType === 'percentage') {
        depositAmount = Math.round(total * selection.deposit / 100 * 100) / 100;
      } else {
        depositAmount = selection.deposit;
      }
      return total + calculateServiceFee(depositAmount, 'tables');
    }
    return total + calculateServiceFee(total, selection.type === 'table' ? 'tables' : 'tickets');
  })();

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!eventData) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 gap-4">
        <p className="text-muted-foreground text-sm">{t('tickets.eventNotFound')}</p>
        <button onClick={() => navigate(`/club/${slug}/event/${eventId}`)} className="flex items-center gap-2 text-sm text-white/50 hover:text-white transition-colors">
          <ArrowLeft className="h-4 w-4" /> {t('common.back')}
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-36">
      {/* Blurred hero header */}
      <div className="relative overflow-hidden" style={{ height: 'calc(11rem + env(safe-area-inset-top, 0px))' }}>
        {heroImage && (
          <img
            src={getOptimizedImageUrl(heroImage, { width: 800, quality: 60 })}
            alt=""
            className="absolute inset-0 w-full h-full object-cover blur-2xl scale-110 opacity-50"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-background/50 to-background" />
        <button
          onClick={() => navigate(`/club/${slug}/event/${eventId}`)}
          className="absolute left-4 z-10 flex items-center justify-center h-9 w-9 text-white hover:opacity-80 transition-opacity"
          style={{ top: 'calc(env(safe-area-inset-top, 0px) + 1rem)', borderRadius: '2px', background: 'rgba(0,0,0,0.40)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', border: 'none' }}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="absolute bottom-5 left-4 right-4 z-10">
          <h1 className="text-xl font-bold tracking-tight">{t('ticketSel.title')}</h1>
          <p className="text-xs text-white/50 mt-0.5 font-medium">{eventData.title}</p>
        </div>
      </div>

      {/* Progress steps */}
      <div className="px-4 pt-3">
        <CheckoutSteps currentStep={1} />
      </div>

      {/* Status banners. We never surface the alcohol-free / minors-allowed nature
          of an event publicly — that only appears as a quiet "no alcohol" line under
          the date-of-birth field in checkout, and only once a minor's date is entered. */}
      <div className="px-4 pt-2 space-y-3">
        {(salesStatus === 'coming_soon' || salesStatus === 'presale' || salesStatus === 'sold_out') && (
          <EventSalesStatus
            event={{ presaleStartAt: eventData.presaleStartAt, publicSaleStartAt: eventData.publicSaleStartAt, waitlistEnabled: eventData.waitlistEnabled }}
            allRoundsSoldOut={salesStatus === 'sold_out'}
            hasPresaleAccess={hasPresaleAccess}
          />
        )}
        {salesStatus === 'coming_soon' && eventData?.waitlistEnabled && (
          <EventWaitlistForm eventId={eventId!} />
        )}
        {salesIsOpen && !saleLocked && eventData?.maxTicketsPerPerson && (
          <div className="flex items-center gap-2 rounded-xl px-3 py-2.5"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <Users className="h-3.5 w-3.5 text-white/45 shrink-0" />
            <span className="text-xs text-white/55">
              {t('tickets.maxPerPersonNotice').replace('{count}', String(eventData.maxTicketsPerPerson))}
            </span>
          </div>
        )}
      </div>

      {/* Password gate */}
      {salesIsOpen && saleLocked && (
        <div className="px-4 mt-4">
          <div className="rounded-2xl border border-white/[0.08] bg-[#141414] p-5 text-center">
            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full" style={{ background: 'rgba(232,25,44,0.10)' }}>
              <Lock className="h-5 w-5 text-primary" />
            </div>
            <h2 className="text-base font-bold">{t('tickets.salePasswordGateTitle')}</h2>
            <p className="text-xs text-white/45 mt-1.5 mb-4 leading-relaxed">{t('tickets.salePasswordGateDesc')}</p>
            <Input
              type="text"
              autoComplete="off"
              value={pwInput}
              onChange={(e) => setPwInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleUnlock(); }}
              placeholder={t('tickets.salePasswordGatePlaceholder')}
              className="text-center"
            />
            <Button
              onClick={handleUnlock}
              disabled={pwSubmitting || !pwInput.trim()}
              className="w-full mt-3 font-semibold"
              style={{ background: '#E8192C', color: '#fff' }}
            >
              {pwSubmitting ? '…' : t('tickets.salePasswordGateUnlock')}
            </Button>
          </div>
        </div>
      )}

      {/* Tickets ⇄ Tables VIP quick-nav */}
      {showSectionTabs && (
        <div
          className="sticky top-0 z-30 px-4 pt-2.5 pb-2 mt-3"
          style={{ background: 'rgba(10,10,10,0.92)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }}
        >
          <div className="flex gap-1.5 p-1 rounded-lg border border-white/[0.07] bg-white/[0.03] max-w-md mx-auto">
            <button
              onClick={() => { setActiveTab('tickets'); scrollToSection(ticketsRef); }}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 h-9 rounded-md text-xs font-bold uppercase tracking-wide transition-all duration-150',
                activeTab === 'tickets' ? 'bg-white/[0.10] text-white' : 'text-white/40 hover:text-white/65'
              )}
            >
              <Ticket className="h-3.5 w-3.5" />
              {t('tickets.tickets')}
            </button>
            <button
              onClick={() => { setActiveTab('tables'); scrollToSection(tablesRef); }}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 h-9 rounded-md text-xs font-bold uppercase tracking-wide transition-all duration-150',
                activeTab === 'tables' ? 'bg-white/[0.10] text-white' : 'text-white/40 hover:text-white/65'
              )}
            >
              <Users className="h-3.5 w-3.5" />
              {t('tables.vipTables')}
            </button>
          </div>
        </div>
      )}

      {/* All sections stacked */}
      <div ref={ticketsRef} className="px-4 mt-4 space-y-2.5">

        {/* STANDARD TICKETS */}
        {salesIsOpen && !saleLocked && standardRounds.length > 0 && (
          <div className="space-y-2.5">
            {getVisibleRounds(standardRounds).map(round => (
              <TicketCard
                key={round.id}
                round={round}
                isSelected={selection?.id === round.id}
                quantity={selection?.id === round.id ? selection.quantity : 0}
                onSelect={() => selectItem('ticket', round.id, round.price, round.name)}
                onQuantityChange={updateQuantity}
                t={t}
                scarcity={scarcitySettings}
                isSimple={isSimple}
                globalMaxTickets={eventData?.maxTickets}
                totalSold={totalSoldAllRounds}
                previewOnly={(round as any)._previewOnly === true}
                maxQuantity={ticketMax}
              />
            ))}
          </div>
        )}

        {/* VIP TICKETS */}
        {salesIsOpen && !saleLocked && vipRounds.length > 0 && (
          <>
            <SectionDivider icon={<Crown className="h-2.5 w-2.5" />} label={t('ticketSel.vipExperience')} />
            <div className="space-y-2.5">
              {getVisibleRounds(vipRounds).map(round => (
                <TicketCard
                  key={round.id}
                  round={round}
                  isSelected={selection?.id === round.id}
                  quantity={selection?.id === round.id ? selection.quantity : 0}
                  onSelect={() => selectItem('ticket', round.id, round.price, round.name)}
                  onQuantityChange={updateQuantity}
                  t={t}
                  isVip
                  scarcity={scarcitySettings}
                  isSimple={isSimple}
                  globalMaxTickets={eventData?.maxTickets}
                  totalSold={totalSoldAllRounds}
                  previewOnly={(round as any)._previewOnly === true}
                  maxQuantity={ticketMax}
                />
              ))}
            </div>
          </>
        )}

        {/* GUEST LIST — under the tickets, above the VIP tables. A gendered list
            publishes as two separate cards (Femme / Homme), no in-page gender picker. */}
        {salesIsOpen && !saleLocked && guestList && (() => {
          const hasSplit = guestList.quotaFemale !== null || guestList.quotaMale !== null;
          const cards: { gender?: 'female' | 'male'; label: string; symbol: string; remaining: number }[] = hasSplit
            ? [
                ...(guestList.quotaFemale && guestList.quotaFemale > 0
                  ? [{ gender: 'female' as const, label: `${t('guestList.title')} ${t('guestList.female')}`, symbol: '♀', remaining: Math.max(0, guestList.quotaFemale - guestList.femaleCount) }]
                  : []),
                ...(guestList.quotaMale && guestList.quotaMale > 0
                  ? [{ gender: 'male' as const, label: `${t('guestList.title')} ${t('guestList.male')}`, symbol: '♂', remaining: Math.max(0, guestList.quotaMale - guestList.maleCount) }]
                  : []),
              ]
            : [{ label: t('guestList.title'), symbol: '', remaining: Math.max(0, guestList.quota - guestList.count) }];

          // Hide the section only when every card is full.
          if (!cards.some(c => c.remaining > 0)) return null;

          return (
            <>
              <SectionDivider icon={<Users className="h-2.5 w-2.5" />} label={t('guestList.title')} />
              {cards.map(c => {
                const isFull = c.remaining <= 0;
                const selId = c.gender ? `${guestList.id}:${c.gender}` : guestList.id;
                const isSel = selection?.type === 'guestlist' && selection.id === selId;
                return (
                  <button
                    key={c.gender || 'all'}
                    disabled={isFull}
                    onClick={() => {
                      if (isFull) return;
                      setSelection(isSel ? null : { type: 'guestlist', id: selId, quantity: 1, price: 0, name: c.label, gender: c.gender });
                    }}
                    className={cn(
                      'relative w-full rounded border p-4 text-left transition-all',
                      isFull
                        ? 'opacity-45 cursor-default border-white/[0.06]'
                        : cn('active:scale-[0.99]', isSel ? 'border-emerald-500/50' : 'border-emerald-500/20 hover:border-emerald-500/35')
                    )}
                    style={{ backgroundColor: isFull ? '#141414' : isSel ? 'rgba(16,185,129,0.10)' : 'rgba(16,185,129,0.04)' }}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm">{c.symbol ? `${c.symbol} ` : ''}{c.label}</span>
                          <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-sm">{t('guestList.free')}</span>
                        </div>
                        <p className="text-[11px] text-white/45 flex items-center gap-1.5">
                          <Clock className="h-3 w-3" />
                          {t('guestList.freeBeforeTime')} {guestList.freeBeforeTime}
                        </p>
                        {guestList.includesDrink && (
                          <p className="text-[11px] text-emerald-400/80 flex items-center gap-1.5">
                            <Wine className="h-3 w-3" />
                            {t('guestList.drinkIncluded')}
                          </p>
                        )}
                      </div>
                      <div className="text-right shrink-0 flex flex-col items-end gap-1.5">
                        {isFull ? (
                          <span className="text-[10px] font-semibold text-white/30 border border-white/10 px-2 py-0.5 rounded-sm">{t('tables.soldOut')}</span>
                        ) : isSel ? (
                          <span className="h-7 w-7 rounded-full bg-emerald-500 flex items-center justify-center">
                            <Check className="h-4 w-4 text-black" strokeWidth={3} />
                          </span>
                        ) : (
                          <p className="text-2xl font-bold text-emerald-400">0 €</p>
                        )}
                        {!isFull && <p className="text-[10px] text-white/35">{c.remaining} {t('guestList.spotsLeft')}</p>}
                      </div>
                    </div>
                  </button>
                );
              })}
            </>
          );
        })()}

        {/* TABLES */}
        {salesIsOpen && !saleLocked && zones.length > 0 && (
          <div ref={tablesRef} className="space-y-2.5">
            <SectionDivider icon={<Users className="h-2.5 w-2.5" />} label={t('tables.vipTables')} />
            <div className="space-y-2.5">
              {/* Zone selector */}
              {zones.length > 1 && (
                <div className="-mx-4 overflow-x-auto scrollbar-hide">
                  <div className="flex gap-1.5 px-4 pb-0.5">
                    {sortedZones.map(zone => {
                      const reserved = reservationsByZone[zone.id] || 0;
                      const remaining = zone.tablesCount - reserved;
                      const isSoldOut = remaining <= 0;
                      const isActive = selectedZoneId === zone.id;
                      return (
                        <button
                          key={zone.id}
                          onClick={() => !isSoldOut && setSelectedZoneId(zone.id)}
                          className={cn(
                            'shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-[11px] font-bold border transition-all duration-150',
                            isSoldOut && 'opacity-35 cursor-default',
                            !isActive && !isSoldOut && 'bg-white/[0.04] border-white/[0.07] text-white/40 hover:text-white/60',
                          )}
                          style={isActive && !isSoldOut ? {
                            backgroundColor: `${zone.color}18`,
                            borderColor: `${zone.color}55`,
                            color: zone.color,
                          } : undefined}
                        >
                          <div className="w-1.5 h-1.5 rounded-sm shrink-0" style={{ backgroundColor: zone.color }} />
                          {zone.name}
                          {isSoldOut && <span className="ml-0.5 opacity-60">· {t('tables.soldOut')}</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Pack cards */}
              {selectedZoneId && (() => {
                const zone = zones.find(z => z.id === selectedZoneId);
                const zonePacks = packs
                  .filter(p => p.zoneId === selectedZoneId)
                  .sort((a, b) => a.basePrice - b.basePrice);
                const reserved = reservationsByZone[selectedZoneId] || 0;
                const remaining = (zone?.tablesCount || 0) - reserved;
                const isSoldOut = remaining <= 0;
                return zonePacks.map(pack => (
                  <PackCard
                    key={pack.id}
                    pack={pack}
                    zone={zone!}
                    isSoldOut={isSoldOut}
                    remaining={remaining}
                    isSelected={selection?.id === pack.id}
                    quantity={selection?.id === pack.id ? selection.quantity : 1}
                    onSelectPack={() => !isSoldOut && selectItem('table', pack.id, pack.basePrice, pack.name, selectedZoneId, pack.deposit, pack.depositType)}
                    onDeselectPack={() => setSelection(null)}
                    onQuantityChange={updateQuantity}
                    t={t}
                    scarcity={scarcitySettings}
                  />
                ));
              })()}

              {/* Floor plan (read-only) */}
              {floorPlan && (
                <div className="rounded border border-white/[0.07] bg-[#141414] overflow-hidden p-2 mt-1">
                  <ClientFloorPlanPicker
                    floorPlan={floorPlan}
                    unavailableTableIds={new Set<string>()}
                    selectedTableId={null}
                    onSelectTable={() => {}}
                    onSkip={() => {}}
                    readOnly
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Sticky footer */}
      <AnimatePresence>
        {selection && (totalWithFees > 0 || selection.type === 'guestlist') && !saleLocked && (
          <StickyCheckoutFooter
            amount={selection.type === 'guestlist' ? 0 : totalWithFees}
            label={selection.type === 'guestlist' ? `${selection.name} · ${t('guestList.free')}` : selection.name}
            subtitle={selection.type === 'guestlist' ? undefined : `x${selection.quantity}`}
            subtitleText={selection.type === 'guestlist' ? undefined : t('tickets.feesIncluded')}
            buttonText={t('ticketSel.continue')}
            onClick={handleContinue}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function SectionDivider({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-3 pt-2 pb-0.5">
      <div className="h-px flex-1 bg-white/[0.07]" />
      <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-white/25">
        {icon}
        {label}
      </span>
      <div className="h-px flex-1 bg-white/[0.07]" />
    </div>
  );
}

function TicketCard({
  round, isSelected, quantity, onSelect, onQuantityChange, t, isVip, scarcity, isSimple, globalMaxTickets, totalSold, previewOnly, maxQuantity = 10,
}: {
  round: TicketRound; isSelected: boolean; quantity: number;
  onSelect: () => void; onQuantityChange: (delta: number) => void;
  t: (key: string) => string; isVip?: boolean; scarcity?: ScarcitySettings | null;
  isSimple?: boolean; globalMaxTickets?: number | null; totalSold?: number; previewOnly?: boolean; maxQuantity?: number;
}) {
  const isSoldOut = round.ticketsSold >= round.maxTickets;
  const [showDesc, setShowDesc] = useState(false);

  const effectiveMax = isSimple && round.maxTickets >= 999999 && globalMaxTickets ? globalMaxTickets : round.maxTickets;
  const effectiveSold = isSimple && round.maxTickets >= 999999 && globalMaxTickets ? (totalSold ?? round.ticketsSold) : round.ticketsSold;
  const remaining = effectiveMax - effectiveSold;
  const percentSold = effectiveMax > 0 ? (effectiveSold / effectiveMax) * 100 : 0;
  const showUrgencyBadge = scarcity?.low_stock_enabled && !scarcity?.show_remaining_count && !isSoldOut && percentSold >= (scarcity?.low_stock_percent ?? 80);
  const showRemainingCount = scarcity?.show_remaining_count && !scarcity?.low_stock_enabled && !isSoldOut && remaining < effectiveMax;
  const perRoundCap = scarcity?.display_caps_per_round?.[round.id];
  const displayRemaining = scarcity?.display_cap_enabled && perRoundCap ? Math.min(remaining, perRoundCap) : remaining;
  const hasRealLimit = effectiveMax < 999999;
  const emojiEnabled = scarcity?.emoji_enabled ?? true;

  const getScarcityLabel = () => {
    const label = scarcity?.low_stock_label || 'few_left';
    const map: Record<string, { text: string; emoji: string }> = {
      few_left: { text: t('scarcity.labelFewLeft'), emoji: '🔥' },
      almost_sold_out: { text: t('scarcity.labelAlmostSoldOut'), emoji: '⚡' },
      last_tickets: { text: t('scarcity.labelLastTickets'), emoji: '🎟️' },
    };
    const entry = map[label] || { text: label, emoji: '' };
    return emojiEnabled ? `${entry.emoji} ${entry.text}` : entry.text;
  };

  const isDisabled = previewOnly || isSoldOut;

  return (
    <div
      className={cn(
        'relative rounded border overflow-hidden transition-all duration-150',
        isDisabled
          ? 'opacity-45 border-white/[0.06] bg-[#141414] cursor-default'
          : isSelected
            ? 'border-primary/30 cursor-pointer'
            : 'border-white/[0.08] bg-[#141414] cursor-pointer active:scale-[0.99] hover:border-white/[0.14]'
      )}
      style={isSelected ? { backgroundColor: 'rgba(232,25,44,0.05)' } : undefined}
      onClick={() => { if (!isDisabled && !isSelected) onSelect(); }}
    >
      {/* Left accent stripe */}
      {isSelected && (
        <motion.div
          initial={{ scaleY: 0 }} animate={{ scaleY: 1 }}
          className="absolute left-0 inset-y-0 w-[3px] bg-primary origin-top"
        />
      )}

      <div className={cn('flex items-center gap-3 py-3.5 pr-4', isSelected ? 'pl-5' : 'pl-4')}>
        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-bold text-sm uppercase tracking-wide leading-tight">{round.name}</h3>
            {isVip && !previewOnly && !isSoldOut && (
              <span className="text-[9px] font-bold uppercase tracking-wider text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded-sm">VIP</span>
            )}
            {previewOnly && (
              <span className="text-[9px] font-bold uppercase tracking-wider text-primary/70 bg-primary/10 px-1.5 py-0.5 rounded-sm">
                {t('tickets.comingSoon') || 'Bientôt'}
              </span>
            )}
            {!previewOnly && showUrgencyBadge && hasRealLimit && (
              <span className="text-[9px] font-semibold text-red-400 bg-red-400/10 px-1.5 py-0.5 rounded-sm animate-pulse">
                {getScarcityLabel()}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
            <p className="text-base font-bold tabular-nums">{round.price.toFixed(2)} €</p>
            {round.includesDrink && (
              <span className="text-[10px] text-primary flex items-center gap-1 font-medium">
                <Wine className="h-2.5 w-2.5" />{t('ticketSel.drink')}
              </span>
            )}
            {(round as any).entryDeadline && (
              <span className="text-[10px] text-white/40 flex items-center gap-1">
                <Clock className="h-2.5 w-2.5" />{t('ticketSel.before')} {(round as any).entryDeadline}
              </span>
            )}
          </div>

          {!previewOnly && showRemainingCount && hasRealLimit && (
            <p className="text-[10px] mt-1 text-amber-400 font-medium">
              {emojiEnabled ? '🎟️ ' : ''}{displayRemaining} {t('scarcity.ticketsLeft')}
            </p>
          )}

          {round.description && (
            <button
              onClick={(e) => { e.stopPropagation(); setShowDesc(!showDesc); }}
              className="flex items-center gap-1 text-[10px] text-white/30 mt-1.5 hover:text-white/50 transition-colors"
            >
              {showDesc ? t('ticketSel.hide') : t('tickets.details')}
              <ChevronDown className={cn('h-2.5 w-2.5 transition-transform', showDesc && 'rotate-180')} />
            </button>
          )}
        </div>

        {/* Right: qty or status */}
        <div className="shrink-0">
          {previewOnly ? (
            <span className="text-[10px] font-semibold text-white/30 border border-white/10 px-2.5 py-1 rounded-sm">
              {t('tickets.comingSoon') || 'Bientôt'}
            </span>
          ) : isSoldOut ? (
            <span className="text-[10px] font-semibold text-white/30 border border-white/10 px-2.5 py-1 rounded-sm">
              {t('tickets.soldOut') || 'Épuisé'}
            </span>
          ) : (
            <QuantitySelector
              quantity={quantity}
              max={Math.max(1, Math.min(maxQuantity, remaining > 0 ? remaining : maxQuantity))}
              onQuantityChange={(delta) => {
                if (delta > 0 && !isSelected) { onSelect(); }
                else { onQuantityChange(delta); }
              }}
            />
          )}
        </div>
      </div>

      {/* Description expand */}
      <AnimatePresence>
        {showDesc && round.description && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <p className="text-[11px] text-white/35 px-4 pb-3.5 border-t border-white/[0.06] pt-2.5 leading-relaxed">
              {round.description}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PackCard({
  pack, zone, isSoldOut, remaining, isSelected, quantity, onSelectPack, onDeselectPack, onQuantityChange, t, scarcity,
}: {
  pack: TablePack; zone: TableZone; isSoldOut: boolean; remaining: number;
  isSelected: boolean; quantity: number;
  onSelectPack: () => void; onDeselectPack: () => void; onQuantityChange: (delta: number) => void;
  t: (key: string) => string; scarcity?: ScarcitySettings | null;
}) {
  const emojiEnabled = scarcity?.emoji_enabled ?? true;
  const percentUsed = zone.tablesCount > 0 ? ((zone.tablesCount - remaining) / zone.tablesCount) * 100 : 0;
  const showUrgency = scarcity?.low_stock_enabled && !isSoldOut && percentUsed >= (scarcity?.low_stock_percent ?? 80);

  // Deposit-now vs balance-at-venue, surfaced up front so the split payment is no
  // surprise at checkout. Mirrors the deposit math in TableCheckout.
  const depositAmount = (pack.deposit ?? 0) > 0
    ? (pack.depositType === 'percentage'
        ? Math.round((pack.basePrice * (pack.deposit as number)) / 100)
        : (pack.deposit as number))
    : 0;
  const remainingAtVenue = depositAmount > 0 ? Math.max(0, pack.basePrice - depositAmount) : 0;

  return (
    <div
      className={cn(
        'rounded border overflow-hidden transition-all duration-150',
        isSoldOut
          ? 'opacity-40 border-white/[0.06] bg-[#141414] cursor-default'
          : isSelected
            ? 'border-primary/30'
            : 'border-white/[0.08] bg-[#141414] cursor-pointer active:scale-[0.99] hover:border-white/[0.14]'
      )}
      style={isSelected ? { backgroundColor: 'rgba(232,25,44,0.05)' } : undefined}
      onClick={() => { if (!isSoldOut && !isSelected) onSelectPack(); }}
    >
      {isSelected && (
        <motion.div initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} className="h-[3px] w-full bg-primary origin-left" />
      )}

      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="font-bold text-sm">{pack.name}</h4>
              {showUrgency && (
                <span className="text-[9px] font-semibold text-red-400 bg-red-400/10 px-1.5 py-0.5 rounded-sm animate-pulse">
                  {emojiEnabled ? '🔥 ' : ''}{t('scarcity.labelFewLeft')}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-[11px] text-white/45 flex-wrap">
              <span>{pack.baseCapacity} {t('ticketSel.minPersons')}</span>
              {pack.includedBottlesQuota > 0 && <span>· {pack.includedBottlesQuota} {pack.includedBottlesQuota > 1 ? t('ticketSel.bottles') : t('ticketSel.bottle')}</span>}
            </div>
            {pack.includedItems && (
              <p className="text-[11px] text-white/35">{pack.includedItems}</p>
            )}
            {pack.minimumSpend > 0 && (
              <p className="text-[11px] text-amber-400/60 font-medium">{t('ticketSel.minSpend')} {pack.minimumSpend} €</p>
            )}
            {depositAmount > 0 && remainingAtVenue > 0 && (
              <p className="text-[11px] text-white/45">
                <span className="text-white/70 font-medium">{t('ticketSel.depositNow')} {depositAmount} €</span>
                {' · '}{remainingAtVenue} € {t('ticketSel.atVenue')}
              </p>
            )}
          </div>

          <div className="shrink-0 text-right space-y-2">
            <p className="text-lg font-bold tabular-nums">{pack.basePrice} €</p>
            {!isSoldOut && (
              isSelected ? (
                <div className="flex flex-col items-end gap-1.5">
                  <QuantitySelector quantity={quantity} onQuantityChange={onQuantityChange} min={1} max={Math.min(10, remaining > 0 ? remaining : 10)} />
                  <button onClick={(e) => { e.stopPropagation(); onDeselectPack(); }} className="text-[9px] text-white/25 hover:text-white/50 transition-colors font-medium uppercase tracking-wide">
                    {t('common.cancel')}
                  </button>
                </div>
              ) : (
                <Button
                  size="sm"
                  onClick={(e) => { e.stopPropagation(); onSelectPack(); }}
                  className="h-8 px-4 rounded-sm text-xs font-bold"
                >
                  {t('ticketSel.reserve') || 'Réserver'}
                </Button>
              )
            )}
            {isSoldOut && (
              <span className="text-[10px] font-semibold text-white/25 border border-white/10 px-2 py-0.5 rounded-sm">
                {t('tables.soldOut') || 'Complet'}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function QuantitySelector({
  quantity, onQuantityChange, min = 0, max = 10,
}: {
  quantity: number; onQuantityChange: (delta: number) => void; min?: number; max?: number;
}) {
  return (
    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
      <button
        className={cn(
          'h-8 w-8 rounded-sm flex items-center justify-center transition-all duration-150',
          quantity > min
            ? 'bg-white/[0.09] text-white/70 hover:bg-white/[0.14] active:scale-90'
            : 'bg-white/[0.04] text-white/15 cursor-default'
        )}
        onClick={() => quantity > min && onQuantityChange(-1)}
        disabled={quantity <= min}
      >
        <Minus className="h-3.5 w-3.5" />
      </button>

      <AnimatePresence mode="wait">
        <motion.span
          key={quantity}
          initial={{ scale: 1.25, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.75, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 500, damping: 22, duration: 0.12 }}
          className={cn('text-base font-bold w-5 text-center tabular-nums select-none', quantity === 0 ? 'text-white/25' : 'text-white')}
        >
          {quantity}
        </motion.span>
      </AnimatePresence>

      <button
        className={cn(
          'h-8 w-8 rounded-sm flex items-center justify-center transition-all duration-150',
          quantity < max
            ? 'text-white active:scale-90'
            : 'text-white/15 cursor-default'
        )}
        style={quantity < max ? { backgroundColor: 'rgba(232,25,44,0.80)' } : { backgroundColor: 'rgba(255,255,255,0.04)' }}
        onClick={() => quantity < max && onQuantityChange(1)}
        disabled={quantity >= max}
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
