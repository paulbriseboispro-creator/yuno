import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { getManualCoords, getStoredCity, hasManualCity, setManualLocation, setResolvedCity } from '@/lib/userLocation';
import { markAppReady } from '@/lib/appReady';
import { getCurrentPosition } from '@/lib/geolocation';
import { genresMatch } from '@/lib/musicGenres';
import { useLanguage } from '@/contexts/LanguageContext';
import { ExploreHeader } from '@/components/explore/ExploreHeader';
import { EventCardData } from '@/components/explore/EventCard';
import { SearchOverlay } from '@/components/explore/SearchOverlay';
import { FilterPage, ExploreFilters, FilterDynamicData } from '@/components/explore/FilterPage';
import { ExploreChipRow } from '@/components/explore/ExploreChipRow';
import { ExploreSectionTitle } from '@/components/explore/ExploreSectionTitle';
import { ExploreEventCarousel } from '@/components/explore/ExploreEventCarousel';
import { ExploreRailCard } from '@/components/explore/ExploreRailCard';
import { ExploreRankCard } from '@/components/explore/ExploreRankCard';
import { ExploreDJCard, ExploreDJItem } from '@/components/explore/ExploreDJCard';
import { ExploreVenueCard, ExploreVenueItem } from '@/components/explore/ExploreVenueCard';
import { ExplorePopularClubCard } from '@/components/explore/ExplorePopularClubCard';
import { ExploreSeeAllCard } from '@/components/explore/ExploreSeeAllCard';
import { ExploreDayTabs, WeekDayData } from '@/components/explore/ExploreDayTabs';
import { FadeInView } from '@/components/motion';
import { useForYouFeed } from '@/hooks/useForYouFeed';
import { ExploreForYouRail } from '@/components/explore/ExploreForYouRail';
import { PublicPage } from '@/components/PublicPage';
import { ExploreCardsSkeleton } from '@/components/skeletons/ExploreCardsSkeleton';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import type { Tables } from '@/integrations/supabase/types';

type DateFilter = 'today' | 'tomorrow' | 'weekend' | 'week';

// Un genre stocké correspond-il à un genre coché ? `genresMatch` passe par les
// alias du vocabulaire officiel, donc une vieille fiche taguée « reggaeton »
// remonte bien sur le filtre « Reggaeton / Latino ».
const matchesAny = (stored: string[], selected: string[]) =>
  stored.some(g => selected.some(sel => genresMatch(g, sel)));

// Lignes venues/affiliate_venues telles que sélectionnées par fetchData.
type ExploreVenueRow = Pick<Tables<'venues'>,
  'id' | 'name' | 'city' | 'address' | 'logo_url' | 'cover_url' | 'latitude' | 'longitude' | 'is_hidden' | 'hidden_from_map'>;
type ExploreAffiliateVenueRow = Pick<Tables<'affiliate_venues'>,
  'id' | 'name' | 'city' | 'slug' | 'cover_image_url' | 'logo_url' | 'lat' | 'lng' | 'genres' | 'is_active'>;
type ExploreTicketRoundRow = Pick<Tables<'ticket_rounds'>,
  'event_id' | 'price' | 'tickets_sold' | 'max_tickets' | 'is_active'>;

function getDateRange(filter: DateFilter | Date): { start: string; end: string } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (filter instanceof Date) {
    const start = new Date(filter.getFullYear(), filter.getMonth(), filter.getDate());
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    return { start: start.toISOString(), end: end.toISOString() };
  }

  if (filter === 'today') {
    const end = new Date(today);
    end.setHours(23, 59, 59, 999);
    return { start: today.toISOString(), end: end.toISOString() };
  }
  if (filter === 'tomorrow') {
    const start = new Date(today);
    start.setDate(start.getDate() + 1);
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    return { start: start.toISOString(), end: end.toISOString() };
  }
  if (filter === 'week') {
    const end = new Date(today);
    end.setDate(end.getDate() + 7);
    end.setHours(23, 59, 59, 999);
    return { start: today.toISOString(), end: end.toISOString() };
  }
  // weekend: Thursday evening → Saturday evening
  const dayOfWeek = today.getDay();
  let daysUntilThu: number;
  if (dayOfWeek === 0) daysUntilThu = 4;       // Sun → +4
  else if (dayOfWeek <= 3) daysUntilThu = 4 - dayOfWeek; // Mon-Wed → +3,+2,+1
  else if (dayOfWeek === 4) daysUntilThu = 0;  // Thu → today
  else daysUntilThu = 7 - dayOfWeek + 4;       // Fri(+6) Sat(+6)... next Thu
  const thu = new Date(today);
  thu.setDate(thu.getDate() + daysUntilThu);
  const endSat = new Date(thu);
  endSat.setDate(endSat.getDate() + 2); // Saturday
  endSat.setHours(23, 59, 59, 999);
  return { start: thu.toISOString(), end: endSat.toISOString() };
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Pick the date-fns locale matching the active app language (EN/ES/FR).
const dfLocale = (lang: string) => (lang === 'fr' ? fr : lang === 'es' ? es : enUS);

