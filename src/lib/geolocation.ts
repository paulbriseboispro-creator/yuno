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

/**
 * Variante SANS prompt pour les initialisations automatiques (Explore, listes).
 *
 * En natif, le dialogue système Apple ne doit partir que sur un geste explicite
 * (ouvrir la carte, bouton « Autour de moi ») — jamais au premier lancement, où
 * il se superposerait à la demande de notifications (double dialogue = rejet
 * App Store, et contredit la fiche review « location when the map opens »).
 * Ici : permission déjà accordée → position ; sinon → onError, sans dialogue.
 *
 * Sur web, comportement inchangé (le prompt navigateur n'est pas bloquant et
 * la détection de ville au premier chargement est le comportement historique).
 */
export function getCurrentPositionIfGranted(
  onSuccess: (pos: { coords: SimpleCoords }) => void,
  onError?: (err: unknown) => void,
  options?: GetPositionOptions,
): void {
  if (isNative()) {
    import('@capacitor/geolocation')
      .then(async ({ Geolocation }) => {
        const perm = await Geolocation.checkPermissions();
        if (perm.location !== 'granted') throw new Error('location-not-granted');
        return Geolocation.getCurrentPosition({
          enableHighAccuracy: options?.enableHighAccuracy ?? false,
          timeout: options?.timeout ?? 10000,
          maximumAge: options?.maximumAge ?? 300000,
        });
      })
      .then((pos) => onSuccess({ coords: { latitude: pos.coords.latitude, longitude: pos.coords.longitude } }))
      .catch((err) => onError?.(err));
    return;
  }
  getCurrentPosition(onSuccess, onError, options);
}
