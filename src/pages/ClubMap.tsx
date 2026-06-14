import { lazy, Suspense, useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { BottomNav } from '@/components/BottomNav';
import VenueMapBottomSheet from '@/components/welcome/VenueMapBottomSheet';
import VenuePreviewCard from '@/components/welcome/VenuePreviewCard';
import type { MapVenue } from '@/components/welcome/VenueMap';
import { calculateDistance } from '@/components/welcome/VenueMap';
import { useLanguage } from '@/contexts/LanguageContext';
import { getManualCoords, hasManualCity, setManualLocation, clearManualLocation } from '@/lib/userLocation';
import mapboxgl from 'mapbox-gl';
import { Music, MapPin, Layers } from 'lucide-react';

const VenueMap = lazy(() => import('@/components/welcome/VenueMap').then(m => ({ default: m.default })));

type FilterType = 'all' | 'tonight' | 'nearby';

export default function ClubMap() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [venues, setVenues] = useState<MapVenue[]>([]);
  const [visibleVenues, setVisibleVenues] = useState<MapVenue[]>([]);
  // Shared with the Explore home page: if the visitor picked a city there (e.g. Madrid),
  // start from that location instead of the device GPS position.
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(() => getManualCoords());
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const [selectedVenue, setSelectedVenue] = useState<MapVenue | null>(null);

  useEffect(() => {
    // Respect a manual city pick from Explore — don't override it with GPS.
    if (hasManualCity()) return;
    navigator.geolocation?.getCurrentPosition(
      pos => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {}
    );
  }, []);

  // Fetch venues + today's events
  useEffect(() => {
    const fetchData = async () => {
      const now = new Date();
      const windowStart = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString();
      const windowEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

      const today = new Date().toISOString().split('T')[0];

      const [venuesRes, eventsRes, affiliateVenuesRes, affiliateEventsRes] = await Promise.all([
        supabase.from('venues').select('id, name, city, latitude, longitude, logo_url'),
        supabase.from('events').select('id, venue_id, title, start_at, end_at, is_active')
          .eq('is_active', true)
          .gte('end_at', windowStart)
          .lte('start_at', windowEnd),
        supabase
          .from('affiliate_venues')
          .select('id, name, city, lat, lng, logo_url')
          .eq('is_active', true)
          .not('lat', 'is', null)
          .not('lng', 'is', null),
        supabase
          .from('affiliate_events')
          .select('id, affiliate_venue_id, name, event_date')
          .in('status', ['published', 'featured'])
          .eq('event_date', today),
      ]);

      // Regular venues
      const eventsMap = new Map<string, { title: string }>();
      eventsRes.data?.forEach(e => {
        if (!eventsMap.has(e.venue_id)) {
          eventsMap.set(e.venue_id, { title: e.title });
        }
      });

      const enriched: MapVenue[] = (venuesRes.data || []).map(v => ({
        ...v,
        todayEvent: eventsMap.get(v.id) || null,
      }));

      // Affiliate venues — map lat/lng → latitude/longitude for MapVenue compat
      const affiliateEventsMap = new Map<string, { title: string }>();
      affiliateEventsRes.data?.forEach(e => {
        if (!affiliateEventsMap.has(e.affiliate_venue_id)) {
          affiliateEventsMap.set(e.affiliate_venue_id, { title: e.name });
        }
      });

      const affiliateEnriched: MapVenue[] = (affiliateVenuesRes.data || []).map(v => ({
        id: v.id,
        name: v.name,
        city: v.city ?? '',
        latitude: v.lat ? Number(v.lat) : null,
        longitude: v.lng ? Number(v.lng) : null,
        logo_url: v.logo_url ?? null,
        todayEvent: affiliateEventsMap.get(v.id) || null,
      }));

      const all = [...enriched, ...affiliateEnriched];
      setVenues(all);
      setVisibleVenues(all);
    };
    fetchData();
  }, []);

  const handleRequestLocation = () => {
    // Explicit device-location request: drop any manual city pick so both pages use GPS.
    clearManualLocation();
    navigator.geolocation?.getCurrentPosition(
      pos => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {}
    );
  };

  // City searched on the map → persist it as the shared manual pick so Explore matches.
  const handleLocationChange = useCallback((city: string, coords: { lat: number; lng: number }) => {
    setManualLocation(city, coords);
    setUserLocation(coords);
  }, []);

  const handleVenueClick = useCallback((venueId: string) => {
    const venue = venues.find(v => v.id === venueId);
    if (venue) {
      setSelectedVenue(venue);
    }
  }, [venues]);

  const handleNavigateToVenue = useCallback((venueId: string) => {
    sessionStorage.setItem('yuno_club_origin', 'map');
    navigate(`/club/${venueId}`);
  }, [navigate]);

  const handleMapMove = useCallback((bounds: mapboxgl.LngLatBounds) => {
    const visible = venues.filter(v => {
      if (!v.latitude || !v.longitude) return false;
      return bounds.contains([v.longitude, v.latitude]);
    });
    setVisibleVenues(visible);
  }, [venues]);

  const handleMapDragStart = useCallback(() => {
    setSelectedVenue(null);
  }, []);

  // Apply filters to VISIBLE venues (current map area) for bottom sheet
  const filteredVenues = useMemo(() => {
    const base = visibleVenues;
    if (activeFilter === 'tonight') return base.filter(v => v.todayEvent);
    if (activeFilter === 'nearby' && userLocation) {
      return base.filter(v => {
        if (!v.latitude || !v.longitude) return false;
        return calculateDistance(userLocation.lat, userLocation.lng, v.latitude, v.longitude) <= 10;
      });
    }
    return base;
  }, [visibleVenues, activeFilter, userLocation]);

  // Also filter what the map shows
  const mapVenues = useMemo(() => {
    if (activeFilter === 'tonight') {
      return venues.filter(v => v.todayEvent);
    }
    if (activeFilter === 'nearby' && userLocation) {
      return venues.filter(v => {
        if (!v.latitude || !v.longitude) return false;
        return calculateDistance(userLocation.lat, userLocation.lng, v.latitude, v.longitude) <= 10;
      });
    }
    return venues;
  }, [venues, activeFilter, userLocation]);

  const filters: { key: FilterType; label: string; icon: typeof Layers }[] = [
    { key: 'all', label: t('welcome.filterAll'), icon: Layers },
    { key: 'tonight', label: t('welcome.filterTonight'), icon: Music },
    { key: 'nearby', label: t('welcome.filterNearby'), icon: MapPin },
  ];

  return (
    <div
      className="fixed inset-0 flex flex-col bg-background overflow-hidden"
      style={{ height: 'calc(100dvh)', minHeight: '-webkit-fill-available' } as React.CSSProperties}
    >
      <div className="shrink-0" style={{ height: 'env(safe-area-inset-top, 0px)' }} />

      <div className="flex-1 min-h-0 relative">
        <Suspense fallback={<div className="absolute inset-0 flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>}>
          <div className="absolute inset-0">
            <VenueMap
              venues={mapVenues}
              allVenues={venues}
              onVenueClick={handleVenueClick}
              userLocation={userLocation}
              onRequestLocation={handleRequestLocation}
              onLocationChange={handleLocationChange}
              onClose={() => navigate('/')}
              onMapMove={handleMapMove}
              onMapDragStart={handleMapDragStart}
            />
          </div>
        </Suspense>

        {/* Filter chips */}
        <div className="absolute left-4 right-4 z-10 flex gap-2 overflow-x-auto no-scrollbar" style={{ top: 'calc(env(safe-area-inset-top, 0px) + 72px)' }}>
          {filters.map(f => {
            const active = activeFilter === f.key;
            const Icon = f.icon;
            return (
              <button
                key={f.key}
                onClick={() => setActiveFilter(f.key)}
                className={`
                  flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold
                  whitespace-nowrap transition-all shrink-0 border
                  ${active
                    ? 'bg-primary text-primary-foreground border-primary shadow-lg'
                    : 'bg-card/95 text-foreground border-border/60 backdrop-blur-xl hover:bg-card shadow-md'
                  }
                `}
              >
                <Icon className="w-3.5 h-3.5" />
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Venue Preview Card — shown when a venue is selected */}
      {selectedVenue && (
        <VenuePreviewCard
          venue={selectedVenue}
          onClose={() => setSelectedVenue(null)}
          onNavigate={handleNavigateToVenue}
        />
      )}

      {/* Bottom Sheet — hidden when preview is shown */}
      {!selectedVenue && (
        <VenueMapBottomSheet
          venues={filteredVenues}
          userLocation={userLocation}
          onVenueSelect={handleNavigateToVenue}
        />
      )}

      <BottomNav mode="docked" />
    </div>
  );
}
