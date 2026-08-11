import { isNative } from '@/lib/native';

/**
 * Cause actionnable d'un échec caméra, dérivée d'une DOMException getUserMedia
 * (levée par le scanner QR ou une sonde directe).
 *
 * - 'granted'     : la caméra est accessible.
 * - 'denied'      : l'utilisateur a refusé (ou a désactivé) l'accès caméra.
 *                   iOS n'affiche le pop-up natif qu'UNE fois : un refus ne se
 *                   re-demande jamais in-app, le seul recours est Réglages ›
 *                   Yuno Pro › Caméra (bouton « Ouvrir les Réglages »).
 * - 'unavailable' : pas de caméra, ou occupée par une autre app → réessayer /
 *                   basculer sur la saisie manuelle.
 * - 'error'       : autre échec inconnu.
 */
export type CameraPermissionState = 'granted' | 'denied' | 'unavailable' | 'error';

/**
 * Classe une erreur getUserMedia. On teste d'abord le `name` normalisé de la
 * DOMException (stable entre navigateurs et WKWebView) ; le `message` n'est
 * qu'un filet de secours car son libellé varie et n'est jamais garanti.
 */
export function classifyCameraError(err: unknown): Exclude<CameraPermissionState, 'granted'> {
  const name = (err as { name?: string } | null)?.name;
  const message = String((err as { message?: unknown } | null)?.message ?? '').toLowerCase();

  if (
    name === 'NotAllowedError' ||
    name === 'SecurityError' ||
    message.includes('permission') ||
    message.includes('denied') ||
    message.includes('not allowed')
  ) {
    return 'denied';
  }

  if (
    name === 'NotFoundError' ||
    name === 'NotReadableError' ||
    name === 'OverconstrainedError' ||
    name === 'TrackStartError' ||
    message.includes('no camera') ||
    message.includes('in use')
  ) {
    return 'unavailable';
  }

  return 'error';
}

/**
 * Ouvre les Réglages de l'app. En iOS, `app-settings:` amène droit sur le volet
 * de l'app (là où vit le toggle Caméra). Capacitor route toute navigation vers
 * un schéma non-http via UIApplication.open — aucun plugin natif requis.
 * Sur le web, no-op : l'appelant montre plutôt l'instruction navigateur.
 */
export function openAppSettings(): void {
  if (!isNative()) return;
  try {
    window.location.href = 'app-settings:';
  } catch {
    // Best-effort : si la navigation est avalée, l'instruction texte reste
    // affichée en secours et la saisie manuelle garde la porte ouverte.
  }
}
