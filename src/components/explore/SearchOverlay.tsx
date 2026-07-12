import { useState, useEffect, useRef, useCallback, Fragment } from 'react';
import { X, Search, TrendingUp, Users, Music, PartyPopper, Clock, ChevronRight, MapPin, Sparkles } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { format, isToday, isTomorrow } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';
import { staggerContainer, staggerItem, spring, tapScale, scaleIn } from '@/lib/animations';

// ─── Types ────────────────────────────────────────────────────────
interface SearchResult {
  events: EventResult[];
  clubs: ClubResult[];
  djs: DjResult[];
  organizers: OrgResult[];
}

interface EventResult {
  id: string;
  title: string;
  poster_url: string | null;
  start_at: string;
  venue_name: string;
  venue_slug: string;
  interested: number;
  music_genres: string[] | null;
  isAffiliate?: boolean;
  affiliateSlug?: string;
}

interface ClubResult {
  id: string;
  name: string;
  logo_url: string | null;
  slug: string | null;
  city: string | null;
  followers: number;
  isAffiliate?: boolean;
}

interface DjResult {
  id: string;
  stage_name: string | null;
  first_name: string;
  last_name: string;
  profile_image_url: string | null;
  music_genres: string[] | null;
  slug: string | null;
  handle: string | null;
}

interface OrgResult {
  id: string;
  name: string;
  logo_url: string | null;
  music_genres: string[] | null;
  slug: string | null;
}

type DateFilter = 'today' | 'tomorrow';

type ChipAction =
  | { type: 'query'; value: string }
  | { type: 'date'; value: DateFilter };

interface ChipDef {
  label: string;
  icon: string;
  action: ChipAction;
}

// ─── Constants ────────────────────────────────────────────────────
const STORAGE_KEY = 'yuno_recent_searches';
const MAX_RECENT = 8;
const MAX_VISIBLE = 3;
const EMPTY: SearchResult = { events: [], clubs: [], djs: [], organizers: [] };

// ─── Animation variants ──────────────────────────────────────────
const overlayVariants = {
  hidden: { opacity: 0, y: 40 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 260, damping: 28 } },
  exit: { opacity: 0, y: 40, transition: { duration: 0.2 } },
};

const chipVariants = {
  hidden: { opacity: 0, scale: 0.8 },
  visible: { opacity: 1, scale: 1, transition: { type: 'spring' as const, stiffness: 400, damping: 20 } },
};

const shimmerClass = 'relative overflow-hidden before:absolute before:inset-0 before:-translate-x-full before:animate-[shimmer_1.5s_infinite] before:bg-gradient-to-r before:from-transparent before:via-white/10 before:to-transparent';

// ─── Helpers ──────────────────────────────────────────────────────
function getRecentSearches(): string[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}

function saveRecentSearch(q: string) {
  const recent = getRecentSearches().filter(s => s.toLowerCase() !== q.toLowerCase());
  recent.unshift(q);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
}

function clearRecentSearches() { localStorage.removeItem(STORAGE_KEY); }

function highlightMatch(text: string, query: string) {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <Fragment>
      {text.slice(0, idx)}
      <span className="font-bold text-primary">{text.slice(idx, idx + query.length)}</span>
      {text.slice(idx + query.length)}
    </Fragment>
  );
}

function formatRelativeDate(dateStr: string, t: (k: string) => string) {
  const d = new Date(dateStr);
  if (isToday(d)) return t('search.tonight');
  if (isTomorrow(d)) return t('search.tomorrow');
  return format(d, 'dd MMM');
}

// Returns all case variants to try for array-contains genre queries
function genreVariants(q: string): string[] {
  const capitalized = q.charAt(0).toUpperCase() + q.slice(1).toLowerCase();
  const lower = q.toLowerCase();
  const upper = q.toUpperCase();
  return [...new Set([q, capitalized, lower, upper])];
}

function getDateRange(filter: DateFilter): { start: string; end: string } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (filter === 'today') {
    const end = new Date(today);
    end.setHours(23, 59, 59, 999);
    return { start: today.toISOString(), end: end.toISOString() };
  }
  // tomorrow
  const start = new Date(today);
  start.setDate(start.getDate() + 1);
  const end = new Date(start);
  end.setHours(23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
}

function getAffiliateDateStr(filter: DateFilter): { start: string; end: string } {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  if (filter === 'today') return { start: todayStr, end: todayStr };
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);
  return { start: tomorrowStr, end: tomorrowStr };
}

// Haversine distance in km between two GPS points
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const SEARCH_RADIUS_KM = 20;

// ─── Component ────────────────────────────────────────────────────
interface SearchOverlayProps {
  open: boolean;
  onClose: () => void;
  city?: string;
  userLocation?: { lat: number; lng: number } | null;
}

