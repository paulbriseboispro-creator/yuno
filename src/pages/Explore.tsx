import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { cityFromUrl, getManualCoords, getStoredCity, hasManualCity, setManualLocation, setResolvedCity } from '@/lib/userLocation';
import { markAppReady } from '@/lib/appReady';
import { getCurrentPositionIfGranted, GEOLOC_GRANTED_EVENT } from '@/lib/geolocation';
import { genresMatch } from '@/lib/musicGenres';
import {
  fetchExploreCatalog,
  fetchCatalogDjs,
  placeInZone,
  haversineKm,
  startOfLocalDay,
  endOfLocalDay,
  toLocalDate,
  ZONE_RADIUS_KM,
  type PlacedCard,
  type CatalogDjs,
} from '@/lib/explore/catalog';
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
import { useZoneDensity } from '@/hooks/useZoneDensity';
import { ExploreForYouRail } from '@/components/explore/ExploreForYouRail';
import { MarketTicker, ExploreSingleNight, ExploreEmptyMarket, ExploreFewDates } from '@/components/explore/ExploreLowDensity';
import { ExploreMomentBanner } from '@/components/explore/ExploreMomentBanner';
import { activeMomentForCity } from '@/data/featuredMoments';
import { PublicPage } from '@/components/PublicPage';
import { markWebEngaged } from '@/lib/webHome';
import { ExploreCardsSkeleton } from '@/components/skeletons/ExploreCardsSkeleton';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';

type DateFilter = 'today' | 'tomorrow' | 'weekend' | 'week';

// Un genre stocké correspond-il à un genre coché ? `genresMatch` passe par les
// alias du vocabulaire officiel, donc une vieille fiche taguée « reggaeton »
// remonte bien sur le filtre « Reggaeton / Latino ».
const matchesAny = (stored: string[], selected: string[]) =>
  stored.some(g => selected.some(sel => genresMatch(g, sel)));

