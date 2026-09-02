// Conversion web → app iOS — source de vérité UNIQUE.
//
// Tout ce qui pousse l'app iOS (barre d'install, badges App Store de la
// landing, carte post-achat, smart banner Safari) lit ce module. L'app
// client (`eu.yunoapp.app`, App Store Connect id 6799487527) est soumise
// mais PAS ENCORE approuvée : tant que APP_STORE_READY est false, toutes
// les surfaces de conversion rendent null et le lien App Store n'apparaît
// nulle part (il répondrait 404). Le jour de l'approbation Apple, passer
// APP_STORE_READY à true — c'est le seul changement de code nécessaire.
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

// ── Barre d'install : dismiss persistant ────────────────────────────────────
const DISMISS_KEY = 'yuno_install_bar_dismissed_at';
const DISMISS_TTL_MS = 14 * 24 * 3600 * 1000; // re-proposer après 14 jours

export function isInstallBarDismissed(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return at > 0 && Date.now() - at < DISMISS_TTL_MS;
  } catch {
    return false;
  }
}

export function dismissInstallBar(): void {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    /* stockage privé plein / bloqué : la barre reviendra, tant pis */
  }
}
