import { useEffect, useState, useRef, useCallback, useMemo, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { staggerContainer, staggerItem } from '@/lib/animations';
import { Helmet } from 'react-helmet-async';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';

// Lazy load the heavy VenueMap component to reduce initial JS execution
const VenueMap = lazy(() => import('@/components/welcome/VenueMap'));
import { BottomNav } from '@/components/BottomNav';
import { useSuppressBottomNav } from '@/components/PersistentBottomNav';
import VenueCard from '@/components/welcome/VenueCard';
import { LanguageSelector } from '@/components/LanguageSelector';
import { Loader2, MapIcon, Grid3X3, Navigation, Clock, Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';

import { toast } from 'sonner';
import { startOfDay, endOfDay } from 'date-fns';
import { fromParisTime } from '@/lib/timezone';
import { useFavorites } from '@/hooks/useFavorites';
import { cn } from '@/lib/utils';
import { getOptimizedImageUrl } from '@/lib/imageOptimization';
import { getCurrentPosition } from '@/lib/geolocation';

// Threshold for "Popular" badge (total sales count)
const POPULAR_THRESHOLD = 10;
// Days for "New" badge
const NEW_VENUE_DAYS = 30;

interface TodayEvent {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  ticketsRemaining: number | null;
  ticketingEnabled: boolean;
}

interface Venue {
  id: string;
  name: string;
  city: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  cover_url: string | null;
  logo_url: string | null;
  created_at: string;
  distance?: number;
  // Stats for badges
  totalSales?: number;
  isNew?: boolean;
  isPopular?: boolean;
  todayEvent?: TodayEvent;
}

// Calculate distance between two points using Haversine formula
const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const MAX_DISTANCE_KM = 200;

const Welcome = () => {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'map' | 'grid'>('grid');
  useSuppressBottomNav(viewMode === 'map');
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationRequested, setLocationRequested] = useState(false);
  const geocodingRef = useRef(false);
  const { isFavorite, toggleFavorite } = useFavorites();

  // When user arrives at Welcome page directly, clear exclusive mode and enable open navigation
  // This means they're intentionally visiting yunoapp.eu/ (not redirected from a club)
  useEffect(() => {
    // Clear exclusive club mode - user is accessing the main app
    sessionStorage.removeItem('exclusiveClub');
    // Mark session as "open navigation" 
    sessionStorage.setItem('visitedWelcome', 'true');
  }, []);
  // Phase 1: Fetch venues immediately for fast render
  useEffect(() => {
    const fetchVenues = async () => {
      const { data: venuesData, error: venuesError } = await supabase
        .from('venues')
        .select('id, name, city, address, latitude, longitude, cover_url, logo_url, created_at')
        .or('hidden_from_map.is.null,hidden_from_map.eq.false')
        .order('name');

      if (venuesError || !venuesData) {
        setLoading(false);
        return;
      }

      // Calculate "new" badge immediately (no network needed)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - NEW_VENUE_DAYS);

      const basicVenues: Venue[] = venuesData.map(venue => ({
        ...venue,
        isNew: new Date(venue.created_at) > thirtyDaysAgo,
      }));

      setVenues(basicVenues);
      setLoading(false);
    };

    fetchVenues();
  }, []);

  // Phase 2: Deferred stats loading (badges + today events)
  useEffect(() => {
    if (venues.length === 0 || loading) return;

    const enrichWithStats = async () => {
      // Fire all 3 queries in parallel
      const now = new Date();
      const todayStart = fromParisTime(startOfDay(now));
      const todayEnd = fromParisTime(endOfDay(now));

      const [ordersRes, ticketsRes, eventsRes] = await Promise.all([
        supabase.from('orders').select('venue_id').in('status', ['paid', 'served']),
        supabase.from('tickets').select('event_id, events!inner(venue_id)').eq('status', 'paid'),
        supabase.from('events')
          .select('id, venue_id, title, start_at, end_at, ticketing_enabled, ticket_rounds(max_tickets, tickets_sold)')
          .eq('is_active', true)
          .gte('start_at', todayStart.toISOString())
          .lte('start_at', todayEnd.toISOString()),
      ]);

      const salesByVenue: Record<string, number> = {};
      ordersRes.data?.forEach(order => {
        salesByVenue[order.venue_id] = (salesByVenue[order.venue_id] || 0) + 1;
      });
      ticketsRes.data?.forEach((ticket: any) => {
        const venueId = ticket.events?.venue_id;
        if (venueId) {
          salesByVenue[venueId] = (salesByVenue[venueId] || 0) + 1;
        }
      });

      const eventsByVenue: Record<string, TodayEvent> = {};
      eventsRes.data?.forEach((event: any) => {
        let ticketsRemaining: number | null = null;
        if (event.ticket_rounds?.length > 0) {
          const total = event.ticket_rounds.reduce((sum: number, r: any) => sum + (r.max_tickets || 0), 0);
          const sold = event.ticket_rounds.reduce((sum: number, r: any) => sum + (r.tickets_sold || 0), 0);
          ticketsRemaining = total - sold;
        }
        if (!eventsByVenue[event.venue_id]) {
          eventsByVenue[event.venue_id] = {
            id: event.id,
            title: event.title,
            startAt: event.start_at,
            endAt: event.end_at,
            ticketsRemaining,
            ticketingEnabled: event.ticketing_enabled,
          };
        }
      });

      setVenues(prev => prev.map(venue => ({
        ...venue,
        totalSales: salesByVenue[venue.id] || 0,
        isPopular: (salesByVenue[venue.id] || 0) >= POPULAR_THRESHOLD,
        todayEvent: eventsByVenue[venue.id],
      })));
    };

    enrichWithStats();
  }, [loading]);

  // Auto-request geolocation on mount (with Safari iOS improvements)
  useEffect(() => {
    if (locationRequested) return;
    
    const requestGeolocation = () => {
      setLocationRequested(true);

      // Natif : prompt système Apple via le plugin ; web : Safari-friendly.
      getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          });
        },
        () => {
          // Permission refusée / position indisponible — on reste sans position.
        },
        {
          enableHighAccuracy: false,
          timeout: 20000, // Increased timeout for Safari
          maximumAge: 600000 // 10 minutes cache
        }
      );
    };

    // Check permission status first if available (not Safari)
    if ('permissions' in navigator && navigator.permissions.query) {
      navigator.permissions.query({ name: 'geolocation' as PermissionName }).then((result) => {
        if (result.state === 'granted' || result.state === 'prompt') {
          // Safari iOS needs a delay after page load
          setTimeout(requestGeolocation, 800);
        }
      }).catch(() => {
        // Safari doesn't support permissions.query for geolocation
        setTimeout(requestGeolocation, 800);
      });
    } else {
      // Fallback for Safari
      setTimeout(requestGeolocation, 800);
    }
  }, [locationRequested]);

  // Auto-geocode venues without coordinates
  useEffect(() => {
    if (geocodingRef.current || venues.length === 0) return;

    const venuesToGeocode = venues.filter(v => v.address && v.latitude == null && v.longitude == null);
    if (venuesToGeocode.length === 0) return;

    geocodingRef.current = true;

    const geocodeVenues = async () => {
      for (const venue of venuesToGeocode) {
        try {
          const { data, error } = await supabase.functions.invoke('geocode-address', {
            body: { address: venue.address }
          });

          if (!error && data?.latitude && data?.longitude) {
            await supabase
              .from('venues')
              .update({ latitude: data.latitude, longitude: data.longitude })
              .eq('id', venue.id);

            setVenues(prev => prev.map(v => 
              v.id === venue.id 
                ? { ...v, latitude: data.latitude, longitude: data.longitude }
                : v
            ));
          }
        } catch (err) {
          console.error(`Failed to geocode venue ${venue.name}:`, err);
        }
      }
    };

    geocodeVenues();
  }, [venues]);

  // All venues with coordinates (for map markers)
  const allVenuesWithCoords = venues.filter(v => v.latitude != null && v.longitude != null);

  // Filtered venues for the list (within 200km of user)
  const processedVenues = useMemo(() => {
    return userLocation
      ? [...venues]
          .map(venue => ({
            ...venue,
            distance:
              venue.latitude != null && venue.longitude != null
                ? calculateDistance(userLocation.lat, userLocation.lng, venue.latitude, venue.longitude)
                : Infinity,
          }))
          .filter(venue => venue.distance !== Infinity && venue.distance <= MAX_DISTANCE_KM)
          .sort((a, b) => a.distance - b.distance)
      : allVenuesWithCoords;
  }, [venues, userLocation, allVenuesWithCoords]);

  const requestLocation = useCallback(() => {
    setLocationRequested(true);

    // Show loading toast for Safari users
    const loadingToast = toast.loading(t('welcome.locating') || 'Getting your location...');

    getCurrentPosition(
      (position) => {
        toast.dismiss(loadingToast);
        setUserLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude
        });
        toast.success(t('welcome.locationFound') || 'Location found!');
      },
      (error) => {
        const geoErr = error as Partial<GeolocationPositionError> & { message?: string };
        console.error('Manual geolocation error:', geoErr?.code, geoErr?.message);
        toast.dismiss(loadingToast);

        // More specific error messages (code web, message plugin natif)
        if (geoErr?.code === 1 || /denied/i.test(geoErr?.message || '')) {
          toast.error(t('welcome.locationDenied') || 'Location access denied. Please enable location in your browser settings.');
        } else if (geoErr?.code === 2) {
          toast.error(t('welcome.locationUnavailable') || 'Location unavailable. Please try again.');
        } else {
          toast.error(t('welcome.locationError') || 'Unable to get your location');
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 30000, // 30 seconds for manual request
        maximumAge: 0 // Force fresh location
      }
    );
  }, [t]);

  const handleVenueClick = (venueId: string) => {
    // Store that user came from welcome page
    sessionStorage.setItem('fromWelcome', 'true');
    navigate(`/club/${venueId}`);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <>
      <Helmet>
        <title>Yuno - Nightlife Reimagined | Discover Partner Clubs</title>
        <meta name="description" content="Discover Yuno partner nightclubs. Pre-order drinks, buy tickets, and reserve VIP tables at the best clubs in Europe." />
        <meta property="og:title" content="Yuno - Nightlife Reimagined" />
        <meta property="og:description" content="Discover partner clubs and skip the queue with Yuno" />
        <meta property="og:type" content="website" />
        <link rel="canonical" href="https://yunoapp.eu/welcome" />
      </Helmet>

      <div className="h-[100dvh] bg-background flex flex-col overflow-hidden">
        {/* Header */}
        <header
          className="shrink-0 z-50"
          style={{
            background: 'rgba(10,10,10,0.92)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            borderBottom: '1px solid rgba(255,255,255,0.07)',
          }}
        >
          <div className="flex items-center justify-between px-4 py-3">
            {/* Logo */}
            <div className="flex items-baseline gap-2">
              <h1
                className="font-display font-bold"
                style={{ fontSize: '22px', color: '#E8192C', letterSpacing: '-0.025em', lineHeight: 1 }}
              >
                Yuno
              </h1>
              <span
                className="font-mono font-bold uppercase"
                style={{
                  fontSize: '9px',
                  letterSpacing: '0.12em',
                  color: '#E8192C',
                  background: 'rgba(232,25,44,0.12)',
                  border: '1px solid rgba(232,25,44,0.25)',
                  padding: '2px 6px',
                  borderRadius: '999px',
                }}
              >
                Beta
              </span>
            </div>

            <div className="flex items-center gap-2">
              {/* View toggle */}
              <div
                className="flex items-center gap-0.5 p-0.5"
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: '999px',
                }}
              >
                {([{ mode: 'map', Icon: MapIcon }, { mode: 'grid', Icon: Grid3X3 }] as const).map(({ mode, Icon }) => (
                  <button
                    key={mode}
                    onClick={() => setViewMode(mode)}
                    className="flex items-center justify-center transition-all"
                    style={{
                      width: '30px',
                      height: '28px',
                      borderRadius: '999px',
                      background: viewMode === mode ? '#E8192C' : 'transparent',
                      color: viewMode === mode ? '#fff' : '#5A5A5E',
                    }}
                    aria-label={`${mode} view`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                  </button>
                ))}
              </div>
              <LanguageSelector />
            </div>
          </div>
        </header>

        {/* Marquee ticker */}
        <div className="marquee-strip shrink-0">
          <div className="marquee-inner">
            {['YUNO NIGHTLIFE', 'SKIP THE QUEUE', 'ORDER AT THE BAR', 'VIP TABLES', 'TICKETS',
              'YUNO NIGHTLIFE', 'SKIP THE QUEUE', 'ORDER AT THE BAR', 'VIP TABLES', 'TICKETS'].map((text, i) => (
              <span
                key={i}
                className={cn('marquee-item', i % 5 === 0 && 'marquee-item--accent')}
              >
                {text}
              </span>
            ))}
          </div>
        </div>

        {/* Main Content */}
        <main className="flex-1 flex flex-col min-h-0">
          {viewMode === 'map' ? (
            <div className="flex-1 relative flex min-h-0">
              {/* Map takes full width on mobile, partial on desktop */}
              <div className="flex-1 relative min-h-0">
                <Suspense fallback={
                  <div className="absolute inset-0 flex items-center justify-center bg-background">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                  </div>
                }>
                  <VenueMap 
                    venues={processedVenues.map(v => ({
                      id: v.id,
                      name: v.name,
                      city: v.city,
                      latitude: v.latitude,
                      longitude: v.longitude,
                      logo_url: v.logo_url
                    }))}
                    allVenues={allVenuesWithCoords.map(v => ({
                      id: v.id,
                      name: v.name,
                      city: v.city,
                      latitude: v.latitude,
                      longitude: v.longitude,
                      logo_url: v.logo_url
                    }))}
                    onVenueClick={handleVenueClick}
                    userLocation={userLocation}
                    onRequestLocation={requestLocation}
                  />
                </Suspense>
                
                {/* Floating venue list on mobile - offset above BottomNav */}
                <div 
                  className="absolute left-0 right-0 bottom-2 px-4 md:hidden"
                >
                  <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory scrollbar-hide">
                    {processedVenues.map(venue => (
                      <div 
                        key={venue.id} 
                        className="snap-start shrink-0 w-64"
                      >
                        <div 
                          className="bg-card/95 backdrop-blur-md rounded-xl p-3 border border-border/50 shadow-lg cursor-pointer"
                          onClick={() => handleVenueClick(venue.id)}
                        >
                          <div className="flex items-center gap-3">
                            {venue.logo_url ? (
                              <img 
                                src={getOptimizedImageUrl(venue.logo_url, { width: 96, height: 96, quality: 80 })} 
                                alt={venue.name}
                                className="w-12 h-12 rounded-full object-cover border-2 border-primary/30"
                              />
                            ) : (
                              <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center border-2 border-primary/30">
                                <span className="font-bold text-primary text-lg">{venue.name.charAt(0)}</span>
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <h3 className="font-semibold text-foreground truncate">{venue.name}</h3>
                                {/* Inline badges */}
                                {venue.isNew && (
                                  <span className="bg-gradient-to-r from-emerald-500 to-emerald-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full shadow-sm shrink-0">
                                    {t('badge.new')}
                                  </span>
                                )}
                                {venue.isPopular && (
                                  <span className="bg-gradient-to-r from-amber-500 to-orange-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full shadow-sm shrink-0">
                                    {t('badge.hot')}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 mt-0.5">
                                <p className="text-xs text-muted-foreground">{venue.city}</p>
                                {venue.distance !== undefined && venue.distance !== Infinity && (
                                  <span className="text-xs text-primary font-medium">
                                    • {venue.distance < 1 
                                      ? `${Math.round(venue.distance * 1000)}m` 
                                      : `${Math.round(venue.distance)}km`}
                                  </span>
                                )}
                              </div>
                              {/* Today event times */}
                              {venue.todayEvent && (
                                <div className="flex items-center gap-1 mt-1.5">
                                  <span className="bg-primary/15 text-primary text-[11px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1">
                                    <Clock className="w-3 h-3" />
                                    {new Date(venue.todayEvent.startAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                                    {' → '}
                                    {new Date(venue.todayEvent.endAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                </div>
                              )}
                            </div>
                            {/* Favorite button */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleFavorite('club', venue.id);
                              }}
                              aria-label={t('subscribe.action')}
                              className="shrink-0 p-1.5 rounded-full hover:bg-muted/50 transition-colors"
                            >
                              <Bell
                                className={cn(
                                  "w-5 h-5 transition-colors",
                                  isFavorite('club', venue.id)
                                    ? "fill-red-500 text-red-500"
                                    : "text-muted-foreground hover:text-red-400"
                                )}
                              />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              
              {/* Desktop sidebar with venue list */}
              <div className="hidden md:flex w-96 flex-col border-l border-border/50 bg-background/95 backdrop-blur-sm">
                <div className="p-4 border-b border-border/50">
                  <h2 className="font-semibold text-foreground">
                    {t('welcome.nearYou') || 'Clubs near you'}
                  </h2>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {processedVenues.length} {processedVenues.length === 1 ? 'club' : 'clubs'}
                  </p>
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-3">
                  {processedVenues.map(venue => (
                    <div 
                      key={venue.id} 
                      className="bg-card/80 rounded-xl p-3 border border-border/50 shadow-sm cursor-pointer hover:bg-card transition-colors"
                      onClick={() => handleVenueClick(venue.id)}
                    >
                      <div className="flex items-center gap-3">
                        {venue.logo_url ? (
                          <img 
                            src={getOptimizedImageUrl(venue.logo_url, { width: 112, height: 112, quality: 80 })} 
                            alt={venue.name}
                            className="w-14 h-14 rounded-full object-cover border-2 border-primary/30"
                          />
                        ) : (
                          <div className="w-14 h-14 rounded-full bg-primary/20 flex items-center justify-center border-2 border-primary/30">
                            <span className="font-bold text-primary text-xl">{venue.name.charAt(0)}</span>
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-foreground truncate">{venue.name}</h3>
                            {venue.isNew && (
                              <span className="bg-gradient-to-r from-emerald-500 to-emerald-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full shadow-sm shrink-0">
                                {t('badge.new')}
                              </span>
                            )}
                            {venue.isPopular && (
                              <span className="bg-gradient-to-r from-amber-500 to-orange-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full shadow-sm shrink-0">
                                {t('badge.hot')}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <p className="text-sm text-muted-foreground">{venue.city}</p>
                            {venue.distance !== undefined && venue.distance !== Infinity && (
                              <span className="text-sm text-primary font-medium">
                                • {venue.distance < 1 
                                  ? `${Math.round(venue.distance * 1000)}m` 
                                  : `${Math.round(venue.distance)}km`}
                              </span>
                            )}
                          </div>
                          {venue.todayEvent && (
                            <div className="flex items-center gap-1 mt-1.5">
                              <span className="bg-primary/15 text-primary text-[11px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {new Date(venue.todayEvent.startAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                                {' → '}
                                {new Date(venue.todayEvent.endAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                          )}
                        </div>
                        {/* Favorite button */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFavorite('club', venue.id);
                          }}
                          aria-label={t('subscribe.action')}
                          className="shrink-0 p-2 rounded-full hover:bg-muted/50 transition-colors"
                        >
                          <Bell
                            className={cn(
                              "w-5 h-5 transition-colors",
                              isFavorite('club', venue.id)
                                ? "fill-red-500 text-red-500"
                                : "text-muted-foreground hover:text-red-400"
                            )}
                          />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="px-4 py-6 pb-24" style={{ maxWidth: '768px', margin: '0 auto' }}>
              {/* Section header */}
              <div className="flex items-end justify-between mb-5">
                <div>
                  <p
                    className="font-mono uppercase mb-1"
                    style={{ fontSize: '11px', letterSpacing: '0.12em', color: '#5A5A5E' }}
                  >
                    {processedVenues.length} {processedVenues.length === 1 ? 'club' : 'clubs'}
                  </p>
                  <h2
                    className="font-display font-bold"
                    style={{ fontSize: 'clamp(22px, 5vw, 32px)', color: '#FFFFFF', letterSpacing: '-0.02em', lineHeight: 1.05 }}
                  >
                    {t('welcome.discoverClubs') || 'DISCOVER CLUBS'}
                  </h2>
                </div>
                {!userLocation && (
                  <button
                    onClick={requestLocation}
                    className="flex items-center gap-1.5 font-mono font-bold uppercase transition-colors"
                    style={{
                      fontSize: '10px',
                      letterSpacing: '0.10em',
                      color: '#E8192C',
                      padding: '6px 14px',
                      borderRadius: '999px',
                      border: '1px solid rgba(232,25,44,0.35)',
                      background: 'rgba(232,25,44,0.08)',
                    }}
                  >
                    <Navigation className="w-3 h-3" />
                    Near me
                  </button>
                )}
              </div>

              <div className="yuno-divider mb-5" />

              {processedVenues.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                  <MapIcon className="w-10 h-10" style={{ color: '#3A3A3E' }} />
                  <p className="font-mono text-center" style={{ fontSize: '13px', color: '#5A5A5E', letterSpacing: '0.04em' }}>
                    {userLocation
                      ? (t('welcome.noClubsNearby') || 'No partner club near your location')
                      : (t('welcome.noClubs') || 'No clubs available yet')}
                  </p>
                  {!userLocation && (
                    <button
                      onClick={requestLocation}
                      className="btn btn--ghost mt-2"
                      style={{ fontSize: '12px' }}
                    >
                      <Navigation className="w-3.5 h-3.5" />
                      {t('welcome.useLocation') || 'Use my location'}
                    </button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {processedVenues.map((venue, index) => (
                    <VenueCard
                      key={venue.id}
                      id={venue.id}
                      name={venue.name}
                      city={venue.city}
                      coverUrl={venue.cover_url}
                      logoUrl={venue.logo_url}
                      distance={venue.distance}
                      isNew={venue.isNew}
                      isPopular={venue.isPopular}
                      todayEvent={venue.todayEvent}
                      priority={index === 0}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </main>

        {/* Footer */}
        {viewMode === 'grid' && (
          <footer
            className="shrink-0 py-4"
            style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}
          >
            <p
              className="font-mono text-center"
              style={{ fontSize: '11px', color: '#3A3A3E', letterSpacing: '0.06em' }}
            >
              © {new Date().getFullYear()} YUNO · ALL RIGHTS RESERVED
            </p>
          </footer>
        )}
        
        {/* Vue carte : la barre descend dans le flux flex (« docked »), donc on
            masque la globale et on pose la nôtre. Vue grille : la barre globale
            (fixe, hors <Routes>) fait le travail — rien à rendre ici. */}
        {viewMode === 'map' && <BottomNav mode="docked" />}
      </div>
    </>
  );
};

export default Welcome;