export default function Explore() {
  const navigate = useNavigate();
  const { t, language } = useLanguage();

  // Accueil monté et peint : signale l'app « prête » pour que l'écran de
  // lancement lance sa sortie (soulèvement) et révèle l'Explorer.
  useEffect(() => {
    const id = requestAnimationFrame(() => markAppReady());
    return () => cancelAnimationFrame(id);
  }, []);

  // ── Scroll-triggered pill button ──
  const mainRef = useRef<HTMLElement>(null);
  const [showAllEventsPill, setShowAllEventsPill] = useState(false);

  useEffect(() => {
    const checkProgress = (scrollTop: number, scrollHeight: number, clientHeight: number) => {
      const scrollable = scrollHeight - clientHeight;
      if (scrollable <= 0) return;
      setShowAllEventsPill(scrollTop / scrollable >= 0.3);
    };

    // Listen on the element (overflow-y-auto) AND window as fallback
    const el = mainRef.current;
    const handleElementScroll = () => {
      if (el) checkProgress(el.scrollTop, el.scrollHeight, el.clientHeight);
    };
    const handleWindowScroll = () => {
      checkProgress(window.scrollY, document.documentElement.scrollHeight, window.innerHeight);
    };

    if (el) el.addEventListener('scroll', handleElementScroll, { passive: true });
    window.addEventListener('scroll', handleWindowScroll, { passive: true });

    return () => {
      if (el) el.removeEventListener('scroll', handleElementScroll);
      window.removeEventListener('scroll', handleWindowScroll);
    };
  }, []);

  // ── Date filter state ──
  const [dateFilter, setDateFilter] = useState<DateFilter>('today');
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  // ── Chip filter state ──
  const [chipGenres, setChipGenres] = useState<string[]>([]);
  const [freeOnly, setFreeOnly] = useState(false);

  // ── Events + venues ──
  const [events, setEvents] = useState<EventCardData[]>([]);
  const [allEvents, setAllEvents] = useState<EventCardData[]>([]);
  const [venues, setVenues] = useState<ExploreVenueRow[]>([]);
  const [affiliateVenues, setAffiliateVenues] = useState<ExploreAffiliateVenueRow[]>([]);
  const [venueFavCounts, setVenueFavCounts] = useState<Record<string, number>>({});

  // ── Week data for "Cette semaine" section ──
  const [weekData, setWeekData] = useState<WeekDayData[]>([]);

  // ── Top DJs jouant cette semaine dans la zone (les plus suivis) ──
  const [topDjs, setTopDjs] = useState<ExploreDJItem[]>([]);

  // ── UI state ──
  const [loading, setLoading] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [activeFiltersCount, setActiveFiltersCount] = useState(0);

  // ── Filter page state ──
  const [filters, setFilters] = useState<ExploreFilters>({
    eventTypes: [],
    genres: [],
    priceRange: [0, 200],
    priceType: 'both',
    dateFilter: 'today',
    timeRange: [0, 12],
  });
  const [filterDynamicData, setFilterDynamicData] = useState<FilterDynamicData>({
    ticketPriceMin: 0,
    ticketPriceMax: 200,
    vipPriceMin: 0,
    vipPriceMax: 200,
    earliestHour: 18,
    latestHour: 6,
  });

  // ── Location / city ── (shared with ClubMap via @/lib/userLocation)
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(() => getManualCoords());
  const [city, setCity] = useState(() => getStoredCity());

  // ── Module « Pour toi » : cartes + raisons, autonome (horizon 45 j, ville
  //    courante). Déclaré après `city` dont il dépend. Vide = rien à
  //    recommander, la section se masque d'elle-même.
  const forYouItems = useForYouFeed(city);

  // ── Geolocation init ──
  useEffect(() => {
    if (hasManualCity()) return;
    const initLocation = async () => {
      getCurrentPosition(
        async (pos) => {
          const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          if (!localStorage.getItem('yuno_city')) {
            setUserLocation(coords);
            try {
              let cityName = 'Paris';
              const token = import.meta.env.VITE_MAPBOX_TOKEN;
              if (token) {
                const res = await fetch(
                  `https://api.mapbox.com/geocoding/v5/mapbox.places/${coords.lng},${coords.lat}.json?access_token=${token}&types=place&limit=1`
                );
                const data = await res.json();
                const feature = data.features?.[0];
                if (feature) cityName = feature.text || feature.place_name || 'Paris';
              } else {
                const { data } = await supabase.functions.invoke('geocode-address', {
                  body: { lat: coords.lat, lng: coords.lng, reverse: true },
                });
                cityName = data?.city || data?.name || 'Paris';
              }
              setCity(cityName);
              setResolvedCity(cityName);
            } catch { /* géoloc best-effort : on garde la ville par défaut */ }
          }
        },
        async () => {
          if (!localStorage.getItem('yuno_city')) {
            try {
              const { data: { user } } = await supabase.auth.getUser();
              if (user) {
                const { data: profile } = await supabase
                  .from('profiles')
                  .select('city')
                  .eq('id', user.id)
                  .single();
                if (profile?.city) {
                  setCity(profile.city);
                  setResolvedCity(profile.city);
                }
              }
            } catch { /* géoloc best-effort : on garde la ville par défaut */ }
          }
        }
      );
    };
    initLocation();
  }, []);

  // ── Main data fetch ──
  useEffect(() => {
    fetchData();
  }, [dateFilter, selectedDate, city, userLocation]);

  // ── Week data fetch (independent of date filter) ──
  useEffect(() => {
    fetchWeekData();
  }, [city, userLocation]);

  // ── Top DJs: dérivé des soirées club/orga de la semaine déjà chargées ──
  useEffect(() => {
    fetchTopDjs();
  }, [weekData]);

  const handleDateSelect = (date: Date | null, preset?: string) => {
    if (preset) {
      setSelectedDate(null);
      setDateFilter(preset as DateFilter);
    } else if (date) {
      setSelectedDate(date);
    }
  };

  const handleCityChange = (newCity: string, coords?: { lat: number; lng: number }) => {
    setCity(newCity);
    setManualLocation(newCity, coords);
    if (coords) setUserLocation(coords);
  };

  const handleApplyFilters = (newFilters: ExploreFilters) => {
    setFilters(newFilters);
    if (newFilters.dateFilter && newFilters.dateFilter !== filters.dateFilter) {
      if (['today', 'tomorrow', 'weekend', 'week'].includes(newFilters.dateFilter)) {
        setSelectedDate(null);
        setDateFilter(newFilters.dateFilter as DateFilter);
      }
    }
    // Navigate to search results when non-date filters are active
    const hasDeepFilters =
      newFilters.eventTypes.length > 0 ||
      newFilters.genres.length > 0 ||
      newFilters.priceType !== 'both' ||
      newFilters.priceRange[0] > 0 ||
      newFilters.priceRange[1] < (filterDynamicData.ticketPriceMax || 200) ||
      newFilters.timeRange[0] > 0 ||
      newFilters.timeRange[1] < 12;
    if (hasDeepFilters) {
      navigate('/events', { state: { filters: newFilters, city } });
    }
  };

  // ── Chip handlers ──
  const handleDateChip = (filter: 'today' | 'tomorrow' | 'weekend') => {
    setSelectedDate(null);
    setDateFilter(filter);
  };

  const handleGenreToggle = useCallback((genre: string) => {
    setChipGenres(prev =>
      prev.includes(genre) ? prev.filter(g => g !== genre) : [...prev, genre]
    );
  }, []);

  const handleFreeToggle = useCallback(() => {
    setFreeOnly(prev => !prev);
  }, []);

  const sliderToHour = (val: number): number => (18 + val) % 24;

  // ── FilterPage-filtered events ──
  const filteredEvents = useMemo(() => {
    let result = [...events];
    if (filters.eventTypes.length > 0) {
      // affiliate events have no mapped type — include them regardless
      result = result.filter(e =>
        e.eventType === 'affiliate' || filters.eventTypes.includes(e.eventType || 'club')
      );
    }
    if (filters.genres.length > 0) {
      result = result.filter(e => matchesAny(e.genres, filters.genres));
    }
    const defaultPriceMax = filterDynamicData.ticketPriceMax;
    const priceChanged = filters.priceRange[0] > 0 || filters.priceRange[1] < (defaultPriceMax || 200);
    if (priceChanged) {
      result = result.filter(e => e.minPrice === null || (e.minPrice >= filters.priceRange[0] && e.minPrice <= filters.priceRange[1]));
    }
    const timeChanged = filters.timeRange[0] > 0 || filters.timeRange[1] < 12;
    if (timeChanged) {
      const startH = sliderToHour(filters.timeRange[0]);
      const endH = sliderToHour(filters.timeRange[1]);
      result = result.filter(e => {
        const h = new Date(e.startAt).getHours();
        return startH <= endH ? h >= startH && h <= endH : h >= startH || h <= endH;
      });
    }
    return result;
  }, [events, filters, filterDynamicData]);

  // ── Chip-filtered events ──
  const chipFilteredEvents = useMemo(() => {
    let result = filteredEvents;
    if (freeOnly) result = result.filter(e => e.minPrice === 0);
    if (chipGenres.length > 0) {
      result = result.filter(e => matchesAny(e.genres, chipGenres));
    }
    return result;
  }, [filteredEvents, freeOnly, chipGenres]);

  // ── Active filter count ──
  useEffect(() => {
    let count = 0;
    if (filters.eventTypes.length > 0) count++;
    if (filters.genres.length > 0) count++;
    const priceChanged = filters.priceRange[0] > 0 || filters.priceRange[1] < (filterDynamicData.ticketPriceMax || 200);
    if (priceChanged) count++;
    const timeChanged = filters.timeRange[0] > 0 || filters.timeRange[1] < 12;
    if (timeChanged) count++;
    setActiveFiltersCount(count);
  }, [filters, filterDynamicData]);

  // ── Smart event distribution ──────────────────────────────
  //
  // Carousel  → ALL events for selected period (Ce soir / Demain / Week-end)
  // Reco      → Events from next 7 days NOT already in carousel (future discovery)
  // Trending  → Events from carousel sorted by popularity (different lens on same period)
  // Clubs     → Venue cards (always)
  // Week      → Full 7-day agenda by day tabs (always)

  const carouselEvents = chipFilteredEvents; // events for the selected date filter

  const carouselIds = useMemo(
    () => new Set(carouselEvents.map(e => e.id)),
    [carouselEvents]
  );

  // Reco: week events not shown in carousel, deduped, chronological, max 10
  const recoEvents = useMemo(() => {
    const seen = new Set<string>();
    let result = weekData
      .flatMap(day => day.events)
      .filter(e => {
        if (carouselIds.has(e.id)) return false;
        if (seen.has(e.id)) return false;
        seen.add(e.id);
        return true;
      });
    // Apply chip filters
    if (freeOnly) result = result.filter(e => e.minPrice === 0);
    if (chipGenres.length > 0) {
      result = result.filter(e => matchesAny(e.genres, chipGenres));
    }
    // Apply FilterPage filters (eventType + genre)
    if (filters.eventTypes.length > 0) {
      result = result.filter(e =>
        e.eventType === 'affiliate' || filters.eventTypes.includes(e.eventType || 'club')
      );
    }
    if (filters.genres.length > 0) {
      result = result.filter(e => matchesAny(e.genres, filters.genres));
    }
    return result
      .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
      .slice(0, 10);
  }, [weekData, carouselIds, freeOnly, chipGenres, filters]);

  // Trending: top events from the next 7 days sorted by likes, adaptive count (max 10)
  const trendingEvents = useMemo(() => {
    const seen = new Set<string>();
    let allWeekEvents = weekData
      .flatMap(day => day.events)
      .filter(e => {
        if (seen.has(e.id)) return false;
        seen.add(e.id);
        return true;
      });
    // Apply FilterPage filters (eventType + genre)
    if (filters.eventTypes.length > 0) {
      allWeekEvents = allWeekEvents.filter(e =>
        e.eventType === 'affiliate' || filters.eventTypes.includes(e.eventType || 'club')
      );
    }
    if (filters.genres.length > 0) {
      allWeekEvents = allWeekEvents.filter(e => matchesAny(e.genres, filters.genres));
    }
    return allWeekEvents
      .sort((a, b) => b.interestedCount - a.interestedCount)
      .slice(0, Math.min(10, allWeekEvents.length));
  }, [weekData, filters]);

  // Derive primary genre per venue from the loaded events
  const venueGenreMap = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const e of allEvents) {
      if (!e.venueSlug || map[e.venueSlug]) continue;
      const genre = e.genres?.[0];
      if (genre && genre !== 'Open Format') map[e.venueSlug] = genre;
    }
    return map;
  }, [allEvents]);

  const venueItems = useMemo<ExploreVenueItem[]>(() => {
    const regularItems = venues
      .filter(v => !v.hidden_from_map)
      .map(v => {
        let distance: number | null = null;
        if (userLocation && v.latitude && v.longitude) {
          distance = haversineKm(userLocation.lat, userLocation.lng, v.latitude, v.longitude);
        }
        return {
          id: v.id,
          name: v.name,
          coverUrl: v.cover_url || null,
          logoUrl: v.logo_url || null,
          city: v.city,
          primaryGenre: venueGenreMap[v.id],
          distance,
          isAffiliate: false,
          followersCount: venueFavCounts[v.id] || 0,
        } as ExploreVenueItem & { distance: number | null; followersCount: number };
      })
      .filter(v => {
        if (userLocation && v.distance != null) return v.distance <= 50;
        if (city) {
          const venue = venues.find(ven => ven.id === v.id);
          return venue?.city?.toLowerCase().includes(city.toLowerCase());
        }
        return true;
      });

    const affiliateItems = affiliateVenues
      .map(av => {
        let distance: number | null = null;
        if (userLocation && av.lat && av.lng) {
          distance = haversineKm(userLocation.lat, userLocation.lng, av.lat, av.lng);
        }
        return {
          id: av.id,
          name: av.name,
          coverUrl: av.cover_image_url || null,
          logoUrl: av.logo_url || null,
          city: av.city || '',
          primaryGenre: (av.genres as string[] | null)?.[0],
          distance,
          isAffiliate: true,
          slug: av.slug,
          followersCount: 0,
        } as ExploreVenueItem & { distance: number | null; followersCount: number };
      })
      .filter(v => {
        if (userLocation && v.distance != null) return v.distance <= 50;
        if (city) return (v.city || '').toLowerCase().includes(city.toLowerCase());
        return true;
      });

    return [...regularItems, ...affiliateItems]
      .sort((a, b) => {
        const fa = a.followersCount;
        const fb = b.followersCount;
        if (fa !== fb) return fb - fa;
        // Tie-break: by distance if available
        const da = a.distance;
        const db = b.distance;
        if (da != null && db != null) return da - db;
        return 0;
      })
      .slice(0, 10);
  }, [venues, affiliateVenues, userLocation, city, venueGenreMap, venueFavCounts]);

  // ── Period label for carousel heading ──
  const periodLabel = useMemo(() => {
    if (selectedDate) return format(selectedDate, 'EEE d MMM', { locale: dfLocale(language) }).toUpperCase();
    if (dateFilter === 'tomorrow') return t('explore.tomorrow').toUpperCase();
    if (dateFilter === 'weekend') return t('explore.weekend').toUpperCase();
    if (dateFilter === 'week') return t('filter.thisWeek').toUpperCase();
    return t('explore.today').toUpperCase();
  }, [dateFilter, selectedDate, t, language]);

  // ── Date label for header ──
  const dateLabel = useMemo(() => {
    if (!selectedDate) return t(`explore.${dateFilter}`);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sel = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (sel.getTime() === today.getTime()) return t('explore.today');
    if (sel.getTime() === tomorrow.getTime()) return t('explore.tomorrow');
    return format(selectedDate, 'd MMM', { locale: dfLocale(language) });
  }, [selectedDate, dateFilter, t, language]);

  // ══════════════════════════════════════════════════
  // FETCH: main events
  // ══════════════════════════════════════════════════
  const fetchData = async () => {
    setLoading(true);
    const dateSource = selectedDate || dateFilter;
    const { start, end } = getDateRange(dateSource);

    try {
      const filterStartAt = selectedDate || dateFilter !== 'today' ? start : new Date().toISOString();
      const nowIso = new Date().toISOString();
      const toLocalDate = (iso: string) => {
        const d = new Date(iso);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      };
      const startDate = toLocalDate(start);
      const endDate = toLocalDate(end);

      const [eventsRes, liveEventsRes, venuesRes, favCountsRes, djSetsRes, tableZonesRes, clubFavCountsRes, affiliateEventsRes, affiliateVenuesRes, affiliateFavCountsRes] =
        await Promise.all([
          supabase
            .from('events')
            .select('id, slug, title, poster_url, start_at, end_at, venue_id, partner_venue_id, organizer_user_id, is_active, max_tickets, ticketing_enabled, tables_enabled, music_genre, music_genres, event_type, location_city')
            .eq('is_active', true)
            .eq('visibility', 'public')
            .eq('is_discoverable', true)
            .gte('start_at', filterStartAt)
            .lte('start_at', end)
            .order('start_at', { ascending: true }),
          supabase
            .from('events')
            .select('id, slug, title, poster_url, start_at, end_at, venue_id, partner_venue_id, organizer_user_id, is_active, max_tickets, ticketing_enabled, tables_enabled, music_genre, music_genres, event_type, location_city')
            .eq('is_active', true)
            .eq('visibility', 'public')
            .eq('is_discoverable', true)
            .lt('start_at', nowIso)
            .gt('end_at', nowIso)
            .order('start_at', { ascending: true }),
          supabase
            .from('venues')
            .select('id, name, city, address, logo_url, cover_url, latitude, longitude, is_hidden, hidden_from_map')
            .eq('is_hidden', false),
          supabase.rpc('get_public_favorite_counts', { _favorite_type: 'event' }),
          supabase.from('dj_sets').select('event_id, music_genre'),
          supabase.from('table_zones').select('venue_id, tables_count'),
          supabase.rpc('get_public_favorite_counts', { _favorite_type: 'club' }),
          supabase
            .from('affiliate_events')
            .select('id, name, slug, event_date, start_time, end_time, flyer_url, genres, price_from, is_free, external_ticket_url, affiliate_venues(id, name, city, neighborhood, lat, lng)')
            .in('status', ['published', 'featured'])
            .gte('event_date', startDate)
            .lte('event_date', endDate)
            .order('event_date', { ascending: true }),
          supabase
            .from('affiliate_venues')
            .select('id, name, city, slug, cover_image_url, logo_url, lat, lng, genres, is_active')
            .eq('is_active', true),
          supabase.rpc('get_public_favorite_counts', { _favorite_type: 'affiliate_event' }),
        ]);

      const venuesList = venuesRes.data || [];
      setVenues(venuesList);
      setAffiliateVenues(affiliateVenuesRes.data || []);

      const venueFavCounts: Record<string, number> = {};
      (clubFavCountsRes.data || []).forEach(f => {
        if (f.target_id) venueFavCounts[f.target_id] = f.total_count;
      });
      setVenueFavCounts(venueFavCounts);

      const venueMap = new Map(venuesList.map(v => [v.id, v]));

      const favCounts: Record<string, number> = {};
      (favCountsRes.data || []).forEach(f => {
        if (f.target_id) favCounts[f.target_id] = f.total_count;
      });

      const affiliateFavCounts: Record<string, number> = {};
      (affiliateFavCountsRes.data || []).forEach(f => {
        if (f.target_id) affiliateFavCounts[f.target_id] = f.total_count;
      });

      const genreMap: Record<string, Set<string>> = {};
      (djSetsRes.data || []).forEach(ds => {
        if (ds.event_id && ds.music_genre) {
          if (!genreMap[ds.event_id]) genreMap[ds.event_id] = new Set();
          genreMap[ds.event_id].add(ds.music_genre);
        }
      });

      const tablesPerVenue: Record<string, number> = {};
      (tableZonesRes.data || []).forEach(tz => {
        tablesPerVenue[tz.venue_id] = (tablesPerVenue[tz.venue_id] || 0) + tz.tables_count;
      });

      const regularEvents = eventsRes.data || [];
      const liveEvents = liveEventsRes.data || [];
      const liveEventIds = new Set(liveEvents.map(e => e.id));
      const mergedEvents = [...liveEvents, ...regularEvents.filter(e => !liveEventIds.has(e.id))];

      const organizerUserIds = Array.from(
        new Set(mergedEvents.map(e => e.organizer_user_id).filter(Boolean) as string[])
      );
      const organizerMap = new Map<string, { display_name: string; slug: string | null }>();
      if (organizerUserIds.length > 0) {
        const { data: orgProfiles } = await supabase
          .from('organizer_profiles')
          .select('user_id, display_name, slug')
          .in('user_id', organizerUserIds);
        (orgProfiles || []).forEach(op => organizerMap.set(op.user_id, { display_name: op.display_name, slug: op.slug }));
      }

      const eventIds = mergedEvents.map(e => e.id);
      let ticketRounds: ExploreTicketRoundRow[] = [];
      if (eventIds.length > 0) {
        const { data } = await supabase
          .from('ticket_rounds')
          .select('event_id, price, tickets_sold, max_tickets, is_active')
          .in('event_id', eventIds);
        ticketRounds = data || [];
      }

      const minPriceMap: Record<string, number> = {};
      const soldMap: Record<string, { sold: number; max: number }> = {};
      ticketRounds.forEach(tr => {
        if (tr.is_active) {
          const prev = minPriceMap[tr.event_id];
          if (prev === undefined || tr.price < prev) minPriceMap[tr.event_id] = tr.price;
        }
        if (!soldMap[tr.event_id]) soldMap[tr.event_id] = { sold: 0, max: 0 };
        soldMap[tr.event_id].sold += tr.tickets_sold || 0;
        soldMap[tr.event_id].max += tr.max_tickets || 0;
      });

      const allTicketPrices = ticketRounds.filter(tr => tr.is_active).map(tr => tr.price);
      const ticketPriceMin = allTicketPrices.length > 0 ? Math.min(...allTicketPrices) : 0;
      const ticketPriceMax = allTicketPrices.length > 0 ? Math.max(...allTicketPrices) : 200;
      const eventHours = mergedEvents.flatMap(e => [new Date(e.start_at).getHours(), new Date(e.end_at).getHours()]);
      const earliestHour = eventHours.length > 0 ? Math.min(...eventHours.filter(h => h >= 18 || h <= 6).length > 0 ? eventHours.filter(h => h >= 18 || h <= 6) : eventHours) : 18;
      const latestHour = eventHours.length > 0 ? Math.max(...eventHours.filter(h => h <= 6).length > 0 ? eventHours.filter(h => h <= 6) : [6]) : 6;

      setFilterDynamicData({
        ticketPriceMin: Math.floor(ticketPriceMin),
        ticketPriceMax: Math.ceil(ticketPriceMax),
        vipPriceMin: 0,
        vipPriceMax: 200,
        earliestHour,
        latestHour,
      });

      const MAX_DIST = 50;

      const allCards: EventCardData[] = mergedEvents.map(e => {
        const isOrganizerLed = !!e.organizer_user_id;
        const displayVenueId = e.venue_id || (isOrganizerLed ? e.partner_venue_id : null);
        const venue = displayVenueId ? venueMap.get(displayVenueId) : undefined;
        const organizerInfo = isOrganizerLed && e.organizer_user_id ? organizerMap.get(e.organizer_user_id) : undefined;

        const sm = soldMap[e.id];
        const percentSold = sm && sm.max > 0 ? (sm.sold / sm.max) * 100 : 0;
        const interestedCount = favCounts[e.id] || 0;
        const tablesRem = e.tables_enabled && displayVenueId ? (tablesPerVenue[displayVenueId] || null) : null;

        let distance: number | null = null;
        if (userLocation && venue?.latitude && venue?.longitude) {
          distance = haversineKm(userLocation.lat, userLocation.lng, venue.latitude, venue.longitude);
        }

        const eventGenres =
          e.music_genres && e.music_genres.length > 0
            ? e.music_genres
            : e.music_genre
            ? [e.music_genre]
            : Array.from(genreMap[e.id] || []);

        const venueName = isOrganizerLed && organizerInfo
          ? `${organizerInfo.display_name}${venue ? ` · ${venue.name}` : ''}`
          : venue?.name || '';

        return {
          id: e.id,
          slug: e.slug ?? null,
          organizerSlug: organizerInfo?.slug ?? null,
          title: e.title,
          posterUrl: e.poster_url,
          startAt: e.start_at,
          endAt: e.end_at,
          venueName,
          venueSlug: venue?.id || '',
          // Organizer-led events without a club venue carry their own city in
          // events.location_city. Fall back to it so they filter by city instead
          // of slipping through with an empty city.
          venueCity: venue?.city || e.location_city || '',
          minPrice: minPriceMap[e.id] ?? null,
          genres: eventGenres,
          interestedCount,
          percentSold,
          tablesRemaining: tablesRem,
          isTrending: percentSold > 60 || interestedCount > 100,
          distance,
          eventType: e.event_type || 'club',
          isLive: liveEventIds.has(e.id),
          isOrganizerLed,
          organizerName: organizerInfo?.display_name,
        };
      });

      const cards = allCards.filter(e => {
        if (userLocation && e.distance != null) return e.distance <= MAX_DIST;
        if (city) return e.venueCity.toLowerCase().includes(city.toLowerCase());
        return true;
      });

      cards.sort((a, b) => {
        if (a.isTrending !== b.isTrending) return a.isTrending ? -1 : 1;
        if (a.distance != null && b.distance != null) return a.distance - b.distance;
        return 0;
      });

      // Merge affiliate events
      const affiliateCards: EventCardData[] = (affiliateEventsRes.data ?? []).flatMap(ae => {
        const venue = ae.affiliate_venues;
        if (!venue) return [];
        const startAt = `${ae.event_date}T${(ae.start_time || '22:00').substring(0, 5)}:00`;
        const endAt = `${ae.event_date}T${(ae.end_time || '05:30').substring(0, 5)}:00`;
        let distance: number | null = null;
        if (userLocation && venue.lat && venue.lng) {
          distance = haversineKm(userLocation.lat, userLocation.lng, venue.lat, venue.lng);
        }
        return [{
          id: ae.id,
          title: ae.name,
          posterUrl: ae.flyer_url,
          startAt,
          endAt,
          venueName: venue.name,
          venueSlug: venue.id,
          venueCity: venue.city || '',
          minPrice: ae.is_free ? 0 : (ae.price_from ?? null),
          genres: ae.genres || [],
          interestedCount: affiliateFavCounts[ae.id] || 0,
          percentSold: 0,
          tablesRemaining: null,
          isTrending: false,
          distance,
          eventType: 'affiliate',
          isAffiliate: true,
          affiliateEventSlug: ae.slug,
        }];
      }).filter(ae => {
        if (userLocation && ae.distance != null) return ae.distance <= MAX_DIST;
        if (city) return ae.venueCity.toLowerCase().includes(city.toLowerCase());
        return true;
      });

      const mergedCards = [...cards, ...affiliateCards].sort(
        (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()
      );

      setEvents(mergedCards);
      setAllEvents(mergedCards);
    } catch (err) {
      console.error('Error fetching explore data:', err);
      // Surface the failure with a retry instead of leaving the user on a
      // silent, empty home (common on flaky mobile networks inside venues).
      toast.error(t('common.error'), {
        description:
          language === 'fr' ? 'Impossible de charger les événements.'
          : language === 'es' ? 'No se pudieron cargar los eventos.'
          : 'Could not load events.',
        action: {
          label: language === 'fr' ? 'Réessayer' : language === 'es' ? 'Reintentar' : 'Retry',
          onClick: () => { fetchData(); },
        },
      });
    } finally {
      setLoading(false);
    }
  };

  // ══════════════════════════════════════════════════
  // FETCH: week events for "Cette semaine" section
  // ══════════════════════════════════════════════════
  const fetchWeekData = async () => {
    try {
      const today = new Date();
      const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const weekEnd = new Date(todayStart);
      weekEnd.setDate(weekEnd.getDate() + 7);
      weekEnd.setHours(23, 59, 59, 999);

      const startDate = format(todayStart, 'yyyy-MM-dd');
      const endDate = format(weekEnd, 'yyyy-MM-dd');

      const [eventsRes, venuesRes, ticketRes, affiliateEventsRes, favCountsRes, affiliateFavCountsRes] = await Promise.all([
        supabase
          .from('events')
          .select('id, slug, title, poster_url, start_at, end_at, venue_id, partner_venue_id, organizer_user_id, is_active, music_genre, music_genres, event_type, location_city')
          .eq('is_active', true)
          .eq('visibility', 'public')
          .eq('is_discoverable', true)
          .gte('start_at', todayStart.toISOString())
          .lte('start_at', weekEnd.toISOString())
          .order('start_at', { ascending: true })
          .limit(300),
        supabase
          .from('venues')
          .select('id, name, city, cover_url, logo_url, latitude, longitude'),
        supabase.from('ticket_rounds').select('event_id, price, is_active'),
        supabase
          .from('affiliate_events')
          .select('id, name, slug, event_date, start_time, end_time, flyer_url, genres, price_from, is_free, affiliate_venues(id, name, city, neighborhood, lat, lng)')
          .in('status', ['published', 'featured'])
          .gte('event_date', startDate)
          .lte('event_date', endDate)
          .order('event_date', { ascending: true }),
        supabase.rpc('get_public_favorite_counts', { _favorite_type: 'event' }),
        supabase.rpc('get_public_favorite_counts', { _favorite_type: 'affiliate_event' }),
      ]);

      const venueMap = new Map((venuesRes.data || []).map(v => [v.id, v]));

      const minPriceMap: Record<string, number> = {};
      (ticketRes.data || []).forEach(tr => {
        if (tr.is_active) {
          const prev = minPriceMap[tr.event_id];
          if (prev === undefined || tr.price < prev) minPriceMap[tr.event_id] = tr.price;
        }
      });

      const weekFavCounts: Record<string, number> = {};
      (favCountsRes.data || []).forEach(f => {
        if (f.target_id) weekFavCounts[f.target_id] = f.total_count;
      });

      const weekAffiliateFavCounts: Record<string, number> = {};
      (affiliateFavCountsRes.data || []).forEach(f => {
        if (f.target_id) weekAffiliateFavCounts[f.target_id] = f.total_count;
      });

      // Group affiliate events by date
      const affiliateByDate: Record<string, EventCardData[]> = {};
      (affiliateEventsRes.data ?? []).forEach(ae => {
        const venue = ae.affiliate_venues;
        if (!venue) return;
        if (city && !(venue.city || '').toLowerCase().includes(city.toLowerCase())) return;
        const startAt = `${ae.event_date}T${(ae.start_time || '22:00').substring(0, 5)}:00`;
        const endAt = `${ae.event_date}T${(ae.end_time || '05:30').substring(0, 5)}:00`;
        const card: EventCardData = {
          id: ae.id,
          title: ae.name,
          posterUrl: ae.flyer_url,
          startAt,
          endAt,
          venueName: venue.name,
          venueSlug: venue.id,
          venueCity: venue.city || '',
          minPrice: ae.is_free ? 0 : (ae.price_from ?? null),
          genres: ae.genres || [],
          interestedCount: weekAffiliateFavCounts[ae.id] || 0,
          percentSold: 0,
          tablesRemaining: null,
          isTrending: false,
          eventType: 'affiliate',
          isAffiliate: true,
          affiliateEventSlug: ae.slug,
        };
        if (!affiliateByDate[ae.event_date]) affiliateByDate[ae.event_date] = [];
        affiliateByDate[ae.event_date].push(card);
      });

      const days: WeekDayData[] = [];

      for (let i = 0; i < 7; i++) {
        const date = new Date(todayStart);
        date.setDate(date.getDate() + i);
        const dayStr = format(date, 'yyyy-MM-dd');
        const key = i === 0
          ? (language === 'fr' ? 'AUJ' : language === 'es' ? 'HOY' : 'TODAY')
          : format(date, 'EEE', { locale: dfLocale(language) }).toUpperCase();

        const regularEvents = (eventsRes.data || [])
          .filter(e => e.start_at.startsWith(dayStr))
          .map(e => {
            const isOrganizerLed = !!e.organizer_user_id;
            const displayVenueId = e.venue_id || (isOrganizerLed ? e.partner_venue_id : null);
            const venue = displayVenueId ? venueMap.get(displayVenueId) : undefined;
            // Resolve city from the venue, falling back to the event's own
            // location_city (organizer-led events without a club venue). Filter
            // strictly: an event we can't place in the selected city is hidden,
            // not shown in every city.
            const venueCity = venue?.city || e.location_city || '';
            if (city && !venueCity.toLowerCase().includes(city.toLowerCase())) return null;
            const genres =
              (e.music_genres && e.music_genres.length > 0)
                ? (e.music_genres as string[])
                : e.music_genre
                ? [e.music_genre]
                : [];

            return {
              id: e.id,
              slug: e.slug ?? null,
              title: e.title,
              posterUrl: e.poster_url,
              startAt: e.start_at,
              endAt: e.end_at,
              venueName: venue?.name || '',
              venueSlug: displayVenueId || '',
              venueCity,
              minPrice: minPriceMap[e.id] ?? null,
              genres,
              interestedCount: weekFavCounts[e.id] || 0,
              percentSold: 0,
              tablesRemaining: null,
              isTrending: false,
              eventType: e.event_type || 'club',
              isOrganizerLed,
            } as EventCardData;
          })
          .filter((e): e is EventCardData => e !== null);

        const affiliateDay = affiliateByDate[dayStr] || [];
        const allDayEvents = [...regularEvents, ...affiliateDay].sort(
          (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()
        );

        days.push({ key, date, events: allDayEvents });
      }

      setWeekData(days);
    } catch (err) {
      console.error('Error fetching week data:', err);
    }
  };

  // ══════════════════════════════════════════════════
  // FETCH: top DJs — les plus suivis qui jouent cette semaine dans la zone
  // ══════════════════════════════════════════════════
  const fetchTopDjs = async () => {
    try {
      // Soirées club + orga de la semaine, déjà filtrées par ville/fenêtre/visibilité
      // dans weekData. On exclut les affiliés (table séparée, pas de line-up DJ).
      const eventIds = [...new Set(
        weekData.flatMap(d => d.events).filter(e => !e.isAffiliate).map(e => e.id)
      )];
      if (eventIds.length === 0) {
        setTopDjs([]);
        return;
      }

      // Quels DJs jouent l'une de ces soirées ? (event_djs : lecture publique)
      const { data: links } = await supabase
        .from('event_djs')
        .select('dj_id')
        .in('event_id', eventIds);
      const djIds = [...new Set((links || []).map(l => l.dj_id).filter(Boolean))];
      if (djIds.length === 0) {
        setTopDjs([]);
        return;
      }

      // Nombre d'abonnés par DJ + profils publics (vue djs_public, definer), en parallèle.
      const [countsRes, djsRes] = await Promise.all([
        supabase.rpc('get_public_favorite_counts', { _favorite_type: 'dj' }),
        supabase
          .from('djs_public')
          .select('id, slug, handle, stage_name, first_name, last_name, profile_image_url, music_genres, is_verified, is_active')
          .in('id', djIds)
          .eq('is_active', true),
      ]);

      const followerMap: Record<string, number> = {};
      (countsRes.data || []).forEach(f => {
        if (f.target_id) followerMap[f.target_id] = f.total_count;
      });

      // Classement par abonnés décroissant, puis dédoublonnage par personne
      // (un même DJ a une ligne par club/orga ; on garde la plus suivie).
      const ranked = (djsRes.data || [])
        .map(d => ({
          // La vue djs_public expose id nullable, mais .in('id', djIds) garantit sa présence.
          id: d.id as string,
          slug: d.slug,
          handle: d.handle ?? null,
          stageName: (d.stage_name || `${d.first_name ?? ''} ${d.last_name ?? ''}`).trim(),
          profileImageUrl: d.profile_image_url,
          musicGenres: d.music_genres || [],
          isVerified: !!d.is_verified,
          followersCount: followerMap[d.id] || 0,
        }))
        .filter(d => d.stageName)
        .sort((a, b) => b.followersCount - a.followersCount);

      const seen = new Set<string>();
      const deduped: ExploreDJItem[] = [];
      for (const d of ranked) {
        const key = d.stageName.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(d);
        if (deduped.length === 10) break;
      }
      setTopDjs(deduped);
    } catch (err) {
      console.error('Error fetching top DJs:', err);
    }
  };

  // ══════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════
  return (
    <div className="flex min-h-[100dvh] flex-col bg-background">
      {/* Sticky header */}
      <ExploreHeader
        city={city}
        selectedDate={selectedDate}
        dateLabel={dateLabel}
        dateFilter={dateFilter}
        onDateSelect={handleDateSelect}
        onSearchFocus={() => setSearchOpen(true)}
        onFiltersOpen={() => setFiltersOpen(true)}
        onCityChange={handleCityChange}
        activeFiltersCount={activeFiltersCount}
      />

      {/* Scrollable main — le padding bas dégage la BottomNav flottante, la
          pilule « Tous les events » et l'éventuel bandeau Live (safe-area incluse) */}
      <main
        ref={mainRef}
        className="flex-1 overflow-y-auto"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + var(--live-banner-offset, 0px) + 168px)' }}
      >

        {/* ── Chip filter row ── */}
        <div style={{ padding: '12px 0 14px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <ExploreChipRow
            dateFilter={dateFilter}
            onDateChip={handleDateChip}
            genreFilter={chipGenres}
            onGenreToggle={handleGenreToggle}
            freeOnly={freeOnly}
            onFreeToggle={handleFreeToggle}
          />
        </div>

        {/* ── Loading skeleton ── */}
        {loading && <ExploreCardsSkeleton />}

        {/* ══════════════════════════════════════════
            MAIN FEED — sectioned editorial layout
            ══════════════════════════════════════════ */}
        {!loading && (
          <PublicPage variant="discovery">
            {/* ═══ MODULE 1 : Carrousel de toutes les soirées de la période ═══ */}
            <ExploreEventCarousel
              events={carouselEvents}
              city={city}
              periodLabel={periodLabel}
            />

            {/* ═══ MODULE 1bis : « Pour toi » — module de reco autonome ═══
                Se masque tout seul quand rien ne passe sa porte. */}
            <ExploreForYouRail items={forYouItems} />

            {/* ═══ MODULE 2 : Recommandé — soirées à venir cette semaine ═══ */}
            {recoEvents.length > 0 && (
              <FadeInView style={{ marginTop: 32 }}>
                <ExploreSectionTitle kicker={language === 'fr' ? 'À NE PAS MANQUER' : language === 'es' ? 'NO TE LO PIERDAS' : "DON'T MISS"} title={t('filter.thisWeek')} />
                <div
                  className="flex overflow-x-auto"
                  style={{ gap: 14, paddingBottom: 8, paddingLeft: 20, paddingRight: 20, scrollbarWidth: 'none' } as React.CSSProperties}
                >
                  {recoEvents.map(e => (
                    <ExploreRailCard key={e.id} event={e} />
                  ))}
                </div>
              </FadeInView>
            )}

            {/* ═══ MODULE 3 : Les plus réservés — top 5 par popularité ═══ */}
            {trendingEvents.length > 0 && (
              <FadeInView style={{ marginTop: 32 }}>
                <ExploreSectionTitle kicker={language === 'fr' ? 'EN CE MOMENT' : language === 'es' ? 'AHORA MISMO' : 'RIGHT NOW'} title={language === 'fr' ? 'Les plus réservés' : language === 'es' ? 'Los más reservados' : 'Most booked'} />
                <div
                  className="flex overflow-x-auto"
                  style={{ gap: 16, paddingBottom: 8, paddingLeft: 20, paddingRight: 20, scrollbarWidth: 'none' } as React.CSSProperties}
                >
                  {trendingEvents.map((e, i) => (
                    <ExploreRankCard key={e.id} event={e} rank={i + 1} />
                  ))}
                </div>
              </FadeInView>
            )}

            {/* ═══ MODULE 3bis : Les DJs à ne pas manquer — top 10 des plus suivis qui jouent cette semaine ═══ */}
            {topDjs.length > 0 && (
              <FadeInView style={{ marginTop: 32 }}>
                <ExploreSectionTitle
                  kicker={language === 'fr' ? 'LES PLUS SUIVIS' : language === 'es' ? 'LOS MÁS SEGUIDOS' : 'MOST FOLLOWED'}
                  title={language === 'fr' ? 'Les DJs à ne pas manquer' : language === 'es' ? 'DJs que no te puedes perder' : 'DJs not to miss'}
                />
                <div
                  className="flex overflow-x-auto"
                  style={{ gap: 14, paddingBottom: 8, paddingLeft: 20, paddingRight: 20, scrollbarWidth: 'none' } as React.CSSProperties}
                >
                  {topDjs.map((dj, i) => (
                    <ExploreDJCard key={dj.id} dj={dj} rank={i + 1} />
                  ))}
                  {/* "Tout voir" en fin de carrousel — seulement si la liste est au max (cap 10) */}
                  {topDjs.length >= 10 && (
                    <ExploreSeeAllCard
                      label={language === 'fr' ? 'Tout voir' : language === 'es' ? 'Ver todo' : 'See all'}
                      onClick={() => navigate('/djs')}
                      width={140}
                      minHeight={188}
                      borderRadius={14}
                    />
                  )}
                </div>
              </FadeInView>
            )}

            {/* ── Clubs populaires — TOUJOURS VISIBLE ── */}
            {venueItems.length > 0 && (
              <FadeInView style={{ marginTop: 32 }}>
                <ExploreSectionTitle
                  kicker={language === 'fr' ? 'LES INCONTOURNABLES' : language === 'es' ? 'IMPRESCINDIBLES' : 'THE ESSENTIALS'}
                  title={language === 'fr' ? 'Clubs populaires' : language === 'es' ? 'Clubs populares' : 'Popular clubs'}
                />
                <div
                  className="flex overflow-x-auto"
                  style={{ gap: 12, paddingBottom: 8, paddingLeft: 20, paddingRight: 20, scrollbarWidth: 'none' } as React.CSSProperties}
                >
                  {venueItems.map(v => (
                    <ExplorePopularClubCard
                      key={v.id}
                      id={v.id}
                      name={v.name}
                      coverUrl={v.coverUrl}
                      logoUrl={v.logoUrl}
                      city={v.city}
                      primaryGenre={v.primaryGenre}
                      isAffiliate={v.isAffiliate}
                      slug={v.slug}
                    />
                  ))}
                  {/* "Tout voir" en fin de carrousel — seulement si la liste est au max (cap 10) */}
                  {venueItems.length >= 10 && (
                    <ExploreSeeAllCard
                      label={language === 'fr' ? 'Tout voir' : language === 'es' ? 'Ver todo' : 'See all'}
                      onClick={() => navigate('/map')}
                      width={282}
                      minHeight={282}
                      borderRadius={20}
                    />
                  )}
                </div>
              </FadeInView>
            )}

            {/* ── Cette semaine — TOUJOURS VISIBLE ── */}
            {weekData.length > 0 && (
              <FadeInView style={{ marginTop: 32 }}>
                <ExploreSectionTitle kicker={language === 'fr' ? 'À VENIR' : language === 'es' ? 'PRÓXIMAMENTE' : 'UPCOMING'} title={t('filter.thisWeek')} />
                <ExploreDayTabs
                  weekData={weekData}
                  chipGenres={chipGenres}
                  freeOnly={freeOnly}
                  exploreFilters={filters}
                />
              </FadeInView>
            )}
          </PublicPage>
        )}
      </main>

      {/* ── Pill button: tous les events ── */}
      {showAllEventsPill && (
        <button
          onClick={() => navigate('/events')}
          style={{
            position: 'fixed',
            bottom: 'calc(env(safe-area-inset-bottom, 0px) + var(--live-banner-offset, 0px) + 84px)',
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#E8192C',
            color: '#fff',
            border: 'none',
            borderRadius: 999,
            padding: '13px 28px',
            fontFamily: 'monospace',
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            cursor: 'pointer',
            zIndex: 50,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            boxShadow: '0 4px 24px rgba(232,25,44,0.45), 0 1px 4px rgba(0,0,0,0.4)',
            whiteSpace: 'nowrap',
            animation: 'fadeInUp 250ms cubic-bezier(0.16,1,0.3,1)',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          Tous les events
        </button>
      )}

      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} city={city} userLocation={userLocation} />
      <FilterPage
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        filters={filters}
        onApply={handleApplyFilters}
        dynamicData={filterDynamicData}
      />
    </div>
  );
}
