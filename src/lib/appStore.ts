// Conversion web → app iOS — source de vérité UNIQUE.
//
// Tout ce qui pousse l'app iOS (badges App Store de la landing, carte
// post-achat, smart banner Safari) lit ce module. La barre fixe en bas des
// pages publiques du web a été retirée le 2026-10-18 (décision de Paul) : ne
// pas la remettre. L'app client (`eu.yunoapp.app`, App Store Connect id
// 6799487527) est en ligne ; APP_STORE_READY reste l'interrupteur unique de
// toutes ces surfaces (à false, elles rendent null).
import { isNative } from '@/lib/native';

export const APP_STORE_ID = '6799487527';
export const APP_STORE_URL = `https://apps.apple.com/app/id${APP_STORE_ID}`;

/** ⬅️ Passer à true dès que l'app client est approuvée par Apple. */
export const APP_STORE_READY = true;

/** iPhone / iPad (iPadOS 13+ se déclare MacIntel mais garde le multi-touch). */
export function isIOSDevice(): boolean {
  try {
    if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) return true;
    return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  } catch {
    return false;
  }
}

/** PWA installée (écran d'accueil) — on ne lui pousse pas l'App Store par-dessus. */
export function isStandaloneDisplay(): boolean {
  try {
    return (
      window.matchMedia?.('(display-mode: standalone)').matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true
    );
  } catch {
    return false;
  }
}

/**
 * Peut-on promouvoir l'app iOS ici ? Web mobile iOS uniquement :
 * jamais en natif (on y est déjà), jamais en PWA standalone, jamais
 * tant que l'app n'est pas réellement téléchargeable.
 */
export function canPromoteApp(): boolean {
  return APP_STORE_READY && !isNative() && !isStandaloneDisplay() && isIOSDevice();
}
