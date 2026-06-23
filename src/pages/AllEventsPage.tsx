import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { format } from 'date-fns';
import { SlidersHorizontal } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { BottomNav } from '@/components/BottomNav';
import { EventCardData } from '@/components/explore/EventCard';
import { Tappable } from '@/components/motion';
import { FilterPage, ExploreFilters, FilterDynamicData } from '@/components/explore/FilterPage';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function navigateToEvent(event: EventCardData, navigate: ReturnType<typeof useNavigate>) {
  if (event.isAffiliate && event.affiliateEventSlug) {
    navigate(`/affiliate-event/${event.affiliateEventSlug}`);
  } else if (event.isOrganizerLed || !event.venueSlug) {
    navigate(`/event/${event.id}`);
  } else {
    sessionStorage.setItem('yuno_club_origin', 'explore');
    navigate(`/club/${event.venueSlug}`);
  }
}

function formatPriceLabel(event: EventCardData): string {
  if (event.minPrice === 0) return 'Gratuit';
  if (event.minPrice !== null) return `${event.minPrice}€`;
  return '';
}

function getDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const date = new Date(y, m - 1, d);
  if (date.getTime() === today.getTime()) return "Aujourd'hui";
  if (date.getTime() === tomorrow.getTime()) return 'Demain';
  const dayName = date.toLocaleDateString('fr-FR', { weekday: 'long' });
  const dayNum = date.getDate();
  const monthName = date.toLocaleDateString('fr-FR', { month: 'long' });
  return `${dayName.charAt(0).toUpperCase() + dayName.slice(1)} ${dayNum} ${monthName}`;
}

function getFilteredDateRange(dateFilter: string): { start: string; end: string; startStr: string; endStr: string } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (dateFilter === 'today') {
    const end = new Date(today);
    end.setHours(23, 59, 59, 999);
    return { start: today.toISOString(), end: end.toISOString(), startStr: format(today, 'yyyy-MM-dd'), endStr: format(end, 'yyyy-MM-dd') };
  }
  if (dateFilter === 'tomorrow') {
    const start = new Date(today);
    start.setDate(start.getDate() + 1);
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    return { start: start.toISOString(), end: end.toISOString(), startStr: format(start, 'yyyy-MM-dd'), endStr: format(end, 'yyyy-MM-dd') };
  }
  if (dateFilter === 'week') {
    const end = new Date(today);
    end.setDate(end.getDate() + 7);
    end.setHours(23, 59, 59, 999);
    return { start: today.toISOString(), end: end.toISOString(), startStr: format(today, 'yyyy-MM-dd'), endStr: format(end, 'yyyy-MM-dd') };
  }
  if (dateFilter === 'weekend') {
    const dayOfWeek = today.getDay();
    const daysUntilThu = dayOfWeek === 0 ? 4 : dayOfWeek <= 3 ? 4 - dayOfWeek : dayOfWeek === 4 ? 0 : 7 - dayOfWeek + 4;
    const thu = new Date(today);
    thu.setDate(thu.getDate() + daysUntilThu);
    const endSat = new Date(thu);
    endSat.setDate(endSat.getDate() + 2);
    endSat.setHours(23, 59, 59, 999);
    return { start: thu.toISOString(), end: endSat.toISOString(), startStr: format(thu, 'yyyy-MM-dd'), endStr: format(endSat, 'yyyy-MM-dd') };
  }
  // Default: 30 days
  const end = new Date(today);
  end.setDate(end.getDate() + 30);
  end.setHours(23, 59, 59, 999);
  return { start: today.toISOString(), end: end.toISOString(), startStr: format(today, 'yyyy-MM-dd'), endStr: format(end, 'yyyy-MM-dd') };
}

const normGenre = (g: string) =>
  g.toLowerCase().replace(/[-_/]/g, ' ').replace(/\s+/g, ' ').trim();

const sliderToHour = (val: number) => (18 + val) % 24;

const DATE_CHIPS = [
  { id: '', label: 'Tout' },
  { id: 'today', label: "Aujourd'hui" },
  { id: 'tomorrow', label: 'Demain' },
  { id: 'weekend', label: 'Week-end' },
  { id: 'week', label: 'Cette semaine' },
];

const TYPE_CHIPS = [
  { id: 'club', label: 'Clubs' },
  { id: 'after_party', label: 'After Parties' },
  { id: 'beach_club', label: 'Beach Clubs' },
  { id: 'open_air', label: 'Open Air' },
];

