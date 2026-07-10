import { isNative } from '@/lib/native';

/**
 * Géolocalisation unifiée — plugin natif @capacitor/geolocation dans l'app
 * (le prompt de permission est le dialogue système APPLE de l'app, pas le
 * double dialogue WKWebView hérité de la PWA), navigator.geolocation sur web.
 *
 * API compatible avec l'usage callback historique du code : les call sites
 * gardent leur logique succès/échec, seule la source change.
 */

export interface SimpleCoords {
  latitude: number;
  longitude: number;
}

export interface GetPositionOptions {
  enableHighAccuracy?: boolean;
  timeout?: number;
  maximumAge?: number;
}

export function getCurrentPosition(
  onSuccess: (pos: { coords: SimpleCoords }) => void,
  onError?: (err: unknown) => void,
  options?: GetPositionOptions,
): void {
  if (isNative()) {
    import('@capacitor/geolocation')
      .then(({ Geolocation }) =>
        Geolocation.getCurrentPosition({
          enableHighAccuracy: options?.enableHighAccuracy ?? false,
          timeout: options?.timeout ?? 10000,
          maximumAge: options?.maximumAge ?? 300000,
        }),
      )
      .then((pos) => onSuccess({ coords: { latitude: pos.coords.latitude, longitude: pos.coords.longitude } }))
      .catch((err) => onError?.(err));
    return;
  }
  if (!navigator.geolocation) {
    onError?.(new Error('Geolocation unavailable'));
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => onSuccess({ coords: { latitude: pos.coords.latitude, longitude: pos.coords.longitude } }),
    (err) => onError?.(err),
    options,
  );
}