export function SearchOverlay({ open, onClose, city, userLocation }: SearchOverlayProps) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState('');
  const [activeDateFilter, setActiveDateFilter] = useState<DateFilter | null>(null);
  const [results, setResults] = useState<SearchResult>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  // Repêchage sémantique : soirées trouvées par le SENS de la requête quand les
  // mots-clés ne rendent aucune soirée ("un truc chill pour danser sans techno").
  const [semanticEvents, setSemanticEvents] = useState<EventResult[]>([]);

  const chips: ChipDef[] = [
    { label: 'House', icon: '🎵', action: { type: 'query', value: 'House' } },
    { label: 'Techno', icon: '🎧', action: { type: 'query', value: 'Techno' } },
    { label: 'VIP', icon: '👑', action: { type: 'query', value: 'VIP' } },
    { label: t('explore.today'), icon: '📅', action: { type: 'date', value: 'today' } },
    { label: t('search.tomorrow') || 'Demain', icon: '🗓️', action: { type: 'date', value: 'tomorrow' } },
  ];

  // Reset on open
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
      setQuery('');
      setActiveDateFilter(null);
      setResults(EMPTY);
      setSemanticEvents([]);
      setRecentSearches(getRecentSearches());
      setExpandedSections({});
    }
  }, [open]);

  // ── searchAll defined before the useEffects that call it ──────
  const searchAll = useCallback(async (q: string, dateFilter: DateFilter | null) => {
    setLoading(true);
    const now = new Date().toISOString();
    const todayStr = new Date().toISOString().slice(0, 10);
    const hasText = q.trim().length >= 1;
    const searchTerm = `%${q}%`;

    try {
      // Resolve venue IDs scoped to the user's location.
      // Priority: GPS coordinates (precise) → city name (fallback) → none (global)
      let cityVenueIds: string[] = [];
      let cityAffVenueIds: string[] = [];

      if (userLocation) {
        // Bounding box first (fast index scan), then exact Haversine filter client-side
        const deltaLat = SEARCH_RADIUS_KM / 111.32;
        const deltaLng = SEARCH_RADIUS_KM / (111.32 * Math.cos((userLocation.lat * Math.PI) / 180));
        const minLat = userLocation.lat - deltaLat;
        const maxLat = userLocation.lat + deltaLat;
        const minLng = userLocation.lng - deltaLng;
        const maxLng = userLocation.lng + deltaLng;

        const [venueBB, affVenueBB] = await Promise.all([
          supabase
            .from('venues')
            .select('id, latitude, longitude')
            .gte('latitude', minLat).lte('latitude', maxLat)
            .gte('longitude', minLng).lte('longitude', maxLng),
          supabase
            .from('affiliate_venues')
            .select('id, lat, lng')
            .eq('is_active', true)
            .gte('lat', minLat).lte('lat', maxLat)
            .gte('lng', minLng).lte('lng', maxLng),
        ]);

        // Exact radius check with Haversine
        cityVenueIds = (venueBB.data || [])
          .filter(v => v.latitude != null && v.longitude != null &&
            haversineKm(userLocation.lat, userLocation.lng, v.latitude!, v.longitude!) <= SEARCH_RADIUS_KM)
          .map(v => v.id);

        cityAffVenueIds = (affVenueBB.data || [])
          .filter(v => v.lat != null && v.lng != null &&
            haversineKm(userLocation.lat, userLocation.lng, v.lat!, v.lng!) <= SEARCH_RADIUS_KM)
          .map(v => v.id);
      } else if (city) {
        // Fallback: city name match (less reliable if venues don't have city filled)
        const [rv, av] = await Promise.all([
          supabase.from('venues').select('id').ilike('city', `%${city}%`),
          supabase.from('affiliate_venues').select('id').ilike('city', `%${city}%`),
        ]);
        cityVenueIds = (rv.data || []).map(v => v.id);
        cityAffVenueIds = (av.data || []).map(v => v.id);
      }

      // Date range constraints
      const dateRange = dateFilter ? getDateRange(dateFilter) : null;
      const affDateRange = dateFilter ? getAffiliateDateStr(dateFilter) : null;

      // ── Build event queries ──────────────────────────────────
      // Helper to apply common constraints to an event query
      const applyEventConstraints = (baseQ: any) => {
        // BDE soirées are private by default and must never surface in public search.
        // Non-BDE events keep their current behavior; BDE events appear only once a
        // super admin has approved them (is_discoverable = true), like in Explore.
        let q2 = baseQ.eq('is_active', true).or('is_bde.eq.false,is_discoverable.eq.true');
        if (dateRange) {
          q2 = q2.gte('start_at', dateRange.start).lte('start_at', dateRange.end);
        } else {
          q2 = q2.gte('end_at', now);
        }
        if (cityVenueIds.length > 0) q2 = q2.in('venue_id', cityVenueIds);
        return q2;
      };

      // When no text query: fetch all events in the date range
      // When text query: search by title + genre (multiple case variants)
      const eventQueries: Promise<any>[] = [];

      if (!hasText && dateFilter) {
        // Date-only: show all events for that day
        eventQueries.push(
          applyEventConstraints(
            supabase
              .from('events')
              .select('id, title, poster_url, start_at, end_at, venue_id, is_active, music_genres')
              .order('start_at', { ascending: true })
              .limit(20)
          )
        );
      } else if (hasText) {
        // Title search
        eventQueries.push(
          applyEventConstraints(
            supabase
              .from('events')
              .select('id, title, poster_url, start_at, end_at, venue_id, is_active, music_genres')
              .ilike('title', searchTerm)
              .limit(10)
          )
        );
        // Genre search — try multiple case variants to handle DB inconsistencies
        for (const variant of genreVariants(q)) {
          eventQueries.push(
            applyEventConstraints(
              supabase
                .from('events')
                .select('id, title, poster_url, start_at, end_at, venue_id, is_active, music_genres')
                .contains('music_genres', [variant])
                .limit(10)
            )
          );
        }
      }

      // ── Build affiliate event queries ────────────────────────
      const applyAffEventConstraints = (baseQ: any) => {
        let q2 = baseQ.in('status', ['published', 'featured']);
        if (affDateRange) {
          q2 = q2.gte('event_date', affDateRange.start).lte('event_date', affDateRange.end);
        } else {
          q2 = q2.gte('event_date', todayStr);
        }
        if (cityAffVenueIds.length > 0) q2 = q2.in('affiliate_venue_id', cityAffVenueIds);
        return q2;
      };

      const affEventQueries: Promise<any>[] = [];

      if (!hasText && dateFilter) {
        affEventQueries.push(
          applyAffEventConstraints(
            supabase
              .from('affiliate_events')
              .select('id, name, flyer_url, event_date, start_time, genres, affiliate_venue_id, slug')
              .order('event_date', { ascending: true })
              .limit(20)
          )
        );
      } else if (hasText) {
        // By name
        affEventQueries.push(
          applyAffEventConstraints(
            supabase
              .from('affiliate_events')
              .select('id, name, flyer_url, event_date, start_time, genres, affiliate_venue_id, slug')
              .ilike('name', searchTerm)
              .limit(8)
          )
        );
        // By genre (multiple case variants)
        for (const variant of genreVariants(q)) {
          affEventQueries.push(
            applyAffEventConstraints(
              supabase
                .from('affiliate_events')
                .select('id, name, flyer_url, event_date, start_time, genres, affiliate_venue_id, slug')
                .contains('genres', [variant])
                .limit(8)
            )
          );
        }
      }

      // ── Clubs + DJs + Orgs ───────────────────────────────────
      let venuesQuery = supabase
        .from('venues')
        .select('id, name, logo_url, city, slug')
        .eq('is_hidden', false);
      if (hasText) {
        venuesQuery = venuesQuery.or(`name.ilike.${searchTerm},city.ilike.${searchTerm}`);
      } else {
        // Date-only mode: show popular clubs in the city
        if (cityVenueIds.length > 0) venuesQuery = venuesQuery.in('id', cityVenueIds);
        venuesQuery = venuesQuery.limit(6);
      }
      if (hasText) venuesQuery = venuesQuery.limit(8);

      let affVenuesQuery = supabase
        .from('affiliate_venues')
        .select('id, name, cover_image_url, logo_url, city, slug')
        .eq('is_active', true);
      if (hasText) {
        affVenuesQuery = affVenuesQuery.ilike('name', searchTerm).limit(6);
      } else {
        if (cityAffVenueIds.length > 0) affVenuesQuery = affVenuesQuery.in('id', cityAffVenueIds);
        affVenuesQuery = affVenuesQuery.limit(6);
      }

      // Run all queries in parallel
      const [
        ...eventResults
      ] = await Promise.all(eventQueries);

      const [
        ...affEventResults
      ] = await Promise.all(affEventQueries);

      const [venuesRes, affVenuesRes, djsRes, organizersRes] = await Promise.all([
        venuesQuery,
        affVenuesQuery,
        hasText
          ? supabase
              .from('djs_public')
              .select('id, stage_name, first_name, last_name, profile_image_url, music_genres, slug, handle')
              .eq('is_active', true)
              .or(`stage_name.ilike.${searchTerm},first_name.ilike.${searchTerm},last_name.ilike.${searchTerm}`)
              .limit(5)
          : Promise.resolve({ data: [] }),
        hasText
          ? supabase
              .from('organizer_profiles')
              .select('user_id, display_name, avatar_url, slug')
              .eq('is_public', true)
              .eq('bde_verified', false) // BDE accounts stay private — never in public search
              .ilike('display_name', searchTerm)
              .limit(5)
          : Promise.resolve({ data: [] }),
      ]);

      // Supplemental DJ genre search
      let djsByGenre: any[] = [];
      if (hasText && q.length >= 2) {
        for (const variant of genreVariants(q)) {
          const { data } = await supabase
            .from('djs_public')
            .select('id, stage_name, first_name, last_name, profile_image_url, music_genres, slug, handle')
            .eq('is_active', true)
            .contains('music_genres', [variant])
            .limit(5);
          djsByGenre = [...djsByGenre, ...(data || [])];
        }
      }

      // ── Merge + dedup events ─────────────────────────────────
      const allRawEvents = eventResults.flatMap((r: any) => r?.data || []);
      const uniqueRawEvents = Array.from(new Map(allRawEvents.map((e: any) => [e.id, e])).values()).slice(0, 12);

      const allAffRaw = affEventResults.flatMap((r: any) => r?.data || []);
      const uniqueAffRaw = Array.from(new Map(allAffRaw.map((e: any) => [e.id, e])).values()).slice(0, 8);

      // Venue names for regular events
      const venueIds = [...new Set(uniqueRawEvents.map((e: any) => e.venue_id))];
      let venueMap: Record<string, { name: string; slug?: string }> = {};
      if (venueIds.length > 0) {
        const { data: vd } = await supabase
          .from('venues')
          .select('id, name, slug')
          .in('id', venueIds);
        venueMap = Object.fromEntries((vd || []).map((v: any) => [v.id, { name: v.name, slug: v.slug }]));
      }

      // Venue names for affiliate events
      const affVenueIds = [...new Set(uniqueAffRaw.map((e: any) => e.affiliate_venue_id).filter(Boolean))];
      let affVenueMap: Record<string, string> = {};
      if (affVenueIds.length > 0) {
        const { data: avd } = await supabase
          .from('affiliate_venues')
          .select('id, name')
          .in('id', affVenueIds);
        affVenueMap = Object.fromEntries((avd || []).map((v: any) => [v.id, v.name]));
      }

      // Favorites for regular events
      const eventIds = uniqueRawEvents.map((e: any) => e.id);
      let favCounts: Record<string, number> = {};
      if (eventIds.length > 0) {
        const { data: favs } = await supabase
          .from('favorites')
          .select('event_id')
          .eq('favorite_type', 'event')
          .in('event_id', eventIds);
        (favs || []).forEach((f: any) => {
          if (f.event_id) favCounts[f.event_id] = (favCounts[f.event_id] || 0) + 1;
        });
      }

      // Club followers
      const clubIds = (venuesRes.data || []).map((v: any) => v.id);
      let clubFollowers: Record<string, number> = {};
      if (clubIds.length > 0) {
        const { data: cf } = await supabase
          .from('favorites')
          .select('venue_id')
          .eq('favorite_type', 'club')
          .in('venue_id', clubIds);
        (cf || []).forEach((f: any) => {
          if (f.venue_id) clubFollowers[f.venue_id] = (clubFollowers[f.venue_id] || 0) + 1;
        });
      }

      if (hasText && q.length >= 2) saveRecentSearch(q);

      // ── Build result objects ─────────────────────────────────
      const regularEvents: EventResult[] = uniqueRawEvents.map((e: any) => ({
        id: e.id,
        title: e.title,
        poster_url: e.poster_url,
        start_at: e.start_at,
        venue_name: venueMap[e.venue_id]?.name || '',
        venue_slug: venueMap[e.venue_id]?.slug || e.venue_id,
        interested: favCounts[e.id] || 0,
        music_genres: e.music_genres,
        isAffiliate: false,
      }));

      const affiliateEvents: EventResult[] = uniqueAffRaw.map((ae: any) => ({
        id: ae.id,
        title: ae.name,
        poster_url: ae.flyer_url || null,
        start_at: ae.event_date + (ae.start_time ? `T${ae.start_time}` : 'T23:00:00'),
        venue_name: ae.affiliate_venue_id ? (affVenueMap[ae.affiliate_venue_id] || '') : '',
        venue_slug: '',
        interested: 0,
        music_genres: ae.genres || null,
        isAffiliate: true,
        affiliateSlug: ae.slug,
      }));

      const mergedEventsMap = new Map<string, EventResult>();
      [...regularEvents, ...affiliateEvents].forEach(e => {
        if (!mergedEventsMap.has(e.id)) mergedEventsMap.set(e.id, e);
      });

      const allDjs = [...(djsRes.data || []), ...djsByGenre];
      // Dédup par personne (handle/stage_name), pas par id : un même DJ a souvent
      // 2 lignes djs (profil perso venue_id NULL + entrée roster d'un club) qui
      // remonteraient toutes les deux. handle est joint par user_id donc identique.
      const uniqueDjs = Array.from(
        new Map(allDjs.map((d: any) => [d.handle || d.stage_name || d.id, d])).values()
      ).slice(0, 5);

      setResults({
        events: Array.from(mergedEventsMap.values()).slice(0, 12),
        clubs: [
          ...(affVenuesRes.data || []).map((av: any) => ({
            id: av.id,
            name: av.name,
            logo_url: av.logo_url || av.cover_image_url || null,
            slug: av.slug,
            city: av.city || null,
            followers: 0,
            isAffiliate: true,
          })),
          ...(venuesRes.data || []).map((v: any) => ({
            id: v.id,
            name: v.name,
            logo_url: v.logo_url || null,
            slug: v.slug || null,
            city: v.city || null,
            followers: clubFollowers[v.id] || 0,
            isAffiliate: false,
          })),
        ],
        djs: uniqueDjs.map((d: any) => ({
          id: d.id,
          stage_name: d.stage_name,
          first_name: d.first_name,
          last_name: d.last_name,
          profile_image_url: d.profile_image_url,
          music_genres: d.music_genres,
          slug: d.slug || null,
          handle: d.handle || null,
        })),
        organizers: (organizersRes.data || []).map((o: any) => ({
          id: o.user_id,
          name: o.display_name,
          logo_url: o.avatar_url,
          music_genres: [] as string[],
          slug: o.slug,
        })),
      });
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      setLoading(false);
    }
  }, [city]);

  // Text query debounce
  useEffect(() => {
    if (query.length < 1 && !activeDateFilter) {
      setResults(EMPTY);
      return;
    }
    if (query.length < 1) return; // date filter handled below
    const timer = setTimeout(() => searchAll(query, activeDateFilter), 200);
    return () => clearTimeout(timer);
  }, [query, searchAll, activeDateFilter]);

  // Date filter trigger (immediate, no debounce)
  useEffect(() => {
    if (activeDateFilter && query.length === 0) {
      searchAll('', activeDateFilter);
    }
  }, [activeDateFilter, searchAll]);

  // ── Repêchage sémantique ──────────────────────────────────────
  // Ne se déclenche QUE quand les mots-clés n'ont rendu aucune soirée : la
  // recherche lexicale reste la voie normale (instantanée, gratuite), le sens
  // ne sert qu'à sauver une recherche qui allait finir sur "aucun résultat".
  // Réservé aux utilisateurs connectés (l'edge function exige un JWT).
  useEffect(() => {
    const q = query.trim();
    if (loading || q.length < 3 || results.events.length > 0) {
      setSemanticEvents([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session || cancelled) return;

        const { data, error } = await supabase.functions.invoke('yuno-assistant', {
          body: { action: 'semantic_search', query: q },
        });
        if (cancelled || error) return;
        const ids = (data?.results || []).map((r: { event_id: string }) => r.event_id);
        if (ids.length === 0) { setSemanticEvents([]); return; }

        const { data: evs } = await supabase
          .from('events')
          .select('id, title, poster_url, start_at, venue_id, music_genres')
          .in('id', ids);
        if (cancelled || !evs?.length) return;

        const venueIds = [...new Set(evs.map(e => e.venue_id).filter(Boolean))] as string[];
        const { data: vens } = venueIds.length
          ? await supabase.from('venues').select('id, name, slug').in('id', venueIds)
          : { data: [] };
        const vmap = new Map((vens || []).map((v: { id: string; name: string; slug: string | null }) => [v.id, v]));

        // On respecte l'ordre de pertinence renvoyé par la RPC.
        const byId = new Map(evs.map(e => [e.id, e]));
        const ordered = ids
          .map((id: string) => byId.get(id))
          .filter(Boolean)
          .map((e): EventResult => ({
            id: e!.id,
            title: e!.title,
            poster_url: e!.poster_url,
            start_at: e!.start_at,
            venue_name: (e!.venue_id && vmap.get(e!.venue_id)?.name) || '',
            venue_slug: (e!.venue_id && vmap.get(e!.venue_id)?.slug) || e!.venue_id || '',
            interested: 0,
            music_genres: e!.music_genres,
            isAffiliate: false,
          }));
        if (!cancelled) setSemanticEvents(ordered.slice(0, 6));
      } catch {
        if (!cancelled) setSemanticEvents([]);
      }
    }, 600);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, loading, results.events.length]);

  const handleChipClick = (action: ChipAction) => {
    if (action.type === 'date') {
      setQuery('');
      setActiveDateFilter(prev => prev === action.value ? null : action.value);
    } else {
      setActiveDateFilter(null);
      setQuery(action.value);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const handleNavigate = (path: string) => { onClose(); navigate(path); };
  const toggleSection = (key: string) => setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));

  const hasResults = results.events.length > 0 || results.clubs.length > 0 || results.djs.length > 0
    || results.organizers.length > 0 || semanticEvents.length > 0;
  const isSearching = query.length >= 1 || activeDateFilter !== null;
  const getVisibleItems = <T,>(items: T[], key: string) =>
    expandedSections[key] ? items : items.slice(0, MAX_VISIBLE);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 bg-background flex flex-col"
          variants={overlayVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          {/* Header */}
          <motion.div
            className="flex items-center gap-3 border-b border-border px-4 py-3"
            style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)' }}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, ...spring.snappy }}
          >
            <div className="flex flex-1 items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 transition-colors focus-within:border-primary/40">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />

              {/* Active date filter tag inside input */}
              {activeDateFilter && (
                <span className="flex items-center gap-1 rounded-full bg-primary/15 border border-primary/30 px-2 py-0.5 text-[11px] font-semibold text-primary shrink-0">
                  {activeDateFilter === 'today' ? t('explore.today') : (t('search.tomorrow') || 'Demain')}
                  <button onClick={() => setActiveDateFilter(null)} className="ml-0.5">
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              )}

              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={e => {
                  setQuery(e.target.value);
                  if (e.target.value.length > 0) setActiveDateFilter(null);
                }}
                placeholder={activeDateFilter ? '' : t('explore.searchPlaceholder')}
                className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
              />
              <AnimatePresence>
                {(query || activeDateFilter) && (
                  <motion.button
                    onClick={() => { setQuery(''); setActiveDateFilter(null); }}
                    className="p-0.5 rounded-full bg-muted"
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0, opacity: 0 }}
                    transition={spring.snappy}
                  >
                    <X className="h-3 w-3 text-muted-foreground" />
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
            <motion.button onClick={onClose} className="text-sm font-medium text-muted-foreground" whileTap={tapScale}>
              {t('common.cancel')}
            </motion.button>
          </motion.div>

          {/* City banner */}
          {city && (
            <motion.div
              className="flex items-center gap-1.5 px-4 py-2 border-b border-border/50"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15, ...spring.snappy }}
            >
              <MapPin className="h-3 w-3 text-primary shrink-0" />
              <span className="text-[11px] text-muted-foreground">
                {t('explore.resultsNear')} <span className="text-foreground font-medium">{city}</span>
              </span>
            </motion.div>
          )}

          {/* Content */}
          <div className="flex-1 overflow-y-auto pb-8">
            <AnimatePresence mode="wait">
              {!isSearching ? (
                /* ── Default state ── */
                <motion.div
                  key="default"
                  className="space-y-5 px-4 pt-4"
                  variants={staggerContainer}
                  initial="hidden"
                  animate="visible"
                  exit={{ opacity: 0 }}
                >
                  {/* Recent searches */}
                  {recentSearches.length > 0 && (
                    <motion.div className="space-y-2" variants={staggerItem}>
                      <div className="flex items-center justify-between">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                          {t('search.recentSearches')}
                        </h3>
                        <button
                          onClick={() => { clearRecentSearches(); setRecentSearches([]); }}
                          className="text-[10px] font-medium text-primary"
                        >
                          {t('search.clearRecent')}
                        </button>
                      </div>
                      <div className="space-y-0.5">
                        {recentSearches.map(s => (
                          <motion.button
                            key={s}
                            onClick={() => setQuery(s)}
                            className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-sm text-foreground transition-colors hover:bg-card active:bg-muted"
                            whileTap={tapScale}
                          >
                            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                            {s}
                          </motion.button>
                        ))}
                      </div>
                    </motion.div>
                  )}

                  {/* Quick filters */}
                  <motion.div className="space-y-2" variants={staggerItem}>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      {t('search.suggestedFilters')}
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {chips.map((chip, i) => {
                        const isActive =
                          chip.action.type === 'date' && activeDateFilter === chip.action.value;
                        return (
                          <motion.button
                            key={chip.label}
                            onClick={() => handleChipClick(chip.action)}
                            className={`rounded-[8px] border px-3 py-1.5 text-xs font-medium transition-colors ${
                              isActive
                                ? 'border-primary bg-primary/15 text-primary'
                                : 'border-border bg-card text-foreground active:bg-muted'
                            }`}
                            variants={chipVariants}
                            custom={i}
                          >
                            <span className="mr-1">{chip.icon}</span>
                            {chip.label}
                          </motion.button>
                        );
                      })}
                    </div>
                  </motion.div>

                  {/* Popular searches */}
                  <motion.div className="space-y-2" variants={staggerItem}>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      {t('search.popularSearches')}
                    </h3>
                    <div className="space-y-0.5">
                      {['Techno', 'House', 'VIP', 'Clubbing', 'After party'].map(s => (
                        <motion.button
                          key={s}
                          onClick={() => setQuery(s)}
                          className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-sm text-foreground transition-colors hover:bg-card active:bg-muted"
                          whileTap={tapScale}
                        >
                          <TrendingUp className="h-4 w-4 text-muted-foreground" />
                          {s}
                        </motion.button>
                      ))}
                    </div>
                  </motion.div>
                </motion.div>
              ) : loading ? (
                <motion.div
                  key="loading"
                  className="flex flex-col gap-3 px-4 py-6"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  {[1, 2, 3, 4, 5].map(i => (
                    <div key={i} className={`h-14 rounded-xl bg-card ${shimmerClass}`} />
                  ))}
                </motion.div>
              ) : !hasResults ? (
                <motion.div
                  key="empty"
                  className="flex flex-col items-center justify-center px-4 py-16 text-center"
                  variants={scaleIn}
                  initial="hidden"
                  animate="visible"
                >
                  <Search className="mb-3 h-8 w-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">{t('search.noResults')}</p>
                  {city && (
                    <p className="mt-1 text-xs text-muted-foreground/60">{t('explore.noResultsIn')} {city}</p>
                  )}
                </motion.div>
              ) : (
                /* ── Results ── */
                <motion.div
                  key="results"
                  className="space-y-5 px-4 pt-4"
                  variants={staggerContainer}
                  initial="hidden"
                  animate="visible"
                >
                  {results.events.length > 0 && (
                    <ResultSection title={t('search.events')} count={results.events.length} sectionKey="events" expanded={expandedSections.events} onToggle={toggleSection} t={t}>
                      {getVisibleItems(results.events, 'events').map(e => (
                        <motion.button
                          key={e.id}
                          onClick={() => e.isAffiliate && e.affiliateSlug
                            ? handleNavigate(`/affiliate-event/${e.affiliateSlug}`)
                            : handleNavigate(`/club/${e.venue_slug}/event/${e.id}`)
                          }
                          className="flex w-full items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-card active:bg-muted"
                          variants={staggerItem}
                          whileTap={tapScale}
                        >
                          <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-muted">
                            {e.poster_url ? (
                              <img src={e.poster_url} alt={e.title} className="h-full w-full object-cover" />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center bg-card">
                                <Music className="h-4 w-4 text-muted-foreground" />
                              </div>
                            )}
                            {e.isAffiliate && (
                              <div className="absolute bottom-0 right-0 bg-primary/90 rounded-tl-md px-1 py-0.5">
                                <Sparkles className="h-2.5 w-2.5 text-white" />
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0 text-left">
                            <p className="text-sm font-medium text-foreground truncate">
                              {highlightMatch(e.title, query)}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">
                              {e.venue_name ? `${e.venue_name} · ` : ''}{formatRelativeDate(e.start_at, t)}
                              {e.music_genres && e.music_genres.length > 0 && ` · ${e.music_genres[0]}`}
                            </p>
                          </div>
                          {e.interested > 0 && (
                            <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground shrink-0">
                              <Users className="h-3 w-3" /> {e.interested}
                            </span>
                          )}
                        </motion.button>
                      ))}
                    </ResultSection>
                  )}

                  {/* Repêchage sémantique : aucune soirée par mots-clés, mais des
                      soirées proches par le sens de la requête. */}
                  {semanticEvents.length > 0 && (
                    <div>
                      <div className="mb-2 flex items-center gap-1.5 px-2">
                        <Sparkles className="h-3.5 w-3.5 text-primary" />
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          {t('search.semanticTitle')}
                        </p>
                      </div>
                      <div className="space-y-1">
                        {semanticEvents.map(e => (
                          <motion.button
                            key={`sem-${e.id}`}
                            onClick={() => handleNavigate(`/club/${e.venue_slug}/event/${e.id}`)}
                            className="flex w-full items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-card active:bg-muted"
                            variants={staggerItem}
                            whileTap={tapScale}
                          >
                            <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-muted">
                              {e.poster_url ? (
                                <img src={e.poster_url} alt={e.title} className="h-full w-full object-cover" />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center bg-card">
                                  <Music className="h-4 w-4 text-muted-foreground" />
                                </div>
                              )}
                            </div>
                            <div className="min-w-0 flex-1 text-left">
                              <p className="truncate text-sm font-medium text-foreground">{e.title}</p>
                              <p className="truncate text-xs text-muted-foreground">
                                {e.venue_name ? `${e.venue_name} · ` : ''}{formatRelativeDate(e.start_at, t)}
                                {e.music_genres && e.music_genres.length > 0 && ` · ${e.music_genres[0]}`}
                              </p>
                            </div>
                          </motion.button>
                        ))}
                      </div>
                    </div>
                  )}

                  {results.clubs.length > 0 && (
                    <ResultSection title={t('search.clubs')} count={results.clubs.length} sectionKey="clubs" expanded={expandedSections.clubs} onToggle={toggleSection} t={t}>
                      {getVisibleItems(results.clubs, 'clubs').map(c => (
                        <motion.button
                          key={c.id}
                          onClick={() => {
                            sessionStorage.setItem('yuno_club_origin', 'explore');
                            handleNavigate(c.isAffiliate && c.slug ? `/affiliate-venue/${c.slug}` : `/club/${c.slug || c.id}`);
                          }}
                          className="flex w-full items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-card active:bg-muted"
                          variants={staggerItem}
                          whileTap={tapScale}
                        >
                          <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full border border-primary/20 bg-muted">
                            {c.logo_url ? (
                              <img src={c.logo_url} alt={c.name} className="h-full w-full object-cover" />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center">
                                <span className="text-sm font-bold text-primary">{c.name[0]}</span>
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0 text-left">
                            <div className="flex items-center gap-1.5">
                              <p className="text-sm font-medium text-foreground truncate">
                                {highlightMatch(c.name, query)}
                              </p>
                              {c.isAffiliate && (
                                <span className="shrink-0 rounded-full bg-primary/10 border border-primary/20 px-1.5 py-0.5 text-[9px] font-semibold text-primary uppercase tracking-wide">
                                  {t('explore.affiliate')}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {c.city && `${c.city} · `}{c.followers} {t('venue.followers')}
                            </p>
                          </div>
                        </motion.button>
                      ))}
                    </ResultSection>
                  )}

                  {results.djs.length > 0 && (
                    <ResultSection title={t('search.djs')} count={results.djs.length} sectionKey="djs" expanded={expandedSections.djs} onToggle={toggleSection} t={t}>
                      {getVisibleItems(results.djs, 'djs').map(d => (
                        <motion.button
                          key={d.id}
                          onClick={() => handleNavigate((d.handle || d.slug) ? `/dj/${d.handle || d.slug}` : '/')}
                          className="flex w-full items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-card active:bg-muted"
                          variants={staggerItem}
                          whileTap={tapScale}
                        >
                          <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-muted">
                            {d.profile_image_url ? (
                              <img src={d.profile_image_url} alt={d.stage_name || d.first_name} className="h-full w-full object-cover" />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center bg-card">
                                <Music className="h-4 w-4 text-muted-foreground" />
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0 text-left">
                            <p className="text-sm font-medium text-foreground truncate">
                              {highlightMatch(d.stage_name || `${d.first_name} ${d.last_name}`, query)}
                            </p>
                            {d.music_genres && d.music_genres.length > 0 && (
                              <p className="text-xs text-muted-foreground truncate">
                                {d.music_genres.slice(0, 3).join(' · ')}
                              </p>
                            )}
                          </div>
                        </motion.button>
                      ))}
                    </ResultSection>
                  )}

                  {results.organizers.length > 0 && (
                    <ResultSection title={t('search.organizers')} count={results.organizers.length} sectionKey="organizers" expanded={expandedSections.organizers} onToggle={toggleSection} t={t}>
                      {getVisibleItems(results.organizers, 'organizers').map(o => (
                        <motion.button
                          key={o.id}
                          onClick={() => handleNavigate(o.slug ? `/o/${o.slug}` : '/')}
                          className="flex w-full items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-card active:bg-muted"
                          variants={staggerItem}
                          whileTap={tapScale}
                        >
                          <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full border border-primary/20 bg-muted">
                            {o.logo_url ? (
                              <img src={o.logo_url} alt={o.name} className="h-full w-full object-cover" />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center bg-card">
                                <PartyPopper className="h-4 w-4 text-muted-foreground" />
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0 text-left">
                            <p className="text-sm font-medium text-foreground truncate">
                              {highlightMatch(o.name, query)}
                            </p>
                            {o.music_genres && o.music_genres.length > 0 && (
                              <p className="text-xs text-muted-foreground truncate">
                                {o.music_genres.slice(0, 3).join(' · ')}
                              </p>
                            )}
                          </div>
                        </motion.button>
                      ))}
                    </ResultSection>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── Result section ───────────────────────────────────────────────
function ResultSection({ title, count, sectionKey, expanded, onToggle, t, children }: {
  title: string; count: number; sectionKey: string; expanded?: boolean;
  onToggle: (key: string) => void; t: (k: string) => string; children: React.ReactNode;
}) {
  return (
    <motion.div className="space-y-1.5" variants={staggerItem}>
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{title}</h3>
        {count > MAX_VISIBLE && (
          <button onClick={() => onToggle(sectionKey)} className="flex items-center gap-0.5 text-[10px] font-medium text-primary">
            {expanded ? t('common.cancel') : t('search.seeAll')}
            <ChevronRight className={`h-3 w-3 transition-transform ${expanded ? 'rotate-90' : ''}`} />
          </button>
        )}
      </div>
      <div className="space-y-0.5">{children}</div>
    </motion.div>
  );
}
