import { useEffect, useState } from 'react';
import { isNative } from '@/lib/native';

/**
 * Consentement cookies / traceurs (ePrivacy art. 5(3) / CNIL).
 *
 * ⚠️ WEB UNIQUEMENT. Les « cookies » sont une notion de site web. Dans l'app
 * native (Capacitor iOS), il n'y a pas de bannière cookies : la mesure d'audience
 * first-party est déclarée par l'étiquette de confidentialité App Store, et les
 * permissions sensibles (notifications, localisation) passent par les dialogues
 * système d'Apple, pas par un consentement web. Donc en natif on considère le
 * consentement comme ACQUIS d'office (aucune bannière, aucun blocage analytics).
 *
 * Deux catégories seulement :
 *  - `necessary` : toujours actif, jamais un choix. Couvre ce qui est
 *    strictement nécessaire au service EXPLICITEMENT demandé par l'utilisateur —
 *    session d'auth, sécurité, panier, et l'ATTRIBUTION d'une vente au promoteur
 *    ou à l'affilié dont l'utilisateur a suivi le lien pour acheter (codes
 *    `?ref=` / `?via=`, courte durée). Cette attribution alimente les
 *    commissions : elle n'est PAS gatée ici et son code n'est jamais touché.
 *  - `analytics` : mesure d'audience non nécessaire → OPT-IN. Couvre l'identifiant
 *    visiteur persistant (`yuno_visitor_id`, ~1 an), les pings « live » et la
 *    mesure de durée/scroll (useVisitorTracking, useAffiliateVisitorTracking).
 *    Rien ne se déclenche tant que l'utilisateur n'a pas accepté.
 *
 * Le choix vit dans localStorage. Un bump de `CONSENT_VERSION` re-demande le
 * consentement (nouvelle politique).
 */

export type ConsentCategory = 'analytics';
export type ConsentPrefs = { analytics: boolean };

const STORAGE_KEY = 'yuno_cookie_consent';
const CONSENT_VERSION = 1;

export const CONSENT_CHANGE_EVENT = 'yuno-consent-change';
export const CONSENT_OPEN_EVENT = 'yuno-consent-open';

// Clés localStorage écrites par les traceurs analytics — purgées au refus, pour
// qu'un refus efface aussi les identifiants déjà posés lors d'une visite passée.
const ANALYTICS_STORAGE_KEYS = [
  'yuno_visitor_id',
  'yuno_visit_number',
  'yuno_browser_id',
  'yuno_aff_visitor_id',
  'yuno_aff_visit_number',
];

type StoredConsent = { analytics: boolean; ts: number; v: number };

function readStored(): StoredConsent | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredConsent;
    // Version obsolète = considérer le choix comme non fait (re-demande).
    if (parsed.v !== CONSENT_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** L'utilisateur a-t-il déjà fait un choix (accepté OU refusé) ? */
export function hasDecidedConsent(): boolean {
  // Natif : rien à demander (cf. en-tête) → traité comme déjà décidé.
  if (isNative()) return true;
  return readStored() !== null;
}

/** Consentement analytics accordé ? (défaut : non tant qu'aucun choix.) */
export function hasAnalyticsConsent(): boolean {
  // Natif : mesure d'audience déclarée par l'App Store → acquise d'office.
  if (isNative()) return true;
  return readStored()?.analytics === true;
}

function purgeAnalyticsStorage() {
  for (const k of ANALYTICS_STORAGE_KEYS) {
    try {
      localStorage.removeItem(k);
    } catch {
      // Storage indispo : sans effet, jamais bloquant.
    }
  }
}

/** Enregistre le choix et notifie les abonnés (hooks de tracking, bannière). */
export function setConsent(prefs: ConsentPrefs) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ analytics: prefs.analytics, ts: Date.now(), v: CONSENT_VERSION } satisfies StoredConsent),
    );
  } catch {
    // Storage indispo (mode privé strict) : le choix ne persiste pas, la
    // bannière réapparaîtra — dégradation acceptable, jamais de tracking sans OK.
  }
  if (!prefs.analytics) purgeAnalyticsStorage();
  try {
    window.dispatchEvent(new Event(CONSENT_CHANGE_EVENT));
  } catch {
    // no-op (SSR / environnement sans window)
  }
}

/** Rouvre la bannière pour modifier les préférences (lien « Gérer les cookies »). */
export function openConsentSettings() {
  try {
    window.dispatchEvent(new Event(CONSENT_OPEN_EVENT));
  } catch {
    // no-op
  }
}

/**
 * Hook React : état de consentement réactif (se met à jour quand l'utilisateur
 * choisit, y compris depuis un autre onglet via l'événement `storage`).
 */
export function useConsent(): { decided: boolean; analytics: boolean } {
  const [stored, setStored] = useState<StoredConsent | null>(readStored);

  useEffect(() => {
    const refresh = () => setStored(readStored());
    window.addEventListener(CONSENT_CHANGE_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(CONSENT_CHANGE_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  // Natif : consentement acquis d'office (cf. en-tête) — les traceurs analytics
  // gatés sur `analytics` tournent normalement, sans bannière.
  if (isNative()) return { decided: true, analytics: true };
  return { decided: stored !== null, analytics: stored?.analytics === true };
}
