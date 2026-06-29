import { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { usePreviewNavigate } from '@/contexts/OwnerPreviewContext';
import { ArrowLeft, AlertCircle, MapPin, ChevronDown, ChevronUp, Music, Ticket, UserCheck, Share2, Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { formatInTimeZone } from 'date-fns-tz';
import { enUS, es, fr } from 'date-fns/locale';
import { PARIS_TIMEZONE } from '@/lib/timezone';
import { TicketRound, TableZone, TablePack, EventWithTicketing, getEventSalesStatus } from '@/types/ticketing';
import { EventSalesStatus } from '@/components/ticketing/EventSalesStatus';
// EventWaitlistForm moved to dedicated page
import { getOptimizedImageUrl } from '@/lib/imageOptimization';
import { toast } from 'sonner';
import { BottomNav } from '@/components/BottomNav';
import { FavoriteButton } from '@/components/FavoriteButton';
import { StickyCheckoutFooter } from '@/components/StickyCheckoutFooter';
import { useFavorites } from '@/hooks/useFavorites';
import { EventCountdown } from '@/components/EventCountdown';
import { FadeInView } from '@/components/motion';
import { formatCompactCount } from '@/components/formater';
import { Skeleton } from '@/components/ui/skeleton';
import { usePromoterTracking } from '@/hooks/usePromoterTracking';
import { useResolvePurchaseSource, useResolveTrackedLink } from '@/hooks/usePurchaseSourceTracking';
import { useStore } from '@/store/useStore';
import { useVisitorTracking } from '@/hooks/useVisitorTracking';

type EventDJ = {
  id: string;
  stage_name: string | null;
  first_name: string;
  last_name: string;
  slug: string | null;
  handle: string | null;
  profile_image_url: string | null;
  music_genres: string[] | null;
};

export default function EventDetails() {
  const { eventId, slug } = useParams();
  const navigate = usePreviewNavigate();
  const [searchParams] = useSearchParams();
  const { t, language } = useLanguage();
  const { isFavorite, toggleFavorite } = useFavorites();
  usePromoterTracking(undefined, eventId); // Capture promoter ref + bind tracking to this event
  useResolvePurchaseSource(eventId); // Capture purchase source for collab analytics
  useResolveTrackedLink(eventId); // Capture ?tl= tracked-link attribution (backup after redirect)

  const [event, setEvent] = useState<(EventWithTicketing & { eventType?: string; locationIsSecret?: boolean; visibility?: string; hideYunoNavigation?: boolean }) | null>(null);
  const [showLeavePrivate, setShowLeavePrivate] = useState(false);
  const [venue, setVenue] = useState<{ id: string; name: string; city: string; address?: string; floorPlanUrl?: string; latitude?: number; longitude?: number; logoUrl?: string } | null>(null);
  // Primary entity: 'organizer' for organizer-led events, 'venue' otherwise
  const [primaryEntity, setPrimaryEntity] = useState<'organizer' | 'venue'>('venue');
  const [primaryOrganizer, setPrimaryOrganizer] = useState<{ user_id: string; display_name: string; slug: string | null; avatar_url: string | null } | null>(null);
  const [ticketRounds, setTicketRounds] = useState<TicketRound[]>([]);
  const [zones, setZones] = useState<TableZone[]>([]);
  const [packs, setPacks] = useState<TablePack[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasPresaleAccess, setHasPresaleAccess] = useState(false);
  const [showFullDescription, setShowFullDescription] = useState(false);
  const [djs, setDjs] = useState<EventDJ[]>([]);
  const [djFollowers, setDjFollowers] = useState<Record<string, number>>({});
  const [eventOrganizers, setEventOrganizers] = useState<{ id: string; name: string; slug: string | null; logo_url: string | null }[]>([]);
  const [mapboxToken, setMapboxToken] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [translatedDescription, setTranslatedDescription] = useState<string | null>(null);
  const [translatingDesc, setTranslatingDesc] = useState(false);

  // Stats for organizer/venue
  const [venueFollowers, setVenueFollowers] = useState(0);
  const [venueEventsCount, setVenueEventsCount] = useState(0);
  const [orgFollowers, setOrgFollowers] = useState<Record<string, number>>({});
  const [orgEventsCount, setOrgEventsCount] = useState<Record<string, number>>({});
  const [orgFollowing, setOrgFollowing] = useState<Record<string, boolean>>({});
  const [interestedCount, setInterestedCount] = useState(0);

  // (Partner venue drinks intentionally not loaded on event page — surfaced only on venue + organizer pages)
  const addToCart = useStore((state) => state.addToCart);
  // Live visitor tracking — scope to venue (drinks bar), event, and organizer when present
  const venueIdForTracking = (event as any)?.venueId || (event as any)?.partner_venue_id || null;
  const organizerIdForTracking = (event as any)?.organizer_user_id || (event as any)?.partner_organizer_id || null;
  const { trackAddToCart } = useVisitorTracking(
    venueIdForTracking || undefined,
    eventId || undefined,
    organizerIdForTracking || undefined,
  );

  const getLocale = () => {
    switch (language) {
      case 'es': return es;
      case 'fr': return fr;
      default: return enUS;
    }
  };

  useEffect(() => {
    if (eventId) {
      fetchEventDetails();
      fetchMapboxToken();
    } else {
      // No eventId in the URL (malformed link): fall through to the
      // "event not found" render instead of an infinite skeleton.
      setLoading(false);
    }
  }, [eventId]);

  const fetchMapboxToken = async () => {
    let token = import.meta.env.VITE_MAPBOX_TOKEN;
    if (!token) {
      try {
        const { data, error } = await supabase.functions.invoke('get-mapbox-token');
        if (error || !data?.token) {
          setMapError('Failed to load map');
          return;
        }
        token = data.token;
      } catch (e) {
        console.error('Failed to fetch mapbox token', e);
        setMapError('Failed to load map');
        return;
      }
    }
    setMapboxToken(token);
  };

  // Build static map URL
  const getStaticMapUrl = () => {
    if (!mapboxToken || !venue?.latitude || !venue?.longitude) return null;
    return `https://api.mapbox.com/styles/v1/mapbox/dark-v11/static/pin-s+ef4444(${venue.longitude},${venue.latitude})/${venue.longitude},${venue.latitude},16,0/600x300@2x?access_token=${mapboxToken}`;
  };

  // Fetch followers/events counts
  const fetchStats = useCallback(async (venueId: string, organizerIds: string[]) => {
    // Venue followers
    const { count: vfCount } = await supabase
      .from('favorites')
      .select('*', { count: 'exact', head: true })
      .eq('favorite_type', 'club')
      .eq('venue_id', venueId);
    setVenueFollowers(vfCount || 0);

    // Venue events count
    const { count: veCount } = await supabase
      .from('events')
      .select('*', { count: 'exact', head: true })
      .eq('venue_id', venueId);
    setVenueEventsCount(veCount || 0);

    // Interested count (favorites for this event)
    if (eventId) {
      const { count: intCount } = await supabase
        .from('favorites')
        .select('*', { count: 'exact', head: true })
        .eq('favorite_type', 'event')
        .eq('event_id', eventId);
      setInterestedCount(intCount || 0);
    }

    // Org followers + events count for each organizer (V2 — organizer_profiles + organizer_profile_followers)
    const followersMap: Record<string, number> = {};
    const eventsMap: Record<string, number> = {};
    const followingMap: Record<string, boolean> = {};

    const { data: { user } } = await supabase.auth.getUser();

    for (const orgUserId of organizerIds) {
      const { count: ofCount } = await supabase
        .from('organizer_profile_followers')
        .select('*', { count: 'exact', head: true })
        .eq('organizer_user_id', orgUserId);
      followersMap[orgUserId] = ofCount || 0;

      const { count: oeCount } = await supabase
        .from('events')
        .select('*', { count: 'exact', head: true })
        .eq('organizer_user_id', orgUserId);
      eventsMap[orgUserId] = oeCount || 0;

      if (user) {
        const { data: followData } = await supabase
          .from('organizer_profile_followers')
          .select('id')
          .eq('organizer_user_id', orgUserId)
          .eq('user_id', user.id)
          .maybeSingle();
        followingMap[orgUserId] = !!followData;
      }
    }

    setOrgFollowers(followersMap);
    setOrgEventsCount(eventsMap);
    setOrgFollowing(followingMap);
  }, [eventId]);

  const fetchEventDetails = async () => {
    try {
      const { data: eventData, error: eventError } = await supabase
        .from('events')
        .select('*')
        .eq('id', eventId)
        .single();

      if (eventError) throw eventError;

      const isOrganizerLed = !!eventData.organizer_user_id;
      // Host venue: main venue_id (club event) OR partner_venue_id (organizer-led co-event)
      const hostVenueId = eventData.venue_id || (isOrganizerLed ? (eventData as any).partner_venue_id : null);

      // Always load organizer profile if there's an organizer_user_id (V2 — organizer_profiles)
      const orgIds: string[] = [];
      let loadedOrganizer: { user_id: string; display_name: string; slug: string | null; avatar_url: string | null } | null = null;
      if (isOrganizerLed) {
        const { data: orgProfile } = await supabase
          .from('organizer_profiles')
          .select('user_id, display_name, slug, avatar_url')
          .eq('user_id', eventData.organizer_user_id)
          .maybeSingle();
        if (orgProfile) {
          loadedOrganizer = orgProfile;
          setPrimaryOrganizer(orgProfile);
          setEventOrganizers([{ id: orgProfile.user_id, name: orgProfile.display_name, slug: orgProfile.slug, logo_url: orgProfile.avatar_url }]);
          orgIds.push(orgProfile.user_id);
        } else {
          // Fallback: read from profiles
          const { data: legacyProfile } = await supabase
            .from('profiles')
            .select('id, organization_name, organization_logo_url')
            .eq('id', eventData.organizer_user_id)
            .maybeSingle();
          if (legacyProfile?.organization_name) {
            loadedOrganizer = {
              user_id: legacyProfile.id,
              display_name: legacyProfile.organization_name,
              slug: null,
              avatar_url: legacyProfile.organization_logo_url || null,
            };
            setPrimaryOrganizer(loadedOrganizer);
            setEventOrganizers([{ id: legacyProfile.id, name: legacyProfile.organization_name, slug: null, logo_url: legacyProfile.organization_logo_url || null }]);
          }
        }
      }

      // Co-organizer : sur une co-soirée menée par le club (organizer_user_id NULL),
      // l'orga partenaire vit dans partner_organizer_id et n'était jamais affiché.
      // On le montre publiquement à côté de la salle dès qu'il a un profil public.
      const partnerOrgId = (eventData as any).partner_organizer_id as string | null;
      if (partnerOrgId && partnerOrgId !== eventData.organizer_user_id) {
        const { data: coOrg } = await supabase
          .from('organizer_profiles')
          .select('user_id, display_name, slug, avatar_url')
          .eq('user_id', partnerOrgId)
          .eq('is_public', true)
          .maybeSingle();
        if (coOrg) {
          if (!loadedOrganizer) { loadedOrganizer = coOrg; setPrimaryOrganizer(coOrg); }
          setEventOrganizers(prev =>
            prev.some(o => o.id === coOrg.user_id)
              ? prev
              : [...prev, { id: coOrg.user_id, name: coOrg.display_name, slug: coOrg.slug, logo_url: coOrg.avatar_url }],
          );
          orgIds.push(coOrg.user_id);
        }
      }

      // Set primary entity flag based on whether the event is organizer-led
      setPrimaryEntity(isOrganizerLed && loadedOrganizer ? 'organizer' : 'venue');

      // Load host venue (used for address, map, drinks if partner)
      if (hostVenueId) {
        const { data: venueData, error: venueError } = await supabase
          .from('venues')
          .select('id, name, city, address, floor_plan_url, latitude, longitude, logo_url')
          .eq('id', hostVenueId)
          .single();

        if (!venueError && venueData) {
          setVenue({
            id: venueData.id,
            name: venueData.name,
            city: venueData.city,
            address: venueData.address || undefined,
            floorPlanUrl: venueData.floor_plan_url || undefined,
            latitude: venueData.latitude || undefined,
            longitude: venueData.longitude || undefined,
            logoUrl: venueData.logo_url || undefined,
          });
        }
      } else if (isOrganizerLed && loadedOrganizer) {
        // Pure organizer event with no venue at all → use organizer info as venue display
        setVenue({
          id: loadedOrganizer.user_id,
          name: loadedOrganizer.display_name,
          city: eventData.location_city || '',
          address: eventData.location_address || undefined,
          logoUrl: loadedOrganizer.avatar_url || undefined,
        });
      }

      // Fetch DJs via the djs_public view, NOT the djs table. The djs table has no
      // RLS SELECT policy for anon, so embedding djs(...) here returned null for
      // logged-out visitors and the whole LINE-UP section silently vanished on the
      // public page. djs_public is security-definer with anon SELECT and safe columns.
      const { data: eventDjsData } = await supabase
        .from('event_djs')
        .select('dj_id')
        .eq('event_id', eventId!);

      const djIds = (eventDjsData ?? []).map((ed: any) => ed.dj_id).filter(Boolean);
      if (djIds.length > 0) {
        const { data: djRows } = await supabase
          .from('djs_public')
          .select('id, stage_name, first_name, last_name, slug, handle, profile_image_url, music_genres')
          .in('id', djIds);
        // Preserve event_djs ordering (headliner first); .in() returns arbitrary order.
        const byId = new Map((djRows ?? []).map((d: any) => [d.id, d]));
        setDjs(djIds.map((id) => byId.get(id)).filter(Boolean) as EventDJ[]);

        // Follower counts per dj (social proof on the line-up). Same aggregation the
        // Explore "Top DJs" module uses: get_public_favorite_counts keyed by dj id.
        const { data: counts } = await supabase.rpc('get_public_favorite_counts', { _favorite_type: 'dj' });
        const followerMap: Record<string, number> = {};
        (counts ?? []).forEach((c: any) => { if (c.target_id) followerMap[c.target_id] = c.total_count; });
        setDjFollowers(followerMap);
      }

      // Note: previously we fetched the partner club drinks here for organizer-led events.
      // Drinks are intentionally NOT shown on event pages anymore — they live on the venue page
      // and on the organizer public profile.


      setEvent({
        id: eventData.id,
        venueId: eventData.venue_id,
        title: eventData.title,
        description: eventData.description,
        posterUrl: eventData.poster_url,
        posterPosition: eventData.poster_position as { x: number; y: number; scale: number } | undefined,
        startAt: eventData.start_at,
        endAt: eventData.end_at,
        isActive: eventData.is_active,
        ticketingEnabled: eventData.ticketing_enabled,
        maxTickets: eventData.max_tickets,
        tablesEnabled: eventData.tables_enabled,
        ticketSellingMode: ((eventData as any).ticket_selling_mode as 'rounds' | 'timed_entry') || 'rounds',
        presaleStartAt: eventData.presale_start_at || undefined,
        publicSaleStartAt: eventData.public_sale_start_at || undefined,
        waitlistEnabled: eventData.waitlist_enabled || false,
        roundsVisibility: ((eventData as any).rounds_visibility as 'sequential' | 'preview_upcoming' | 'all_open') ?? 'sequential',
        locationIsSecret: !!(eventData as any).location_is_secret,
        createdAt: eventData.created_at,
        updatedAt: eventData.updated_at,
        eventType: eventData.event_type,
        visibility: (eventData as any).visibility as string | undefined,
        hideYunoNavigation: !!(eventData as any).hide_yuno_navigation,
      });

      // Fetch stats: venue stats only if hostVenueId is a real venue (not the org placeholder)
      if (hostVenueId) {
        fetchStats(hostVenueId, orgIds);
      } else if (eventId) {
        // Just count interested users for pure organizer events
        const { count: intCount } = await supabase
          .from('favorites')
          .select('*', { count: 'exact', head: true })
          .eq('favorite_type', 'event')
          .eq('event_id', eventId);
        setInterestedCount(intCount || 0);
      }

      // Resolve presale access (promo ref OR waitlist registration by account/email)
      const hasPromoRef = !!searchParams.get('ref');
      if (hasPromoRef) {
        setHasPresaleAccess(true);
      } else {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const filters = [`user_id.eq.${user.id}`];
          const normalizedEmail = user.email?.toLowerCase().trim();
          if (normalizedEmail) filters.push(`email.eq.${normalizedEmail}`);

          const { data: waitlistEntry } = await supabase
            .from('event_waitlist')
            .select('id')
            .eq('event_id', eventId!)
            .or(filters.join(','))
            .maybeSingle();

          setHasPresaleAccess(!!waitlistEntry);
        } else {
          setHasPresaleAccess(false);
        }
      }

      if (eventData.ticketing_enabled) {
        const { data: roundsData } = await supabase
          .from('ticket_rounds')
          .select('*')
          .eq('event_id', eventId)
          .order('position', { ascending: true });

        if (roundsData) {
          const mappedRounds = roundsData.map(r => ({
            id: r.id,
            eventId: r.event_id,
            name: r.name,
            description: r.description,
            price: Number(r.price),
            maxTickets: r.max_tickets,
            ticketsSold: r.tickets_sold,
            position: r.position,
            isActive: r.is_active,
            autoActivate: r.auto_activate,
            manuallySoldOut: (r as any).manually_sold_out ?? false,
            lastTicketsThreshold: r.last_tickets_threshold ?? 20,
            includesDrink: r.includes_drink ?? false,
            drinkDeadlineType: (r.drink_deadline_type as 'hours_after_start' | 'fixed_time') ?? 'hours_after_start',
            drinkDeadlineHours: r.drink_deadline_hours,
            drinkCutoffTime: r.drink_cutoff_time,
            ticketType: ((r as any).ticket_type as 'standard' | 'vip') ?? 'standard',
            createdAt: r.created_at,
            updatedAt: r.updated_at,
          }));
          setTicketRounds(mappedRounds);
        }
      }

      if (eventData.tables_enabled) {
        // Basic mode (org-hosted or per-event tables) → scope by event_id.
        // Elite/venue mode → scope by venue_id.
        const isBasicTables = (eventData as any).tables_mode === 'basic' || !eventData.venue_id;
        const zoneQuery = isBasicTables
          ? supabase.from('table_zones').select('*').eq('event_id', eventId).order('position', { ascending: true })
          : supabase.from('table_zones').select('*').eq('venue_id', eventData.venue_id).order('position', { ascending: true });
        const { data: zonesData } = await zoneQuery;

        if (zonesData) {
          setZones(zonesData.map(z => ({
            id: z.id,
            venueId: z.venue_id,
            name: z.name,
            color: z.color,
            tablesCount: z.tables_count || 1,
            position: z.position,
            lastTablesThreshold: z.last_tables_threshold ?? 20,
            createdAt: z.created_at,
            updatedAt: z.updated_at,
          })));
        }

        const packQuery = isBasicTables
          ? supabase.from('table_packs').select('*').eq('event_id', eventId).eq('is_active', true).order('position', { ascending: true })
          : supabase.from('table_packs').select('*').eq('venue_id', eventData.venue_id).eq('is_active', true).order('position', { ascending: true });
        const { data: packsData } = await packQuery;

        const { data: eventSettingsData } = await supabase
          .from('event_table_settings')
          .select('*')
          .eq('event_id', eventId)
          .single();

        let priceOverrides: Record<string, number> = {};
        
        if (eventSettingsData?.preset_id) {
          const { data: presetData } = await supabase
            .from('table_pack_presets')
            .select('*')
            .eq('id', eventSettingsData.preset_id)
            .single();

          if (presetData?.packs) {
            const presetPacks = presetData.packs as { packId: string; customPrice: number | null }[];
            presetPacks.forEach(pp => {
              if (pp.customPrice !== null) {
                priceOverrides[pp.packId] = pp.customPrice;
              }
            });
          }
        } else if (eventSettingsData?.custom_prices) {
          const customPrices = eventSettingsData.custom_prices as { packId: string; customPrice: number | null }[];
          customPrices.forEach(cp => {
            if (cp.customPrice !== null) {
              priceOverrides[cp.packId] = cp.customPrice;
            }
          });
        }

        if (packsData) {
          setPacks(packsData.map(p => ({
            id: p.id,
            zoneId: p.zone_id,
            venueId: p.venue_id,
            name: p.name,
            description: p.description,
            basePrice: priceOverrides[p.id] ?? Number(p.base_price),
            baseCapacity: p.base_capacity,
            extraPersonPrice: p.extra_person_price ? Number(p.extra_person_price) : 0,
            maxExtraPersons: p.max_extra_persons ?? 0,
            deposit: p.deposit ? Number(p.deposit) : 0,
            depositType: ((p as any).deposit_type as 'fixed' | 'percentage') || 'fixed',
            includedItems: p.included_items,
            includedBottlesQuota: (p as any).included_bottles_quota || 0,
            minimumSpend: Number((p as any).minimum_spend) || 0,
            tablesCount: p.tables_count || 1,
            position: p.position,
            isActive: p.is_active,
            createdAt: p.created_at,
            updatedAt: p.updated_at,
          })));
        }
      }
    } catch (error) {
      console.error('Error fetching event:', error);
      toast.error(t('tickets.errorLoading'));
    } finally {
      setLoading(false);
    }
  };

  // Auto-translate description when language changes
  useEffect(() => {
    if (!event?.description || language === 'fr') {
      setTranslatedDescription(null);
      return;
    }
    let cancelled = false;
    const translate = async () => {
      setTranslatingDesc(true);
      try {
        const { data, error } = await supabase.functions.invoke('translate-text', {
          body: { text: event.description, targetLanguage: language },
        });
        if (!cancelled && data?.translatedText) {
          setTranslatedDescription(data.translatedText);
        }
      } catch (e) {
        console.error('Translation failed:', e);
      } finally {
        if (!cancelled) setTranslatingDesc(false);
      }
    };
    translate();
    return () => { cancelled = true; };
  }, [event?.description, language]);

  const handleShare = async () => {
    const url = window.location.href;
    const shareData = { title: event?.title || '', url };
    if (navigator.share) {
      try { await navigator.share(shareData); } catch {}
    } else {
      await navigator.clipboard.writeText(url);
      toast.success(t('share.copied'));
    }
  };

  // Default back destination (club → organizer → home).
  const navigateBack = () => {
    if (slug) navigate(`/club/${slug}`);
    else if (primaryEntity === 'venue' && venue?.id) navigate(`/club/${venue.id}`);
    else if (primaryOrganizer?.slug) navigate(`/o/${primaryOrganizer.slug}`);
    else navigate('/');
  };

  // Private events aren't publicly accessible — warn before leaving the page.
  const handleBack = () => {
    if (event?.visibility === 'private') {
      setShowLeavePrivate(true);
      return;
    }
    navigateBack();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background pb-20">
        <div className="px-4 pt-[calc(env(safe-area-inset-top,0px)+1rem)]">
          <Skeleton className="w-full aspect-video rounded-xl" />
        </div>
        <div className="px-5 pt-4 space-y-3">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
        </div>
        <div className="px-5 pt-6 space-y-3">
          <Skeleton className="h-12 w-full rounded-lg" />
          <Skeleton className="h-12 w-full rounded-lg" />
          <Skeleton className="h-12 w-full rounded-lg" />
        </div>
      </div>
    );
  }

  if (!event || !venue) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
        <AlertCircle className="h-16 w-16 text-muted-foreground mb-4" />
        <p className="text-muted-foreground">{t('tickets.eventNotFound')}</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate(`/club/${slug}`)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          {t('common.back')}
        </Button>
      </div>
    );
  }

  const heroImage = event.posterUrl;

  // Availability logic — respects rounds_visibility:
  //   sequential       → only the first active not-sold-out round shows as buyable
  //   preview_upcoming → all rounds visible; only first not-sold-out is buyable, others "Bientôt"
  //   all_open         → every active round is buyable in parallel
  const visibility = event.roundsVisibility ?? 'sequential';
  const buyableRounds = ticketRounds.filter(r => r.isActive && !r.manuallySoldOut && r.ticketsSold < r.maxTickets);
  const activeRounds = visibility === 'all_open'
    ? buyableRounds
    : buyableRounds.slice(0, 1);
  const upcomingPreviewRounds = visibility === 'preview_upcoming'
    ? buyableRounds.slice(1)
    : [];
  const activePacks = packs.filter(p => p.isActive);
  const hasTickets = event.ticketingEnabled && activeRounds.length > 0;
  const hasTables = event.tablesEnabled && activePacks.length > 0;
  const hasTicketsOrTables = hasTickets || hasTables;

  // Low stock detection
  const lowStockRounds = activeRounds.filter(r => (r.maxTickets - r.ticketsSold) <= r.lastTicketsThreshold);
  const totalTicketsRemaining = activeRounds.reduce((sum, r) => sum + (r.maxTickets - r.ticketsSold), 0);
  const isSoldOut = event.ticketingEnabled && buyableRounds.length === 0 && ticketRounds.length > 0;
  const eventSalesStatus = getEventSalesStatus(
    {
      presaleStartAt: event.presaleStartAt,
      publicSaleStartAt: event.publicSaleStartAt,
      waitlistEnabled: event.waitlistEnabled,
    },
    isSoldOut,
  );

  // Min price
  const allPrices: number[] = [];
  if (hasTickets) activeRounds.forEach(r => allPrices.push(r.price));
  if (hasTables) activePacks.forEach(p => allPrices.push(p.basePrice));
  const minPrice = allPrices.length > 0 ? Math.min(...allPrices) : 0;

  // Availability text
  const getAvailabilityInfo = () => {
    if (isSoldOut && !hasTables) {
      return { text: t('event.soldOut'), color: 'text-destructive', urgent: true };
    }
    if (lowStockRounds.length > 0 && totalTicketsRemaining <= 30) {
      const remaining = totalTicketsRemaining;
      return { text: t('event.spotsLeft').replace('{{count}}', String(remaining)), color: 'text-orange-400', urgent: true };
    }
    if (hasTickets && hasTables) {
      return { text: t('event.ticketsAndTables'), color: 'text-primary', urgent: false };
    }
    if (hasTickets) {
      return { text: t('event.ticketsAvailable'), color: 'text-primary', urgent: false };
    }
    if (hasTables) {
      return { text: t('event.tablesAvailable'), color: 'text-primary', urgent: false };
    }
    return null;
  };

  const canUserAccessSales = eventSalesStatus === 'public_sale' || (eventSalesStatus === 'presale' && hasPresaleAccess);
  const availability = canUserAccessSales ? getAvailabilityInfo() : null;

  return (
    <div className="min-h-screen pb-28" style={{ background: '#0A0A0A' }}>

      {/* ── CINEMATIC HERO ─────────────────────────────────────── */}
      <section
        className="relative overflow-hidden"
        style={{ aspectRatio: '1 / 1', borderBottom: '1px solid rgba(255,255,255,0.07)' }}
      >
        {/* Background image */}
        {heroImage ? (
          <img
            src={getOptimizedImageUrl(heroImage, { width: 1200, quality: 85 })}
            alt={event.title}
            fetchPriority="high"
            className="absolute inset-0 w-full h-full object-cover object-center"
          />
        ) : (
          <div className="absolute inset-0" style={{ background: 'linear-gradient(160deg, #1a0a0d 0%, #4a0f1a 50%, #7a1428 100%)' }} />
        )}

        {/* Gradient overlay */}
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(to top, rgba(10,10,10,0.97) 0%, rgba(10,10,10,0.2) 50%, rgba(10,10,10,0.55) 100%)' }}
        />

        {/* Top: back (left) + share/fav (right) */}
        <div
          className="absolute top-0 left-0 right-0 z-20 flex items-start justify-between"
          style={{ padding: 'calc(env(safe-area-inset-top, 0px) + 8px) 16px 0' }}
        >
          {/* Back button — hidden when the organizer locks visitors to the event page */}
          {event.hideYunoNavigation ? (
            <div aria-hidden="true" />
          ) : (
            <button
              onClick={handleBack}
              aria-label={t('common.back')}
              className="flex items-center justify-center hover:opacity-80 transition-opacity"
              style={{ width: 36, height: 36, borderRadius: '2px', background: 'rgba(0,0,0,0.40)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', color: '#fff', border: 'none', cursor: 'pointer' }}
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={handleShare}
              aria-label={t('share.shareEvent')}
              className="flex items-center justify-center hover:opacity-80 transition-opacity"
              style={{ width: 36, height: 36, borderRadius: '2px', background: 'rgba(0,0,0,0.40)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', color: '#fff', border: 'none', cursor: 'pointer' }}
            >
              <Share2 className="h-4 w-4" />
            </button>
            <FavoriteButton
              type="event"
              id={event.id}
              variant="ghost"
              size="icon"
              className="text-white shadow-none ring-0 outline-none focus:ring-0 focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 hover:opacity-80 border-none"
              style={{ width: 36, height: 36, borderRadius: '2px', background: 'rgba(0,0,0,0.40)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' } as React.CSSProperties}
            />
          </div>
        </div>

        {/* Bottom: badges + title + meta */}
        <div
          className="absolute bottom-0 left-0 right-0 z-10"
          style={{ padding: '0 20px clamp(24px, 5vh, 44px)' }}
        >
          {/* Genre / status badges */}
          <div className="flex flex-wrap items-center gap-2 mb-4 animate-hero-label">
            {isSoldOut && (
              <span className="font-mono font-bold tracking-[0.18em] text-white px-3 py-1" style={{ fontSize: '11px', background: '#E8192C', borderRadius: '2px' }}>
                SOLD OUT
              </span>
            )}
            {event.eventType && (
              <span style={{ display: 'inline-flex', alignItems: 'center', height: '22px', padding: '0 9px', borderRadius: '10px', fontSize: '10px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.10)', color: '#E5E5E5', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}>
                {event.eventType}
              </span>
            )}
          </div>

          {/* Event title */}
          <h1
            className="font-display text-white uppercase animate-hero-h1"
            style={{ fontSize: 'clamp(38px, 9vw, 100px)', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 0.9, marginBottom: '18px' }}
          >
            {event.title}
          </h1>

          {/* Date / venue / countdown row */}
          <div className="flex items-end justify-between gap-4 flex-wrap animate-hero-body">
            <div>
              {primaryOrganizer && (
                <div className="flex items-center gap-2 mb-1">
                  {primaryOrganizer.avatar_url && (
                    <img src={primaryOrganizer.avatar_url} alt={primaryOrganizer.display_name} className="rounded-full object-cover shrink-0" style={{ width: 18, height: 18 }} />
                  )}
                  <span className="font-mono text-white font-semibold tracking-[0.08em]" style={{ fontSize: '12px' }}>
                    {primaryOrganizer.display_name.toUpperCase()}
                  </span>
                  {venue && venue.id !== primaryOrganizer.user_id && (
                    <>
                      <span className="text-[#3A3A3E]" style={{ fontSize: '11px' }}>×</span>
                      <span className="font-mono text-[#9A9A9A] tracking-[0.08em]" style={{ fontSize: '11px' }}>{venue.name.toUpperCase()}</span>
                    </>
                  )}
                </div>
              )}
              <p className="font-mono text-[#9A9A9A] tracking-[0.06em]" style={{ fontSize: '12px' }}>
                {[
                  !primaryOrganizer && venue ? venue.name.toUpperCase() : null,
                  formatInTimeZone(new Date(event.startAt), PARIS_TIMEZONE, 'EEE d MMM yyyy', { locale: getLocale() }).toUpperCase(),
                  `OPENS ${formatInTimeZone(new Date(event.startAt), PARIS_TIMEZONE, 'HH:mm')}`,
                  `CLOSES ${formatInTimeZone(new Date(event.endAt), PARIS_TIMEZONE, 'HH:mm')}`,
                ].filter(Boolean).join(' · ')}
              </p>
            </div>
            <EventCountdown startAt={event.startAt} compact />
          </div>
        </div>
      </section>

      {/* ── CONTENT ─────────────────────────────────────────────── */}
      <div style={{ maxWidth: '768px', margin: '0 auto' }}>

        {/* ── Actions row ── */}
        <div
          className="flex flex-wrap items-center gap-2.5 animate-hero-cta"
          style={{ padding: 'clamp(20px, 4vw, 28px) 20px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}
        >
          <FavoriteButton
            type="event"
            id={event.id}
            variant="outline"
            size="sm"
            showLabel
            label={t('event.interestedLabel')}
            className="font-mono font-semibold tracking-[0.08em] uppercase ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 border-[#2A2A2A] text-[#9A9A9A] hover:border-[#3A3A3A] hover:text-white"
            style={{ fontSize: '11px', height: '32px', padding: '0 14px', borderRadius: '2px', background: 'transparent' } as React.CSSProperties}
          />
          <button
            onClick={handleShare}
            className="inline-flex items-center gap-2 font-mono font-semibold tracking-[0.08em] uppercase transition-colors hover:border-[#3A3A3A] hover:text-white"
            style={{ fontSize: '11px', height: '32px', padding: '0 14px', background: 'transparent', border: '1px solid #2A2A2A', color: '#9A9A9A', borderRadius: '2px', cursor: 'pointer' }}
          >
            <Share2 className="h-3 w-3" />
            {t('share.shareEvent')}
          </button>
          {interestedCount > 0 && (
            <span className="font-mono text-[#5A5A5E]" style={{ fontSize: '11px', letterSpacing: '0.04em' }}>
              {interestedCount >= 1000 ? `${(interestedCount / 1000).toFixed(1)}k` : interestedCount} {t('event.areInterested')}
            </span>
          )}
        </div>

        {/* ── Sales status (coming soon / presale / sold out) ── */}
        {/* Generic availability lives in the ticket callout kicker below; only special
            states surface here to avoid repeating "tickets and tables available". */}
        {(eventSalesStatus === 'coming_soon' || eventSalesStatus === 'presale' || eventSalesStatus === 'sold_out') && (
          <div style={{ padding: '16px 20px 0' }}>
            <EventSalesStatus
              event={{
                presaleStartAt: event.presaleStartAt,
                publicSaleStartAt: event.publicSaleStartAt,
                waitlistEnabled: event.waitlistEnabled,
              }}
              allRoundsSoldOut={isSoldOut}
              hasPresaleAccess={hasPresaleAccess}
            />
          </div>
        )}

        {/* ── INLINE TICKET CALLOUT ── */}
        {canUserAccessSales && hasTicketsOrTables && minPrice > 0 && (
          <section style={{ padding: '20px 20px 0' }}>
            <p className="section-label-ruled mb-3">
              {hasTickets && hasTables ? t('event.ticketsAndTables') : hasTickets ? t('event.ticketsAvailable') : t('event.tablesAvailable')}
            </p>
            <div style={{ border: '1px solid rgba(232,25,44,0.28)', borderRadius: 4, padding: '16px 20px', background: 'rgba(232,25,44,0.04)' }}>
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-display font-bold text-white" style={{ fontSize: 'clamp(22px, 5vw, 32px)', letterSpacing: '-0.025em', lineHeight: 1 }}>
                    {t('event.startingFrom')} {minPrice.toFixed(2)}€
                  </p>
                  {availability?.urgent && (
                    <p className={`font-mono mt-1.5 ${availability.color}`} style={{ fontSize: '11px', letterSpacing: '0.04em' }}>
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-current mr-1.5 animate-pulse" style={{ verticalAlign: 'middle' }} />
                      {availability.text}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => navigate(`/club/${slug || venue.id}/event/${eventId}/billets`)}
                  className="shrink-0 font-mono font-bold uppercase"
                  style={{ height: 44, padding: '0 22px', background: '#E8192C', color: '#fff', border: 'none', borderRadius: 3, fontSize: '11px', cursor: 'pointer', letterSpacing: '0.10em', transition: 'transform 160ms cubic-bezier(0.23, 1, 0.32, 1)', WebkitTapHighlightColor: 'transparent' } as React.CSSProperties}
                  onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.97)')}
                  onMouseUp={(e) => (e.currentTarget.style.transform = '')}
                  onMouseLeave={(e) => (e.currentTarget.style.transform = '')}
                  onTouchStart={(e) => (e.currentTarget.style.transform = 'scale(0.97)')}
                  onTouchEnd={(e) => (e.currentTarget.style.transform = '')}
                >
                  {t('event.bookNow')}
                </button>
              </div>
              {/* Active rounds breakdown when multiple rounds are visible */}
              {activeRounds.length > 1 && (
                <div className="mt-4 pt-4 space-y-2.5" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  {activeRounds.map((r) => {
                    const pctSold = Math.min((r.ticketsSold / r.maxTickets) * 100, 100);
                    return (
                      <div key={r.id}>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="font-mono" style={{ fontSize: '11px', color: '#9A9A9A', letterSpacing: '0.04em' }}>{r.name}</span>
                          <span className="font-mono font-bold" style={{ fontSize: '12px', color: '#fff' }}>{r.price.toFixed(2)}€</span>
                        </div>
                        <div className="w-full overflow-hidden" style={{ height: 2, background: 'rgba(255,255,255,0.06)', borderRadius: 1 }}>
                          <div style={{ height: '100%', width: `${pctSold}%`, background: pctSold > 80 ? '#E8192C' : '#3A3A3E', transition: 'width 0.6s cubic-bezier(0.16, 1, 0.3, 1)', borderRadius: 1 }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        )}

        {/* Waitlist / coming-soon inline callout */}
        {(eventSalesStatus === 'coming_soon' || (eventSalesStatus === 'presale' && !hasPresaleAccess)) && event.waitlistEnabled && (
          <section style={{ padding: '20px 20px 0' }}>
            <div style={{ border: '1px solid rgba(255,255,255,0.10)', borderRadius: 4, padding: '16px 20px', background: 'rgba(255,255,255,0.02)' }}>
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-mono uppercase mb-1" style={{ fontSize: '9px', color: '#5A5A5E', letterSpacing: '0.14em' }}>
                    {eventSalesStatus === 'presale' ? 'Presale' : 'Billetterie'}
                  </p>
                  <p className="font-display font-bold text-white" style={{ fontSize: 'clamp(17px, 4vw, 22px)', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
                    {eventSalesStatus === 'presale' ? 'Vente privée en cours' : 'Bientôt disponible'}
                  </p>
                  {event.publicSaleStartAt && (
                    <p className="font-mono mt-1" style={{ fontSize: '11px', color: '#5A5A5E', letterSpacing: '0.04em' }}>
                      Ouverture {formatInTimeZone(new Date(event.publicSaleStartAt), PARIS_TIMEZONE, 'dd MMM · HH:mm', { locale: fr })}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => navigate(`/club/${slug || venue.id}/event/${eventId}/waitlist`)}
                  className="shrink-0 font-mono font-semibold uppercase inline-flex items-center gap-2"
                  style={{ height: 40, padding: '0 16px', background: 'transparent', color: '#9A9A9A', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 3, fontSize: '10px', cursor: 'pointer', letterSpacing: '0.10em', transition: 'transform 160ms cubic-bezier(0.23, 1, 0.32, 1), border-color 160ms', WebkitTapHighlightColor: 'transparent' } as React.CSSProperties}
                  onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.97)')}
                  onMouseUp={(e) => (e.currentTarget.style.transform = '')}
                  onMouseLeave={(e) => (e.currentTarget.style.transform = '')}
                  onTouchStart={(e) => (e.currentTarget.style.transform = 'scale(0.97)')}
                  onTouchEnd={(e) => (e.currentTarget.style.transform = '')}
                >
                  S'inscrire
                </button>
              </div>
            </div>
          </section>
        )}

        {/* ── INFO TABLE ── */}
        <FadeInView as="section" style={{ padding: 'clamp(32px, 5vw, 44px) 20px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <p className="section-label-ruled mb-6">{t('event.date') || 'Infos'}</p>

          {/* Large typographic date + time */}
          <div className="flex items-stretch mb-6 pb-6" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="flex-1">
              <p className="font-mono uppercase mb-2" style={{ fontSize: '9px', color: '#5A5A5E', letterSpacing: '0.14em' }}>DATE</p>
              <p
                className="font-display font-bold text-white"
                style={{ fontSize: 'clamp(48px, 12vw, 72px)', letterSpacing: '-0.04em', lineHeight: 0.85 }}
              >
                {formatInTimeZone(new Date(event.startAt), PARIS_TIMEZONE, 'dd', { locale: getLocale() })}
              </p>
              <p className="font-display font-bold uppercase" style={{ fontSize: 'clamp(14px, 3.5vw, 20px)', color: '#9A9A9A', letterSpacing: '-0.01em', lineHeight: 1.1, marginTop: 4 }}>
                {formatInTimeZone(new Date(event.startAt), PARIS_TIMEZONE, 'MMMM yyyy', { locale: getLocale() })}
              </p>
            </div>
            <div className="shrink-0" style={{ width: 1, background: 'rgba(255,255,255,0.07)', margin: '0 24px' }} />
            <div className="flex-1">
              <p className="font-mono uppercase mb-2" style={{ fontSize: '9px', color: '#5A5A5E', letterSpacing: '0.14em' }}>{t('event.doorsOpen')}</p>
              <p
                className="font-display font-bold text-white"
                style={{ fontSize: 'clamp(48px, 12vw, 72px)', letterSpacing: '-0.04em', lineHeight: 0.85 }}
              >
                {formatInTimeZone(new Date(event.startAt), PARIS_TIMEZONE, 'HH:mm')}
              </p>
              <p className="font-mono uppercase" style={{ fontSize: '10px', color: '#5A5A5E', letterSpacing: '0.08em', marginTop: 8 }}>
                {t('event.doorsClose')} {formatInTimeZone(new Date(event.endAt), PARIS_TIMEZONE, 'HH:mm')}
              </p>
            </div>
          </div>

          {/* Compact details */}
          <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: '4px', padding: '0 16px' }}>
            {([
              // Secret events show a sober "Secret location" value instead of the exact
              // address; the city always shows so the attendee knows where to travel and
              // the event stays city-filtered.
              event.locationIsSecret
                ? [t('event.address'), t('event.secretValue')]
                : (venue.address ? [t('event.address'), venue.address] : null),
              venue.city ? [t('event.city'), venue.city] : null,
            ].filter(Boolean) as [string, string][]).map(([k, v], i, arr) => (
              <div
                key={k}
                className="flex items-start justify-between gap-3"
                style={{ padding: '11px 0', borderBottom: i < arr.length - 1 ? '1px solid rgba(255,255,255,0.07)' : 'none' }}
              >
                <span className="font-mono flex-shrink-0" style={{ fontSize: '12px', color: '#5A5A5E' }}>{k}</span>
                {k === t('event.address') && !event.locationIsSecret ? (
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-right transition-colors hover:text-[#E8192C]"
                    style={{ fontSize: '12px', color: '#FFFFFF', letterSpacing: '0.02em', maxWidth: '60%' }}
                  >
                    {v}
                  </a>
                ) : (
                  <span className="font-mono text-right" style={{ fontSize: '12px', color: '#FFFFFF', letterSpacing: '0.02em' }}>{v}</span>
                )}
              </div>
            ))}
            {!event.locationIsSecret && venue.address && (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue.address)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-1 w-full my-4 font-mono text-[#5A5A5E] hover:text-white transition-colors"
                style={{ height: '38px', borderRadius: '4px', fontSize: '11px', letterSpacing: '0.08em', border: '1px solid rgba(255,255,255,0.08)', background: 'transparent' }}
              >
                Open in Maps →
              </a>
            )}
          </div>
        </FadeInView>

        {/* ── DJ LINE-UP ── (right below the event info — the line-up is the headline of a night) */}
        {djs.length > 0 && (
          <FadeInView as="section" style={{ padding: 'clamp(32px, 5vw, 44px) 20px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            <p className="section-label-ruled mb-6">Line-up</p>
            <div className="flex gap-6 overflow-x-auto pb-2 scrollbar-hide" style={{ margin: '0 -20px', padding: '0 20px' }}>
              {djs.map((dj) => {
                const djName = dj.stage_name || `${dj.first_name} ${dj.last_name}`;
                const genre = (dj.music_genres ?? [])[0];
                const followers = djFollowers[dj.id] ?? 0;
                // Social proof: genre + follower count under the name. Both optional —
                // a brand-new DJ shows just the name, no empty "0 followers" noise.
                const meta = [
                  genre || null,
                  followers > 0 ? `${formatCompactCount(followers, language)} ${t('djPublic.followers')}` : null,
                ].filter(Boolean).join(' · ');
                return (
                  <button
                    key={dj.id}
                    onClick={() => (dj.handle || dj.slug) && navigate(`/dj/${dj.handle || dj.slug}`)}
                    className="flex flex-col items-center gap-2 flex-shrink-0 active:opacity-70 transition-opacity"
                    style={{ width: 116 }}
                  >
                    <div className="overflow-hidden" style={{ width: 108, height: 108, borderRadius: 14, border: '1px solid rgba(255,255,255,0.12)', background: '#191919' }}>
                      {dj.profile_image_url
                        ? <img src={dj.profile_image_url} alt={djName} loading="lazy" className="w-full h-full object-cover object-top" />
                        : <div className="w-full h-full flex items-center justify-center"><Music className="h-9 w-9" style={{ color: '#5A5A5E' }} /></div>
                      }
                    </div>
                    <p className="font-mono text-center leading-tight mt-1" style={{ fontSize: '13px', color: '#E5E5E5', letterSpacing: '0.05em', textTransform: 'uppercase', maxWidth: 116 }}>
                      {djName}
                    </p>
                    {meta && (
                      <p className="font-mono text-center leading-tight" style={{ fontSize: '10px', color: '#7A7A7E', letterSpacing: '0.04em', maxWidth: 116 }}>
                        {meta}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
          </FadeInView>
        )}

        {/* ── ORGANIZER + VENUE ── */}
        {(eventOrganizers.length > 0 || venue) && (
          <FadeInView as="section" style={{ padding: 'clamp(32px, 5vw, 44px) 20px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            <p className="section-label-ruled mb-6">
              {primaryEntity === 'organizer' ? t('event.organizedBy') : 'Venue'}
            </p>
            <div className="space-y-2">
              {/* Organizer cards */}
              {eventOrganizers.map((org) => {
                const isFollowingOrg = orgFollowing[org.id] || false;
                const toggleOrgFollow = async () => {
                  const { data: { user } } = await supabase.auth.getUser();
                  if (!user) { toast.info(t('event.loginToFollow')); return; }
                  if (isFollowingOrg) {
                    await supabase.from('organizer_profile_followers').delete().eq('organizer_user_id', org.id).eq('user_id', user.id);
                  } else {
                    await supabase.from('organizer_profile_followers').insert({ organizer_user_id: org.id, user_id: user.id });
                  }
                  setOrgFollowing(prev => ({ ...prev, [org.id]: !isFollowingOrg }));
                  setOrgFollowers(prev => ({ ...prev, [org.id]: (prev[org.id] || 0) + (isFollowingOrg ? -1 : 1) }));
                };
                return (
                  <div
                    key={org.id}
                    className="flex items-center justify-between"
                    style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: '4px', padding: '18px 20px', background: 'rgba(255,255,255,0.02)' }}
                  >
                    <button onClick={() => org.slug && navigate(`/o/${org.slug}`)} className="flex items-center gap-3 min-w-0 flex-1 text-left hover:opacity-80 transition-opacity">
                      <div className="shrink-0 overflow-hidden" style={{ width: 52, height: 52, borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)', background: '#191919' }}>
                        {org.logo_url
                          ? <img src={org.logo_url} alt={org.name} loading="lazy" className="w-full h-full object-cover" />
                          : <div className="w-full h-full flex items-center justify-center font-mono font-bold" style={{ fontSize: '11px', color: '#5A5A5E' }}>{org.name.slice(0, 2).toUpperCase()}</div>
                        }
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-display font-bold uppercase truncate" style={{ fontSize: 'clamp(14px, 2vw, 18px)', color: '#FFFFFF', letterSpacing: '-0.005em' }}>{org.name}</p>
                        <p className="font-mono mt-0.5" style={{ fontSize: '10px', color: '#5A5A5E', letterSpacing: '0.06em' }}>
                          {orgFollowers[org.id] || 0} {t('event.followers')} · {orgEventsCount[org.id] || 0} {t('event.events')}
                        </p>
                      </div>
                      <span className="text-[#5A5A5E] text-sm shrink-0 ml-2">→</span>
                    </button>
                    <button
                      onClick={toggleOrgFollow}
                      className="shrink-0 inline-flex items-center gap-1.5 font-mono font-semibold tracking-[0.08em] uppercase transition-colors ml-3"
                      style={{ fontSize: '10px', height: '28px', padding: '0 12px', borderRadius: '2px', border: '1px solid', borderColor: isFollowingOrg ? 'rgba(232,25,44,0.4)' : '#2A2A2A', background: isFollowingOrg ? 'rgba(232,25,44,0.08)' : 'transparent', color: isFollowingOrg ? '#E8192C' : '#9A9A9A', cursor: 'pointer' }}
                    >
                      <Bell className="h-3 w-3" strokeWidth={2} style={{ fill: isFollowingOrg ? '#E8192C' : 'transparent' }} />
                      {isFollowingOrg ? t('subscribe.active') : t('subscribe.action')}
                    </button>
                  </div>
                );
              })}

              {/* Venue card — secondary. Hidden when `venue` is just the organizer placeholder
                  (pure org event), otherwise it duplicates the organizer card above and links
                  to a non-existent /club/{organizerUserId}. Only real clubs render here. */}
              {venue.id !== primaryOrganizer?.user_id && (
              <div
                className="flex items-center"
                style={{ border: '1px solid rgba(255,255,255,0.06)', borderRadius: '4px', padding: '12px 16px' }}
              >
                <button onClick={() => navigate(`/club/${venue.id}`)} className="flex items-center gap-3 min-w-0 flex-1 hover:opacity-80 transition-opacity text-left">
                  <div className="shrink-0 overflow-hidden" style={{ width: 48, height: 48, borderRadius: '4px', border: '1px solid rgba(255,255,255,0.08)', background: '#191919' }}>
                    {venue.logoUrl
                      ? <img src={venue.logoUrl} alt={venue.name} loading="lazy" className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center font-mono font-bold" style={{ fontSize: '12px', color: '#5A5A5E' }}>{venue.name.slice(0, 2).toUpperCase()}</div>
                    }
                  </div>
                  <div className="min-w-0 flex flex-col items-start">
                    <p className="font-mono truncate" style={{ fontSize: '13px', color: '#E5E5E5', letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600 }}>{venue.name}</p>
                    <p className="font-mono mt-1" style={{ fontSize: '11px', color: '#5A5A5E', letterSpacing: '0.04em' }}>{venueFollowers} {t('event.followers')}</p>
                    <p className="font-mono" style={{ fontSize: '11px', color: '#5A5A5E', letterSpacing: '0.04em' }}>{venueEventsCount} {t('event.events')}</p>
                  </div>
                  <span className="text-[#3A3A3E] text-xs shrink-0 ml-2">→</span>
                </button>
                <button
                  onClick={() => toggleFavorite('club', venue.id)}
                  className="shrink-0 inline-flex items-center gap-1.5 font-mono font-semibold tracking-[0.08em] uppercase transition-colors ml-3"
                  style={{ fontSize: '10px', height: '28px', padding: '0 12px', borderRadius: '2px', border: '1px solid', borderColor: isFavorite('club', venue.id) ? 'rgba(232,25,44,0.4)' : '#2A2A2A', background: isFavorite('club', venue.id) ? 'rgba(232,25,44,0.08)' : 'transparent', color: isFavorite('club', venue.id) ? '#E8192C' : '#9A9A9A', cursor: 'pointer' }}
                >
                  <Bell className="h-3 w-3" strokeWidth={2} style={{ fill: isFavorite('club', venue.id) ? '#E8192C' : 'transparent' }} />
                  {isFavorite('club', venue.id) ? t('subscribe.active') : t('subscribe.action')}
                </button>
              </div>
              )}
            </div>
          </FadeInView>
        )}

        {/* Partner venue drinks intentionally NOT shown on event pages. */}

        {/* ── DESCRIPTION ── */}
        {event.description && (
          <FadeInView as="section" style={{ padding: 'clamp(32px, 5vw, 44px) 20px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            <p className="section-label-ruled mb-5">{t('event.about') || 'À propos'}</p>
            <div className="relative">
              {translatingDesc && (
                <div className="text-xs text-muted-foreground mb-2 animate-pulse">{t('event.translating')}</div>
              )}
              <p
                className={`whitespace-pre-line ${!showFullDescription ? 'line-clamp-6' : ''}`}
                style={{ fontSize: '14px', color: '#9A9A9A', lineHeight: 1.65 }}
              >
                {translatedDescription || event.description}
              </p>
              {!showFullDescription && event.description.length > 200 && (
                <div className="absolute bottom-0 inset-x-0 h-14 pointer-events-none" style={{ background: 'linear-gradient(to top, #0A0A0A, transparent)' }} />
              )}
            </div>
            {event.description.length > 200 && (
              <div className="flex justify-center pt-3">
                <button
                  onClick={() => setShowFullDescription(!showFullDescription)}
                  className="flex items-center gap-1.5 font-mono font-semibold tracking-[0.08em] uppercase transition-colors hover:text-white"
                  style={{ fontSize: '10px', color: '#5A5A5E', background: 'transparent', border: 'none', cursor: 'pointer', padding: '6px 12px' }}
                >
                  {showFullDescription
                    ? <><ChevronUp className="h-3.5 w-3.5" />{t('event.showLess')}</>
                    : <>{t('event.showMore')}<ChevronDown className="h-3.5 w-3.5" /></>
                  }
                </button>
              </div>
            )}
          </FadeInView>
        )}

        {/* ── STATIC MAP ── */}
        {!event.locationIsSecret && venue.latitude && venue.longitude && venue.address && (
          <FadeInView as="section" style={{ padding: 'clamp(32px, 5vw, 44px) 20px' }}>
            <p className="section-label-ruled mb-5">{t('event.location')}</p>
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue.address)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full overflow-hidden"
              style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: '4px' }}
            >
              {(() => {
                const staticUrl = getStaticMapUrl();
                return staticUrl ? (
                  <img src={staticUrl} alt={venue.address} className="w-full aspect-video object-cover" loading="lazy" />
                ) : (
                  <div className="w-full aspect-video flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.03)' }}>
                    <MapPin className="h-8 w-8" style={{ color: '#5A5A5E' }} />
                  </div>
                );
              })()}
            </a>
          </FadeInView>
        )}

      </div>{/* end content */}

      {/* ── STICKY CHECKOUT FOOTER (système actuel conservé) ── */}
      {(() => {
        if (eventSalesStatus === 'coming_soon' || (eventSalesStatus === 'presale' && !hasPresaleAccess)) {
          if (hasPresaleAccess) {
            return (
              <StickyCheckoutFooter
                amount={0}
                label=""
                buttonText={t('waitlist.youAreOnWaitlist')}
                icon={<UserCheck className="h-4 w-4" />}
                disabled
                onClick={() => {}}
              />
            );
          }
          return (
            <StickyCheckoutFooter
              amount={0}
              label=""
              buttonText={eventSalesStatus === 'presale' ? t('waitlist.joinWaitlist') : t('waitlist.signUpForRelease')}
              icon={<Bell className="h-4 w-4" />}
              onClick={() => navigate(`/club/${slug || venue.id}/event/${eventId}/waitlist`)}
            />
          );
        }

        if (eventSalesStatus === 'sold_out') return null;

        if (canUserAccessSales && hasTicketsOrTables && minPrice > 0) {
          return (
            <StickyCheckoutFooter
              amount={minPrice}
              label={t('event.startingFrom')}
              buttonText={t('event.bookNow')}
              icon={<Ticket className="h-4 w-4" />}
              onClick={() => navigate(`/club/${slug || venue.id}/event/${eventId}/billets`)}
            />
          );
        }
        return null;
      })()}

      {!hasTicketsOrTables && eventSalesStatus === 'public_sale' && <BottomNav />}

      {/* Private event — confirm before leaving (page isn't publicly accessible) */}
      {showLeavePrivate && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="leave-private-title"
          className="fixed inset-0 z-[100] flex items-center justify-center"
          style={{ padding: '24px', background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
          onClick={() => setShowLeavePrivate(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 380,
              background: '#141414',
              border: '1px solid rgba(255,255,255,0.10)',
              borderRadius: '4px',
              padding: '28px 24px 24px',
              boxShadow: '0 24px 60px rgba(0,0,0,0.6)',
            }}
          >
            <div
              className="flex items-center justify-center mb-4"
              style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(232,25,44,0.12)' }}
            >
              <AlertCircle className="h-5 w-5" style={{ color: '#E8192C' }} />
            </div>
            <h2
              id="leave-private-title"
              className="font-display text-white uppercase"
              style={{ fontSize: '22px', fontWeight: 700, letterSpacing: '-0.01em', lineHeight: 1.1, marginBottom: '10px' }}
            >
              {t('event.leavePrivate.title')}
            </h2>
            <p style={{ fontSize: '14px', lineHeight: 1.5, color: 'rgba(255,255,255,0.65)', marginBottom: '22px' }}>
              {t('event.leavePrivate.body')}
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => { setShowLeavePrivate(false); navigate('/'); }}
                className="hover:opacity-90 transition-opacity"
                style={{ width: '100%', height: 46, borderRadius: '2px', background: '#E8192C', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '14px', fontWeight: 600 }}
              >
                {t('event.leavePrivate.confirm')}
              </button>
              <button
                onClick={() => setShowLeavePrivate(false)}
                className="hover:opacity-80 transition-opacity"
                style={{ width: '100%', height: 46, borderRadius: '2px', background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.15)', cursor: 'pointer', fontSize: '14px', fontWeight: 600 }}
              >
                {t('event.leavePrivate.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