const FILTER_DYNAMIC_DATA: FilterDynamicData = {
  ticketPriceMin: 0,
  ticketPriceMax: 200,
  vipPriceMin: 0,
  vipPriceMax: 1000,
  earliestHour: 20,
  latestHour: 6,
};

const DEFAULT_FILTERS: ExploreFilters = {
  eventTypes: [],
  genres: [],
  priceRange: [0, 200],
  priceType: 'both',
  dateFilter: '',
  timeRange: [0, 12],
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AllEventsPage() {
  const navigate = useNavigate();
  const location = useLocation();

  const passedFilters = (location.state as any)?.filters as ExploreFilters | undefined;
  const passedCity = (location.state as any)?.city as string | undefined;

  const [rawGroups, setRawGroups] = useState<{ date: string; events: EventCardData[] }[]>([]);
  const [loading, setLoading] = useState(true);
  const [city] = useState(
    () => passedCity || sessionStorage.getItem('yuno_manual_city') || localStorage.getItem('yuno_city') || 'Madrid'
  );

  // Single source of truth for all filters
  const [filters, setFilters] = useState<ExploreFilters>(() => ({
    ...DEFAULT_FILTERS,
    ...passedFilters,
    dateFilter: passedFilters?.dateFilter || '',
  }));
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    fetchAllEvents();
  }, [city]);

  const fetchAllEvents = async () => {
    setLoading(true);
    try {
      // Always 30 days so all date chip filters have data to work on
      const { start, end, startStr, endStr } = getFilteredDateRange('30days');

      const [eventsRes, venuesRes, ticketRes, affiliateRes, favCountsRes, affiliateFavRes] =
        await Promise.all([
          supabase
            .from('events')
            .select('id, title, poster_url, start_at, end_at, venue_id, partner_venue_id, organizer_user_id, is_active, music_genre, music_genres, event_type, location_city')
            .eq('is_active', true)
            .eq('visibility', 'public')
            .eq('is_discoverable', true)
            .gte('start_at', start)
            .lte('start_at', end)
            .order('start_at', { ascending: true })
            .limit(500),
          supabase
            .from('venues')
            .select('id, name, city, cover_url, logo_url'),
          supabase.from('ticket_rounds').select('event_id, price, is_active'),
          supabase
            .from('affiliate_events')
            .select('id, name, slug, event_date, start_time, flyer_url, genres, price_from, is_free, affiliate_venues(id, name, city)')
            .in('status', ['published', 'featured'])
            .gte('event_date', startStr)
            .lte('event_date', endStr)
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

      const favCounts: Record<string, number> = {};
      (favCountsRes.data || []).forEach((f: any) => {
        if (f.target_id) favCounts[f.target_id] = f.total_count;
      });
      const affiliateFavCounts: Record<string, number> = {};
      (affiliateFavRes.data || []).forEach((f: any) => {
        if (f.target_id) affiliateFavCounts[f.target_id] = f.total_count;
      });

      const regularCards: EventCardData[] = (eventsRes.data || []).flatMap(e => {
        const isOrganizerLed = !!e.organizer_user_id;
        const displayVenueId = e.venue_id || (isOrganizerLed ? (e as any).partner_venue_id : null);
        const venue = displayVenueId ? venueMap.get(displayVenueId) : undefined;
        // Organizer-led events without a club venue carry their own city in
        // events.location_city. Use it as a fallback and filter strictly so an
        // event we can't place in the selected city is hidden, not shown in all.
        const venueCity = venue?.city || (e as any).location_city || '';
        if (city && !venueCity.toLowerCase().includes(city.toLowerCase())) return [];
        const genres =
          (e.music_genres && e.music_genres.length > 0)
            ? (e.music_genres as string[])
            : e.music_genre ? [e.music_genre] : [];
        return [{
          id: e.id,
          title: e.title,
          posterUrl: e.poster_url,
          startAt: e.start_at,
          endAt: e.end_at,
          venueName: venue?.name || '',
          venueSlug: displayVenueId || '',
          venueCity,
          minPrice: minPriceMap[e.id] ?? null,
          genres,
          interestedCount: favCounts[e.id] || 0,
          percentSold: 0,
          tablesRemaining: null,
          isTrending: false,
          eventType: e.event_type || 'club',
          isOrganizerLed,
        }] as EventCardData[];
      });

      const affiliateCards: EventCardData[] = (affiliateRes.data || []).flatMap((ae: any) => {
        const venue = ae.affiliate_venues;
        if (!venue) return [];
        if (city && !(venue.city || '').toLowerCase().includes(city.toLowerCase())) return [];
        const startAt = `${ae.event_date}T${(ae.start_time || '22:00').substring(0, 5)}:00`;
        return [{
          id: ae.id,
          title: ae.name,
          posterUrl: ae.flyer_url,
          startAt,
          endAt: startAt,
          venueName: venue.name,
          venueSlug: venue.id,
          venueCity: venue.city || '',
          minPrice: ae.is_free ? 0 : (ae.price_from ?? null),
          genres: ae.genres || [],
          interestedCount: affiliateFavCounts[ae.id] || 0,
          percentSold: 0,
          tablesRemaining: null,
          isTrending: false,
          eventType: 'affiliate',
          isAffiliate: true,
          affiliateEventSlug: ae.slug,
        }] as EventCardData[];
      });

      const all = [...regularCards, ...affiliateCards].sort(
        (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()
      );

      const grouped: { date: string; events: EventCardData[] }[] = [];
      for (const ev of all) {
        const dateStr = ev.startAt.split('T')[0];
        const last = grouped[grouped.length - 1];
        if (last && last.date === dateStr) {
          last.events.push(ev);
        } else {
          grouped.push({ date: dateStr, events: [ev] });
        }
      }

      setRawGroups(grouped);
    } catch (err) {
      console.error('AllEventsPage fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  // Single useMemo applying all filters from the unified `filters` state
  const groups = useMemo(() => {
    const hasFilters =
      filters.dateFilter !== '' ||
      filters.eventTypes.length > 0 ||
      filters.genres.length > 0 ||
      filters.priceType !== 'both' ||
      filters.priceRange[0] > 0 ||
      filters.priceRange[1] < 200 ||
      filters.timeRange[0] > 0 ||
      filters.timeRange[1] < 12;

    if (!hasFilters) return rawGroups;

    return rawGroups.map(group => {
      let events = group.events;

      if (filters.dateFilter) {
        const { start: dStart, end: dEnd } = getFilteredDateRange(filters.dateFilter);
        const st = new Date(dStart).getTime();
        const et = new Date(dEnd).getTime();
        events = events.filter(e => {
          const t = new Date(e.startAt).getTime();
          return t >= st && t <= et;
        });
      }

      if (filters.eventTypes.length > 0) {
        events = events.filter(e =>
          e.eventType === 'affiliate' || filters.eventTypes.includes(e.eventType || 'club')
        );
      }

      if (filters.genres.length > 0) {
        const normFilters = filters.genres.map(normGenre);
        events = events.filter(e =>
          e.genres.some(g => normFilters.includes(normGenre(g)))
        );
      }

      if (filters.priceRange[0] > 0 || filters.priceRange[1] < 200) {
        events = events.filter(e =>
          e.minPrice === null || (e.minPrice >= filters.priceRange[0] && e.minPrice <= filters.priceRange[1])
        );
      }

      if (filters.timeRange[0] > 0 || filters.timeRange[1] < 12) {
        const startH = sliderToHour(filters.timeRange[0]);
        const endH = sliderToHour(filters.timeRange[1]);
        events = events.filter(e => {
          const h = new Date(e.startAt).getHours();
          return startH <= endH ? h >= startH && h <= endH : h >= startH || h <= endH;
        });
      }

      return { ...group, events };
    }).filter(g => g.events.length > 0);
  }, [rawGroups, filters]);

  const totalCount = groups.reduce((sum, g) => sum + g.events.length, 0);

  // Badge count: only deep filters not visible as chips (genres, price, time)
  const activeFiltersCount = useMemo(() => {
    let count = filters.genres.length;
    if (filters.priceType !== 'both') count++;
    if (filters.priceRange[0] > 0 || filters.priceRange[1] < 200) count++;
    if (filters.timeRange[0] > 0 || filters.timeRange[1] < 12) count++;
    return count;
  }, [filters]);

  const setDateFilter = (id: string) =>
    setFilters(prev => ({ ...prev, dateFilter: prev.dateFilter === id ? '' : id }));

  const toggleType = (id: string) =>
    setFilters(prev => ({
      ...prev,
      eventTypes: prev.eventTypes.includes(id)
        ? prev.eventTypes.filter(t => t !== id)
        : [...prev.eventTypes, id],
    }));

  const resetFilters = () => setFilters(DEFAULT_FILTERS);

  const chipBase: React.CSSProperties = {
    flexShrink: 0,
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.06em',
    padding: '6px 13px',
    borderRadius: 20,
    border: '1px solid rgba(255,255,255,0.10)',
    background: 'rgba(255,255,255,0.04)',
    color: '#6A6A6E',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    transition: 'all 120ms ease',
    lineHeight: 1,
  };

  const chipActive: React.CSSProperties = {
    border: '1px solid rgba(232,25,44,0.5)',
    background: 'rgba(232,25,44,0.12)',
    color: '#E8192C',
  };

  return (
    <div style={{ minHeight: '100dvh', background: '#0A0A0A', display: 'flex', flexDirection: 'column' }}>

      {/* ── Header ── */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 40,
          background: 'rgba(10,10,10,0.92)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          padding: '14px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
        }}
      >
        <button
          onClick={() => navigate(-1)}
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.10)',
            borderRadius: '50%',
            width: 36,
            height: 36,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: '#fff',
            flexShrink: 0,
          }}
          aria-label="Retour"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
        </button>

        <div style={{ flex: 1 }}>
          <p style={{ fontFamily: 'monospace', fontSize: 10, color: '#5A5A5E', letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 2 }}>
            L'Agenda
          </p>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#fff', letterSpacing: '-0.01em', lineHeight: 1, textTransform: 'uppercase', margin: 0 }}>
            Tous les events
          </h1>
        </div>

        {!loading && (
          <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#5A5A5E', letterSpacing: '0.12em', textTransform: 'uppercase', flexShrink: 0 }}>
            {totalCount} event{totalCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* ── Filter Bar ── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        background: '#0A0A0A',
        padding: '10px 0 10px 16px',
        gap: 0,
      }}>
        {/* Scrollable chips with right-side fade */}
        <div style={{
          flex: 1,
          minWidth: 0,
          position: 'relative',
          maskImage: 'linear-gradient(to right, black 82%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to right, black 82%, transparent 100%)',
        }}>
          <div style={{
            overflowX: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            paddingRight: 28,
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
          } as React.CSSProperties}>

            {/* Date chips */}
            {DATE_CHIPS.map(opt => {
              const isActive = filters.dateFilter === opt.id && !(opt.id === '' && filters.dateFilter !== '');
              const active = opt.id === '' ? filters.dateFilter === '' : filters.dateFilter === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => setDateFilter(opt.id)}
                  style={{ ...chipBase, ...(active ? chipActive : {}) }}
                >
                  {opt.label}
                </button>
              );
            })}

            {/* Thin separator */}
            <div style={{
              width: 1,
              height: 18,
              background: 'rgba(255,255,255,0.10)',
              flexShrink: 0,
              margin: '0 4px',
            }} />

            {/* Type chips */}
            {TYPE_CHIPS.map(type => {
              const active = filters.eventTypes.includes(type.id);
              return (
                <button
                  key={type.id}
                  onClick={() => toggleType(type.id)}
                  style={{ ...chipBase, ...(active ? chipActive : {}) }}
                >
                  {type.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Full-filter button */}
        <div style={{ flexShrink: 0, padding: '0 16px' }}>
          <button
            onClick={() => setFiltersOpen(true)}
            aria-label="Filtres avancés"
            style={{
              position: 'relative',
              width: 38,
              height: 38,
              borderRadius: 10,
              background: activeFiltersCount > 0 ? 'rgba(232,25,44,0.12)' : '#1A1A1A',
              border: `1px solid ${activeFiltersCount > 0 ? 'rgba(232,25,44,0.45)' : 'rgba(255,255,255,0.10)'}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              flexShrink: 0,
              transition: 'all 150ms ease',
            }}
          >
            <SlidersHorizontal
              size={15}
              style={{ color: activeFiltersCount > 0 ? '#E8192C' : '#9A9A9A' }}
            />
            {activeFiltersCount > 0 && (
              <span style={{
                position: 'absolute',
                top: -5,
                right: -5,
                width: 17,
                height: 17,
                borderRadius: '50%',
                background: '#E8192C',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 9,
                fontWeight: 700,
                color: '#fff',
                border: '1.5px solid #0a0a0a',
              }}>
                {activeFiltersCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* ── Content ── */}
      <main style={{ flex: 1, padding: '0 0 100px' }}>

        {loading ? (
          <div style={{ padding: '32px 20px', display: 'flex', flexDirection: 'column', gap: 20 }}>
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} style={{ display: 'flex', gap: 14, alignItems: 'center', padding: '14px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ width: 72, height: 72, borderRadius: 4, background: '#1A1A1A', flexShrink: 0 }} />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ width: '55%', height: 12, borderRadius: 4, background: '#1A1A1A' }} />
                  <div style={{ width: '35%', height: 10, borderRadius: 4, background: '#161616' }} />
                </div>
              </div>
            ))}
          </div>
        ) : groups.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 20px', textAlign: 'center' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#2A2A2A', marginBottom: 16 }}>
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <p style={{ color: '#555', fontSize: 14, marginBottom: 12 }}>
              Aucun événement pour ces filtres
            </p>
            <button
              onClick={resetFilters}
              style={{
                fontFamily: 'monospace',
                fontSize: 12,
                color: '#E8192C',
                background: 'none',
                border: '1px solid rgba(232,25,44,0.3)',
                borderRadius: 8,
                padding: '8px 16px',
                cursor: 'pointer',
              }}
            >
              Effacer les filtres
            </button>
          </div>
        ) : (
          groups.map(({ date, events }) => (
            <div key={date}>
              {/* Date section header */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 12,
                  padding: '18px 20px 10px',
                  borderBottom: '1px solid rgba(255,255,255,0.07)',
                  position: 'sticky',
                  top: 65,
                  background: 'rgba(10,10,10,0.96)',
                  backdropFilter: 'blur(8px)',
                  WebkitBackdropFilter: 'blur(8px)',
                  zIndex: 10,
                }}
              >
                <h2 style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: '#fff',
                  textTransform: 'uppercase',
                  letterSpacing: '-0.01em',
                  lineHeight: 1,
                  margin: 0,
                }}>
                  {getDateLabel(date)}
                </h2>
                <span style={{
                  fontFamily: 'monospace',
                  fontSize: 10,
                  color: '#3A3A3E',
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                }}>
                  {events.length} event{events.length !== 1 ? 's' : ''}
                </span>
              </div>

              {events.map(event => (
                <EventRow key={event.id} event={event} />
              ))}
            </div>
          ))
        )}
      </main>

      <FilterPage
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        filters={filters}
        onApply={(newFilters) => setFilters({ ...newFilters, dateFilter: newFilters.dateFilter || '' })}
        dynamicData={FILTER_DYNAMIC_DATA}
      />

      <BottomNav />
    </div>
  );
}

// ─── Event Row ────────────────────────────────────────────────────────────────

function EventRow({ event }: { event: EventCardData }) {
  const navigate = useNavigate();
  const timeLabel = format(new Date(event.startAt), 'HH:mm');
  const priceLabel = formatPriceLabel(event);
  const isLive = event.isLive;

  return (
    <Tappable
      as="div"
      pressScale={0.99}
      onClick={() => navigateToEvent(event, navigate)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '14px 20px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        cursor: 'pointer',
        background: 'transparent',
        transition: 'background 150ms ease',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      {/* Thumbnail */}
      <div style={{ position: 'relative', width: 72, height: 72, borderRadius: 4, overflow: 'hidden', background: '#191919', flexShrink: 0 }}>
        {event.posterUrl ? (
          <img
            src={event.posterUrl}
            alt={event.title}
            style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top', display: 'block' }}
          />
        ) : (
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(160deg,#1a0f12,#3a1020)' }} />
        )}
        {isLive && (
          <div style={{
            position: 'absolute', bottom: 4, left: 4,
            background: '#E8192C', color: '#fff',
            fontSize: 8, fontWeight: 700, letterSpacing: '0.1em',
            padding: '2px 5px', borderRadius: 2,
            fontFamily: 'monospace',
          }}>
            LIVE
          </div>
        )}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {event.venueName && (
          <p style={{
            fontFamily: 'monospace',
            fontSize: 10,
            color: '#5A5A5E',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            marginBottom: 4,
            lineHeight: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {event.venueName}
          </p>
        )}
        <h3 style={{
          fontSize: 16,
          fontWeight: 700,
          color: '#fff',
          textTransform: 'uppercase',
          letterSpacing: '-0.01em',
          lineHeight: 1.1,
          margin: '0 0 6px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
        } as React.CSSProperties}>
          {event.title}
        </h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#9A9A9A', letterSpacing: '0.04em' }}>
            {timeLabel}
          </span>
          {event.genres[0] && (
            <>
              <span style={{ color: '#3A3A3E', fontSize: 10 }}>·</span>
              <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#5A5A5E', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                {event.genres[0]}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Price + arrow */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
        {priceLabel && (
          <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#E8192C', fontWeight: 700, letterSpacing: '0.04em' }}>
            {priceLabel}
          </span>
        )}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3A3A3E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h14M12 5l7 7-7 7" />
        </svg>
      </div>
    </Tappable>
  );
}