/** Fenêtre [start, end] (Date) d'un préréglage ou d'un jour précis. */
function getDateRange(filter: DateFilter | Date): { start: Date; end: Date } {
  const now = new Date();
  const today = startOfLocalDay(now);

  if (filter instanceof Date) {
    return { start: startOfLocalDay(filter), end: endOfLocalDay(filter) };
  }
  if (filter === 'today') {
    return { start: today, end: endOfLocalDay(today) };
  }
  if (filter === 'tomorrow') {
    const start = new Date(today);
    start.setDate(start.getDate() + 1);
    return { start, end: endOfLocalDay(start) };
  }
  if (filter === 'week') {
    const end = new Date(today);
    end.setDate(end.getDate() + 7);
    return { start: today, end: endOfLocalDay(end) };
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
  return { start: thu, end: endOfLocalDay(endSat) };
}

// Pick the date-fns locale matching the active app language (EN/ES/FR).
const dfLocale = (lang: string) => (lang === 'fr' ? fr : lang === 'es' ? es : enUS);

// Défauts stables (référence constante) pour les données dérivées de react-query
// tant que la requête n'a pas résolu : évite un nouveau tableau/objet à chaque
// rendu, donc pas de recalcul superflu des useMemo qui en dépendent.
const EMPTY_PLACED: PlacedCard[] = [];
const EMPTY_WEEK: WeekDayData[] = [];
const EMPTY_DJS: ExploreDJItem[] = [];
const DEFAULT_FILTER_DYNAMIC: FilterDynamicData = {
  ticketPriceMin: 0,
  ticketPriceMax: 200,
  vipPriceMin: 0,
  vipPriceMax: 200,
  earliestHour: 18,
  latestHour: 6,
};

export default function Explore() {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const queryClient = useQueryClient();

  // Accueil monté et peint : signale l'app « prête » pour que l'écran de
  // lancement lance sa sortie (soulèvement) et révèle l'Explorer.
  // Et pose le drapeau « engagé » : quiconque a atteint le feed une fois
  // ne reverra plus la landing vitrine à la racine (voir src/lib/webHome.ts).
  useEffect(() => {
    markWebEngaged();
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

  // ── UI state ──
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

  // ── Location / city ── (shared with ClubMap via @/lib/userLocation)
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(() => getManualCoords());
  const [city, setCity] = useState(() => cityFromUrl() || getStoredCity());

  // ── Ville forcée par l'URL (`/explore?city=Madrid`) ──
  // Lien d'acquisition par marché : on l'enregistre comme un choix MANUEL, au
  // même titre que le sélecteur de ville. Déclaré AVANT l'effet de géoloc, qui
  // sort sur `hasManualCity()` — sans quoi le GPS d'un visiteur de passage
  // écraserait la ville du lien. Effet de bord assumé : la carte et la page
  // Tous les events suivent sur toute la session (stockage partagé).
  useEffect(() => {
    const forced = cityFromUrl();
    if (forced) setManualLocation(forced);
  }, []);

  // ── Module « Pour toi » : cartes + raisons, autonome (horizon 45 j, ville
  //    courante). Déclaré après `city` dont il dépend. Vide = rien à
  //    recommander, la section se masque d'elle-même.
  const forYouItems = useForYouFeed(city);

  // ── Densité de la zone : bascule automatique vers les écrans « faible
  //    densité » (0 soirée / 1 soirée / semaine creuse). Fail-open : en cas
  //    d'erreur le hook renvoie 'full' et le feed standard reprend la main.
  //    Source chargée une fois (60 j, toutes villes) ; la ville se résout en
  //    mémoire — changer de ville ne recharge rien.
  const { density, isLoading: densityLoading } = useZoneDensity(city, userLocation);

  // Poignée pour ouvrir le sélecteur de ville depuis les écrans faible densité.
  const cityPickerRef = useRef<(() => void) | null>(null);

  // ── Moment éditorial (Freshers Week…) : bannière affiche en tête de feed
  //    quand la ville du visiteur a un temps fort en cours ou qui approche.
  const activeMoment = useMemo(() => activeMomentForCity(city), [city]);

  // ══════════════════════════════════════════════════
  // DATA — catalogue unique (react-query), sections dérivées en mémoire
  // ══════════════════════════════════════════════════
  // Le catalogue couvre aujourd'hui → J+7 (fin de journée) + les soirées en
  // cours, TOUTES villes confondues. Il ne dépend ni de la ville ni du
  // préréglage de date : changer l'un ou l'autre ne coûte aucune requête.
  // `todayKey` fait tourner la fenêtre à minuit pour une app laissée ouverte.
  const todayKey = toLocalDate(new Date());
  const catalogRange = useMemo(() => {
    const start = startOfLocalDay(new Date());
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return { start, end: endOfLocalDay(end) };
  }, [todayKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const catalogQuery = useQuery({
    queryKey: ['explore-catalog', todayKey],
    queryFn: () => fetchExploreCatalog(queryClient, catalogRange, { includeLive: true }),
    placeholderData: keepPreviousData,
  });
  const catalog = catalogQuery.data;

  // Jour choisi au calendrier HORS de la fenêtre du catalogue : une requête
  // dédiée, bornée à ce jour. Le feed précédent reste affiché pendant le
  // chargement (placeholder), jamais de squelette après le premier rendu.
  const dayOutside =
    !!selectedDate && (selectedDate.getTime() > catalogRange.end.getTime() || selectedDate.getTime() < catalogRange.start.getTime());
  const dayQuery = useQuery({
    queryKey: ['explore-day', selectedDate ? toLocalDate(selectedDate) : null],
    queryFn: () =>
      fetchExploreCatalog(queryClient, { start: startOfLocalDay(selectedDate!), end: endOfLocalDay(selectedDate!) }),
    enabled: dayOutside,
    placeholderData: keepPreviousData,
  });

  // Squelette : uniquement tant que RIEN n'est encore affichable (premier
  // chargement). Ensuite le contenu reste à l'écran et se remplace en place.
  const loading = catalogQuery.isPending || (dayOutside && dayQuery.isPending);
  const pageLoading = loading || densityLoading;

  // Réseau instable en soirée : on signale l'échec avec un « Réessayer » plutôt
  // que de laisser un accueil vide et silencieux.
  useEffect(() => {
    if (!catalogQuery.isError) return;
    toast.error(t('common.error'), {
      description:
        language === 'fr' ? 'Impossible de charger les événements.'
        : language === 'es' ? 'No se pudieron cargar los eventos.'
        : 'Could not load events.',
      action: {
        label: language === 'fr' ? 'Réessayer' : language === 'es' ? 'Reintentar' : 'Retry',
        onClick: () => { catalogQuery.refetch(); },
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogQuery.isError]);

  // ── Zone du visiteur (mémoire) : rayon 50 km avec coordonnées, sinon ville ──
  const zoneCards = useMemo<PlacedCard[]>(
    () => (catalog ? placeInZone(catalog.cards, city, userLocation) : EMPTY_PLACED),
    [catalog, city, userLocation],
  );
  const dayZoneCards = useMemo<PlacedCard[]>(
    () => (dayOutside && dayQuery.data ? placeInZone(dayQuery.data.cards, city, userLocation) : EMPTY_PLACED),
    [dayOutside, dayQuery.data, city, userLocation],
  );

  // ── Carrousel : soirées de la période choisie (Ce soir / Demain / Week-end / jour) ──
  // « Ce soir » = à partir de MAINTENANT + les soirées en cours (commencées
  // hier, pas finies). Les autres périodes = début dans la fenêtre. Une soirée
  // terminée n'apparaît jamais.
  const events = useMemo<PlacedCard[]>(() => {
    const source = dayOutside ? dayZoneCards : zoneCards;
    const { start, end } = getDateRange(selectedDate || dateFilter);
    const now = Date.now();
    const lower = Math.max(start.getTime(), now);
    const upper = end.getTime();
    const includeLive = !selectedDate ? dateFilter === 'today' || dateFilter === 'week' : start.getTime() <= now && upper >= now;
    return source
      .map(c => {
        const s = new Date(c.startAt).getTime();
        const e = new Date(c.endAt).getTime();
        const live = !c.isAffiliate && s <= now && e > now;
        return { card: c, s, e, live };
      })
      .filter(({ s, e, live }) => (live ? includeLive && e > now : s >= lower && s <= upper))
      .map(({ card, live }) => (card.isLive === live ? card : { ...card, isLive: live }));
  }, [dayOutside, dayZoneCards, zoneCards, selectedDate, dateFilter]);
  const allEvents = events;

  // ── Cette semaine : 7 onglets (jour courant inclus), regroupés par jour ──
  const weekData = useMemo<WeekDayData[]>(() => {
    if (!catalog) return EMPTY_WEEK;
    const byDay = new Map<string, EventCardData[]>();
    for (const c of zoneCards) {
      (byDay.get(c.dayKey) ?? byDay.set(c.dayKey, []).get(c.dayKey)!).push(c);
    }
    const days: WeekDayData[] = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(catalogRange.start);
      date.setDate(date.getDate() + i);
      const dayStr = toLocalDate(date);
      const key = i === 0
        ? (language === 'fr' ? 'AUJ' : language === 'es' ? 'HOY' : 'TODAY')
        : format(date, 'EEE', { locale: dfLocale(language) }).toUpperCase();
      days.push({ key, date, events: byDay.get(dayStr) ?? [] });
    }
    return days;
  }, [catalog, zoneCards, catalogRange, language]);

  // ── Bornes dynamiques des filtres (prix / horaires) sur la période affichée ──
  const filterDynamicData = useMemo<FilterDynamicData>(() => {
    if (events.length === 0) return DEFAULT_FILTER_DYNAMIC;
    const prices: number[] = [];
    const hours: number[] = [];
    for (const e of events) {
      if (e.priceMin != null) prices.push(e.priceMin);
      if (e.priceMax != null) prices.push(e.priceMax);
      hours.push(new Date(e.startAt).getHours(), new Date(e.endAt).getHours());
    }
    const nightHours = hours.filter(h => h >= 18 || h <= 6);
    const earlyPool = nightHours.length > 0 ? nightHours : hours;
    const lateHours = hours.filter(h => h <= 6);
    return {
      ticketPriceMin: prices.length ? Math.floor(Math.min(...prices)) : 0,
      ticketPriceMax: prices.length ? Math.ceil(Math.max(...prices)) : 200,
      vipPriceMin: 0,
      vipPriceMax: 200,
      earliestHour: hours.length ? Math.min(...earlyPool) : 18,
      latestHour: hours.length ? Math.max(...(lateHours.length ? lateHours : [6])) : 6,
    };
  }, [events]);

  // ── DJs du catalogue (toutes villes) — filtrés par zone en mémoire ──
  const catalogEventIdsKey = useMemo(
    () => (catalog ? catalog.cards.filter(c => !c.isAffiliate).map(c => c.id).sort().join(',') : ''),
    [catalog],
  );
  const djsQuery = useQuery({
    queryKey: ['explore-djs', catalogEventIdsKey],
    queryFn: () => fetchCatalogDjs(queryClient, catalogEventIdsKey.split(',')),
    enabled: catalogEventIdsKey.length > 0,
    placeholderData: keepPreviousData,
  });
  const topDjs = useMemo<ExploreDJItem[]>(() => {
    const data: CatalogDjs | undefined = djsQuery.data;
    if (!data || data.djs.length === 0) return EMPTY_DJS;
    const zoneIds = new Set(zoneCards.filter(c => !c.isAffiliate).map(c => c.id));
    const ranked = data.djs
      .filter(d => (data.eventsByDj[d.id] ?? []).some(id => zoneIds.has(id)))
      .sort((a, b) => b.followersCount - a.followersCount);
    // Dédoublonnage par personne (un même DJ a une ligne par club/orga ; on
    // garde la plus suivie).
    const seen = new Set<string>();
    const deduped: ExploreDJItem[] = [];
    for (const d of ranked) {
      const key = d.stageName.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(d);
      if (deduped.length === 10) break;
    }
    return deduped;
  }, [djsQuery.data, zoneCards]);

  // ── Geolocation init ──
  // Init automatique au mount : ne doit JAMAIS déclencher le dialogue système
  // en natif (premier lancement = seule la demande de notifications part).
  useEffect(() => {
    if (hasManualCity()) return;
    const initLocation = async () => {
      getCurrentPositionIfGranted(
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

    // La séquence d'onboarding native vient d'obtenir la permission : on
    // résout la ville tout de suite (le mount ci-dessus s'était tu, faute de
    // permission), sans attendre le prochain lancement.
    const onGranted = () => { initLocation(); };
    window.addEventListener(GEOLOC_GRANTED_EVENT, onGranted);
    return () => window.removeEventListener(GEOLOC_GRANTED_EVENT, onGranted);
  }, []);

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
    // Nouvelle ville = nouveau feed : on repart du haut, comme une app native.
    mainRef.current?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
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
    let result: EventCardData[] = [...events];
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
    // Une soirée « tables uniquement » n'est pas gratuite : c'est la plus chère.
    if (freeOnly) result = result.filter(e => e.minPrice === 0 && !e.tablesOnly);
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
    // Une soirée « tables uniquement » n'est pas gratuite : c'est la plus chère.
    if (freeOnly) result = result.filter(e => e.minPrice === 0 && !e.tablesOnly);
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
    if (!catalog) return [];
    const { venues, affiliateVenues, venueFavCounts } = catalog;
    const cityLc = city.toLowerCase();

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
        if (userLocation && v.distance != null) return v.distance <= ZONE_RADIUS_KM;
        if (cityLc) return (v.city || '').toLowerCase().includes(cityLc);
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
        if (userLocation && v.distance != null) return v.distance <= ZONE_RADIUS_KM;
        if (cityLc) return (v.city || '').toLowerCase().includes(cityLc);
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
  }, [catalog, userLocation, city, venueGenreMap]);

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
        openCityPickerRef={cityPickerRef}
      />

      {/* Scrollable main — le padding bas dégage la BottomNav flottante, la
          pilule « Tous les events » et l'éventuel bandeau Live (safe-area incluse) */}
      <main
        ref={mainRef}
        className="flex-1 overflow-y-auto"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + var(--live-banner-offset, 0px) + 168px)' }}
      >

        {/* ── Chip filter row (feed standard uniquement) ── */}
        {(pageLoading || density.status === 'full') && (
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
        )}

        {/* ── Bandeau marché des écrans faible densité ── */}
        {!pageLoading && density.status !== 'full' && <MarketTicker density={density} city={city} />}

        {/* ── Loading skeleton ── */}
        {pageLoading && <ExploreCardsSkeleton />}

        {/* ══════════════════════════════════════════
            FAIBLE DENSITÉ — 0 soirée (demande), 1 soirée
            (découverte), semaine creuse (arbitrage).
            ══════════════════════════════════════════ */}
        {!pageLoading && density.status !== 'full' && (
          <PublicPage variant="discovery" key={city}>
            {density.status === 'single' && density.upcoming[0] && (
              <ExploreSingleNight
                event={density.upcoming[0]}
                venue={density.venues[0] ?? null}
                city={city}
                onOpenCityPicker={() => cityPickerRef.current?.()}
              />
            )}
            {density.status === 'empty' && (
              <ExploreEmptyMarket
                city={city}
                elsewhere={density.elsewhere}
                elsewhereCityCount={density.elsewhereCityCount}
              />
            )}
            {density.status === 'low' && <ExploreFewDates density={density} />}
          </PublicPage>
        )}

        {/* ══════════════════════════════════════════
            MAIN FEED — sectioned editorial layout
            ══════════════════════════════════════════ */}
        {!pageLoading && density.status === 'full' && (
          <PublicPage variant="discovery" key={city}>
            {/* ═══ MODULE 0 : Bannière moment (Freshers Week…) — se masque
                toute seule hors fenêtre / hors ville / sans matière. ═══ */}
            {activeMoment && <ExploreMomentBanner moment={activeMoment} />}

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

      {/* ── Pill button: tous les events (feed standard uniquement) ── */}
      {showAllEventsPill && density.status === 'full' && (
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
