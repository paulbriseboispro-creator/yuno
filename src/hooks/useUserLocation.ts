import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  getManualCoords,
  getStoredCity,
  hasManualCity,
  hasRealLocation,
  setResolvedCity,
  type Coords,
} from '@/lib/userLocation';

/**
 * Shared visitor-location resolver for the public discovery surfaces (Explore home, ClubMap,
 * /clubs, /djs). Reads the manual pick first, then asks the device for GPS once and reverse
 * geocodes to a city (Mapbox, falling back to the geocode-address edge function, then the
 * user's profile city). Mirrors Explore's geolocation effect so every surface scopes to the
 * SAME place. `hasLocation` is false until we actually know where the visitor is, so callers
 * can avoid filtering (and going empty) for visitors whose position we never learned.
 */
export function useUserLocation() {
  const [userLocation, setUserLocation] = useState<Coords | null>(() => getManualCoords());
  const [city, setCity] = useState<string>(() => getStoredCity());
  const [hasLocation, setHasLocation] = useState<boolean>(() => hasRealLocation());

  useEffect(() => {
    // Respect a manual city pick — never override it with GPS.
    if (hasManualCity()) return;

    navigator.geolocation?.getCurrentPosition(
      async (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserLocation(coords);
        setHasLocation(true);
        if (localStorage.getItem('yuno_city')) return;
        try {
          let cityName = '';
          const token = import.meta.env.VITE_MAPBOX_TOKEN;
          if (token) {
            const res = await fetch(
              `https://api.mapbox.com/geocoding/v5/mapbox.places/${coords.lng},${coords.lat}.json?access_token=${token}&types=place&limit=1`,
            );
            const data = await res.json();
            const feature = data.features?.[0];
            if (feature) cityName = feature.text || feature.place_name || '';
          } else {
            const { data } = await supabase.functions.invoke('geocode-address', {
              body: { lat: coords.lat, lng: coords.lng, reverse: true },
            });
            cityName = data?.city || data?.name || '';
          }
          if (cityName) {
            setCity(cityName);
            setResolvedCity(cityName);
          }
        } catch {
          /* reverse geocode failed — keep coords, no city refinement */
        }
      },
      async () => {
        // GPS denied / unavailable — fall back to the logged-in user's profile city.
        if (localStorage.getItem('yuno_city')) return;
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) return;
          const { data: profile } = await supabase
            .from('profiles')
            .select('city')
            .eq('id', user.id)
            .single();
          if (profile?.city) {
            setCity(profile.city);
            setResolvedCity(profile.city);
            setHasLocation(true);
          }
        } catch {
          /* no profile city — stay location-unaware */
        }
      },
    );
  }, []);

  return { userLocation, city, hasLocation };
}
