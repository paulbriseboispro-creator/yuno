import { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { supabase } from '@/integrations/supabase/client';
import { Navigation, LocateFixed, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import VenueMapSearch from './VenueMapSearch';

export interface MapVenue {
  id: string;
  name: string;
  city: string;
  latitude: number | null;
  longitude: number | null;
  logo_url: string | null;
  todayEvent?: { title: string } | null;
}

interface VenueMapProps {
  venues: MapVenue[];
  allVenues: MapVenue[];
  onVenueClick: (venueId: string) => void;
  userLocation: { lat: number; lng: number } | null;
  onRequestLocation: () => void;
  /** Fired when the visitor searches a city, so the parent can sync it across pages. */
  onLocationChange?: (city: string, coords: { lat: number; lng: number }) => void;
  onClose?: () => void;
  onMapMove?: (bounds: mapboxgl.LngLatBounds) => void;
  onMapDragStart?: () => void;
}

const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

export { calculateDistance };

/** Create a circular logo marker element */
function createLogoMarkerEl(venue: MapVenue): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = 'cursor:pointer;';

  const size = 40;
  const marker = document.createElement('div');
  marker.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;overflow:hidden;border:2.5px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.4);background:${venue.logo_url ? '#1a1a1a' : '#dc2626'};display:flex;align-items:center;justify-content:center;`;

  const renderFallback = () => {
    marker.replaceChildren();
    const initial = document.createElement('span');
    initial.textContent = (venue.name || '?').charAt(0).toUpperCase();
    initial.style.cssText = 'color:#fff;font-weight:700;font-size:16px;line-height:1;';
    marker.appendChild(initial);
  };

  if (venue.logo_url) {
    const img = document.createElement('img');
    img.src = venue.logo_url;
    img.alt = venue.name || 'Venue logo';
    img.referrerPolicy = 'no-referrer';
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
    img.onerror = renderFallback;
    marker.appendChild(img);
  } else {
    renderFallback();
  }

  el.appendChild(marker);
  return el;
}


const VenueMap = ({ venues, allVenues, onVenueClick, userLocation, onRequestLocation, onLocationChange, onClose, onMapMove, onMapDragStart }: VenueMapProps) => {
  const { t } = useLanguage();
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const userMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const venueMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const onVenueClickRef = useRef(onVenueClick);
  onVenueClickRef.current = onVenueClick;
  const onMapDragStartRef = useRef(onMapDragStart);
  onMapDragStartRef.current = onMapDragStart;
  const onMapMoveRef = useRef(onMapMove);
  onMapMoveRef.current = onMapMove;

  const findNearestVenue = useCallback((lat: number, lng: number) => {
    const venuesWithCoords = allVenues.filter(v => v.latitude && v.longitude);
    if (venuesWithCoords.length === 0) return null;
    let nearest = venuesWithCoords[0];
    let minDist = calculateDistance(lat, lng, nearest.latitude!, nearest.longitude!);
    venuesWithCoords.forEach(venue => {
      const dist = calculateDistance(lat, lng, venue.latitude!, venue.longitude!);
      if (dist < minDist) { minDist = dist; nearest = venue; }
    });
    return { venue: nearest, distance: minDist };
  }, [allVenues]);

  const handleSearch = useCallback((center: [number, number], placeName: string) => {
    if (!map.current || !mapReady) return;
    const [lng, lat] = center;
    // Persist the searched city as the shared location so the Explore page matches it.
    onLocationChange?.(placeName.split(',')[0].trim(), { lat, lng });
    const venuesWithCoords = allVenues.filter(v => v.latitude && v.longitude);
    const nearbyVenues = venuesWithCoords.filter(v =>
      calculateDistance(lat, lng, v.latitude!, v.longitude!) <= 50
    );
    if (nearbyVenues.length > 0) {
      map.current.flyTo({ center: [lng, lat], zoom: 11, duration: 1500 });
    } else {
      const nearest = findNearestVenue(lat, lng);
      if (nearest) {
        toast.info(t('welcome.noClubsInArea') || `No clubs in ${placeName.split(',')[0]}. Showing nearest clubs.`, { duration: 4000 });
        map.current.flyTo({ center: [nearest.venue.longitude!, nearest.venue.latitude!], zoom: 10, duration: 1500 });
      }
    }
  }, [mapReady, allVenues, findNearestVenue, t, onLocationChange]);

  const recenterOnUser = useCallback(() => {
    if (!map.current || !userLocation) return;
    map.current.flyTo({ center: [userLocation.lng, userLocation.lat], zoom: 10, duration: 1000 });
  }, [userLocation]);

  // Init map
  useEffect(() => {
    const handleResize = () => map.current?.resize();

    const initMap = async () => {
      if (!mapContainer.current) return;
      try {
        let token = import.meta.env.VITE_MAPBOX_TOKEN;
        if (!token) {
          const { data, error: fetchError } = await supabase.functions.invoke('get-mapbox-token');
          if (fetchError || !data?.token) throw new Error('Failed to load map configuration');
          token = data.token;
        }
        const defaultCenter: [number, number] = [-3.7038, 40.4168]; // Madrid
        map.current = new mapboxgl.Map({
          container: mapContainer.current,
          accessToken: token,
          style: 'mapbox://styles/mapbox/dark-v10',
          center: defaultCenter,
          zoom: 10,
          pitch: 0,
          projection: 'mercator',
          attributionControl: false,
          logoPosition: 'top-left',
        });

        map.current.addControl(
          new mapboxgl.NavigationControl({ showCompass: false, showZoom: true, visualizePitch: false }),
          'bottom-right'
        );

        map.current.on('load', () => {
          if (!map.current) return;
          const labelLayers = [
            { id: 'country-label', opacity: 0.6 },
            { id: 'state-label', opacity: 0.5 },
            { id: 'settlement-label', opacity: 0.7 },
          ];
          labelLayers.forEach(({ id, opacity }) => {
            if (map.current?.getLayer(id)) map.current.setPaintProperty(id, 'text-opacity', opacity);
          });

          // GeoJSON source with clustering (for cluster circles only)
          map.current!.addSource('venues', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
            cluster: true,
            clusterMaxZoom: 13,
            clusterRadius: 35, // tight radius — only cluster when truly overlapping
          });

          // Cluster circles — frosted glass style
          map.current!.addLayer({
            id: 'clusters',
            type: 'circle',
            source: 'venues',
            filter: ['has', 'point_count'],
            paint: {
              'circle-color': 'hsla(0, 0%, 15%, 0.75)',
              'circle-radius': ['step', ['get', 'point_count'], 22, 5, 26, 15, 32, 50, 40],
              'circle-opacity': 1,
              'circle-stroke-width': 2,
              'circle-stroke-color': 'hsla(0, 0%, 100%, 0.25)',
              'circle-blur': 0.05,
            },
          });

          // Cluster count labels
          map.current!.addLayer({
            id: 'cluster-count',
            type: 'symbol',
            source: 'venues',
            filter: ['has', 'point_count'],
            layout: {
              'text-field': '{point_count_abbreviated}',
              'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
              'text-size': ['interpolate', ['linear'], ['zoom'], 3, 13, 10, 15],
            },
            paint: { 'text-color': '#ffffff' },
          });

          // Click cluster → zoom in
          map.current!.on('click', 'clusters', (e) => {
            const features = map.current!.queryRenderedFeatures(e.point, { layers: ['clusters'] });
            const clusterId = features[0]?.properties?.cluster_id;
            if (clusterId == null) return;
            (map.current!.getSource('venues') as mapboxgl.GeoJSONSource).getClusterExpansionZoom(clusterId, (err, zoom) => {
              if (err || !map.current) return;
              const coords = (features[0].geometry as GeoJSON.Point).coordinates as [number, number];
              map.current.flyTo({ center: coords, zoom: zoom!, duration: 800 });
            });
          });

          // Cursor styles for clusters
          map.current!.on('mouseenter', 'clusters', () => {
            if (map.current) map.current.getCanvas().style.cursor = 'pointer';
          });
          map.current!.on('mouseleave', 'clusters', () => {
            if (map.current) map.current.getCanvas().style.cursor = '';
          });

          // Emit bounds on move
          map.current!.on('moveend', () => {
            if (map.current && onMapMoveRef.current) {
              onMapMoveRef.current(map.current.getBounds());
            }
          });

          // Fire onMapDragStart on drag
          map.current!.on('dragstart', () => {
            onMapDragStartRef.current?.();
          });

          requestAnimationFrame(() => map.current?.resize());
          setTimeout(() => map.current?.resize(), 250);
          setTimeout(() => map.current?.resize(), 600);
          setMapReady(true);
        });

        window.addEventListener('resize', handleResize);
        window.addEventListener('orientationchange', handleResize);
      } catch (err) {
        console.error('Map initialization error:', err);
        setError('Unable to load map');
      }
    };
    initMap();

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
      userMarkerRef.current?.remove();
      venueMarkersRef.current.forEach(m => m.remove());
      map.current?.remove();
    };
  }, []);

  // User location marker
  useEffect(() => {
    if (!map.current || !mapReady || !userLocation) return;
    userMarkerRef.current?.remove();
    const currentMap = map.current;
    if (!currentMap.getContainer()) return;

    const el = document.createElement('div');
    const wrapper = document.createElement('div');
    wrapper.className = 'relative';
    const dot = document.createElement('div');
    dot.className = 'w-4 h-4 bg-blue-500 rounded-full border-2 border-white shadow-lg';
    const ping = document.createElement('div');
    ping.className = 'absolute inset-0 w-4 h-4 bg-blue-500 rounded-full animate-ping opacity-75';
    wrapper.append(dot, ping);
    el.appendChild(wrapper);
    userMarkerRef.current = new mapboxgl.Marker(el)
      .setLngLat([userLocation.lng, userLocation.lat])
      .addTo(currentMap);

    const zoomTimeout = setTimeout(() => {
      if (!map.current) return;
      const venuesWithCoords = allVenues.filter(v => v.latitude && v.longitude);
      if (venuesWithCoords.length > 0) {
        const bounds = new mapboxgl.LngLatBounds();
        bounds.extend([userLocation.lng, userLocation.lat]);
        venuesWithCoords
          .filter(v => calculateDistance(userLocation.lat, userLocation.lng, v.latitude!, v.longitude!) <= 200)
          .forEach(venue => bounds.extend([venue.longitude!, venue.latitude!]));
        currentMap.fitBounds(bounds, { padding: 80, maxZoom: 11, duration: 1500 });
      } else {
        currentMap.flyTo({ center: [userLocation.lng, userLocation.lat], zoom: 10, duration: 1500 });
      }
    }, 100);
    return () => clearTimeout(zoomTimeout);
  }, [userLocation, mapReady, allVenues]);

  // Update GeoJSON source (for clusters) and HTML markers (for individual venues)
  useEffect(() => {
    if (!map.current || !mapReady) return;
    const currentMap = map.current;
    if (!currentMap.getContainer()) return;

    const venuesWithCoords = venues.filter(v => v.latitude && v.longitude);

    // Update GeoJSON for cluster layer
    const geojson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: venuesWithCoords.map(v => ({
        type: 'Feature' as const,
        properties: {
          id: v.id,
          name: v.name,
          city: v.city || '',
          hasEvent: v.todayEvent ? 'true' : 'false',
        },
        geometry: { type: 'Point' as const, coordinates: [v.longitude!, v.latitude!] },
      })),
    };

    const source = currentMap.getSource('venues') as mapboxgl.GeoJSONSource | undefined;
    if (source) {
      source.setData(geojson);
    }

    // Remove old individual markers
    venueMarkersRef.current.forEach(m => m.remove());
    venueMarkersRef.current = [];

    // Add individual logo markers for each venue
    venuesWithCoords.forEach(venue => {
      const el = createLogoMarkerEl(venue);
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onVenueClickRef.current(venue.id);
      });
      const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat([venue.longitude!, venue.latitude!])
        .addTo(currentMap);
      venueMarkersRef.current.push(marker);
    });

    // Fit bounds if no user location
    if (!userLocation && venuesWithCoords.length > 0) {
      const bounds = new mapboxgl.LngLatBounds();
      venuesWithCoords.forEach(venue => bounds.extend([venue.longitude!, venue.latitude!]));
      currentMap.fitBounds(bounds, { padding: 60, maxZoom: 6 });
    }

    // Emit initial bounds
    if (onMapMove) {
      setTimeout(() => {
        if (map.current) onMapMove(map.current.getBounds());
      }, 200);
    }
  }, [venues, mapReady, userLocation, onMapMove]);

  // Hide/show individual markers: only show when NOT part of a cluster
  useEffect(() => {
    if (!map.current || !mapReady) return;
    const currentMap = map.current;

    const updateMarkerVisibility = () => {
      // Query unclustered points currently rendered on screen
      const unclustered = currentMap.queryRenderedFeatures(undefined, {
        layers: ['clusters'],
      });
      // We don't have an unclustered-point layer, so instead query the source
      // to find which venue IDs are NOT clustered at this zoom.
      const source = currentMap.getSource('venues') as mapboxgl.GeoJSONSource | undefined;
      if (!source) return;

      // Get all rendered features from the source (both clustered and unclustered)
      // Unclustered features won't have 'point_count' property
      const allRendered = currentMap.querySourceFeatures('venues');
      const unclusteredIds = new Set<string>();
      allRendered.forEach(f => {
        if (!f.properties?.cluster && f.properties?.id) {
          unclusteredIds.add(f.properties.id);
        }
      });

      const venuesWithCoords = venues.filter(v => v.latitude && v.longitude);
      venueMarkersRef.current.forEach((marker, i) => {
        const venue = venuesWithCoords[i];
        if (!venue) return;
        const el = marker.getElement();
        // Show marker only if this venue is unclustered (individually rendered)
        el.style.display = unclusteredIds.has(venue.id) ? '' : 'none';
      });
    };

    currentMap.on('zoom', updateMarkerVisibility);
    currentMap.on('moveend', updateMarkerVisibility);
    // Run after a short delay to let tiles/source settle
    const timer = setTimeout(updateMarkerVisibility, 300);

    return () => {
      currentMap.off('zoom', updateMarkerVisibility);
      currentMap.off('moveend', updateMarkerVisibility);
      clearTimeout(timer);
    };
  }, [mapReady, venues]);

  if (error) {
    return (
      <div className="w-full h-full min-h-[400px] flex items-center justify-center bg-muted/20 rounded-lg">
        <p className="text-muted-foreground">{error}</p>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainer} className="w-full h-full rounded-lg yuno-map" />

      {/* Search bar — z-20 so the dropdown clears the z-10 filter chips in ClubMap */}
      <div className="absolute left-4 right-4 z-20 flex gap-2 items-start" style={{ top: 'max(1rem, env(safe-area-inset-top, 1rem))' }}>
        {onClose && (
          <button
            onClick={onClose}
            className="flex items-center justify-center shrink-0 rounded-full bg-card border border-border p-2.5 shadow-soft"
          >
            <X className="h-4 w-4 text-foreground" />
          </button>
        )}
        <VenueMapSearch onSearch={handleSearch} />
        <div className="flex gap-2 shrink-0">
          {userLocation ? (
            <Button
              size="icon"
              variant="outline"
              className="h-10 w-10 bg-white/90 dark:bg-white/90 backdrop-blur-md border-white/50 hover:bg-white"
              onClick={recenterOnUser}
              title={t('welcome.recenter') || 'Recenter'}
            >
              <LocateFixed className="w-4 h-4 text-gray-900" />
            </Button>
          ) : (
            <Button
              size="sm"
              className="gap-2 bg-white/90 dark:bg-white/90 backdrop-blur-md text-gray-900 hover:bg-white border-0 h-10 font-medium"
              onClick={onRequestLocation}
            >
              <Navigation className="w-4 h-4" />
              <span className="hidden sm:inline">{t('welcome.useLocation') || 'Use my location'}</span>
            </Button>
          )}
        </div>
      </div>

      <style>{`
        .yuno-map .mapboxgl-ctrl-logo,
        .yuno-map .mapboxgl-ctrl-attrib {
          display: none !important;
        }
        .yuno-map .mapboxgl-ctrl-bottom-right {
          bottom: 80px;
        }
      `}</style>
    </div>
  );
};

export default VenueMap;
