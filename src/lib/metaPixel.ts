/**
 * Pixel Meta (Facebook / Instagram) côté navigateur — chargeur unique.
 * Design : docs/designs/META_ADS_INTEGRATION_PLAN.md (2026-09-14).
 *
 * Ce que ce module garantit :
 *  - Le script `connect.facebook.net` n'est chargé qu'APRÈS le consentement
 *    « publicité » du bandeau cookies (CNIL : aucun appel avant l'acte
 *    positif). Un refus ultérieur révoque (`fbq('consent','revoke')`) et purge
 *    les cookies `_fbp` / `_fbc`.
 *  - Jamais dans l'app native, jamais dans l'app Pro, jamais sur une surface
 *    pro/staff : seules les pages publiques et le tunnel d'achat portent un pixel.
 *  - Plusieurs pixels peuvent coexister sur une page (club + organisateur +
 *    Yuno) : chaque événement est envoyé avec `trackSingle` au bon pixel.
 *  - Chaque événement d'achat porte un `eventID` déterministe (`ticket:<id>`,
 *    `table:<id>`, `order:<id>`, `gl:<id>`) identique à celui envoyé côté
 *    serveur par la Conversions API : Meta dédoublonne, un seul achat compte.
 *
 * Le contexte transmis au checkout (`getMetaCheckoutContext`) porte le
 * consentement et les identifiants `_fbp` / `_fbc` : c'est ce qui permet au
 * serveur d'envoyer l'achat à Meta avec une bonne correspondance, ou de ne
 * rien envoyer du tout.
 */
import { CONSENT_CHANGE_EVENT, CONSENT_VERSION, hasMarketingConsent } from '@/lib/consent';
import { isNative, isProApp, isProPath } from '@/lib/native';

const SCRIPT_URL = 'https://connect.facebook.net/en_US/fbevents.js';
const FBCLID_KEY = 'yuno_fbclid';
const FBCLID_TTL_MS = 7 * 24 * 3600 * 1000;

type Fbq = ((...args: unknown[]) => void) & { queue?: unknown[]; loaded?: boolean; version?: string; callMethod?: (...a: unknown[]) => void; push?: unknown };

declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
  }
}

const initialized = new Set<string>();
let scriptRequested = false;
let listening = false;
// fbclid vu dans l'URL avant le consentement : gardé en mémoire seulement, et
// persisté au moment où la publicité est acceptée.
let pendingFbclid: { id: string; ts: number } | null = null;

export function metaPixelAllowedHere(): boolean {
  if (typeof window === 'undefined') return false;
  if (isNative() || isProApp()) return false;
  if (isProPath(window.location.pathname)) return false;
  return true;
}

function readCookie(name: string): string | null {
  try {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[.$?*|{}()[\]\\/+^]/g, '\\$&') + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

function expireCookie(name: string) {
  const expired = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  try {
    document.cookie = expired;
    const host = window.location.hostname;
    const parts = host.split('.');
    if (parts.length >= 2) document.cookie = `${expired}; domain=.${parts.slice(-2).join('.')}`;
  } catch {
    // no-op
  }
}

/** Mémorise le `fbclid` de l'URL (identifiant de clic posé par Meta sur toute pub). */
export function captureFbclidFromUrl() {
  if (!metaPixelAllowedHere()) return;
  try {
    const id = new URLSearchParams(window.location.search).get('fbclid');
    if (!id || id.length > 400) return;
    pendingFbclid = { id, ts: Date.now() };
    if (hasMarketingConsent()) persistPendingFbclid();
  } catch {
    // no-op
  }
}

function persistPendingFbclid() {
  if (!pendingFbclid) return;
  try {
    localStorage.setItem(FBCLID_KEY, JSON.stringify(pendingFbclid));
  } catch {
    // no-op
  }
}

function storedFbclid(): { id: string; ts: number } | null {
  try {
    const raw = localStorage.getItem(FBCLID_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { id: string; ts: number };
    if (!v?.id || !v?.ts || Date.now() - v.ts > FBCLID_TTL_MS) return null;
    return v;
  } catch {
    return null;
  }
}

export function getFbp(): string | null {
  const v = readCookie('_fbp');
  return v && /^fb\.[0-2]\.\d+\.\d+$/.test(v) ? v : null;
}

/** `_fbc` du pixel, sinon reconstruit depuis le fbclid (format documenté par Meta). */
export function getFbc(): string | null {
  const v = readCookie('_fbc');
  if (v && /^fb\.[0-2]\.\d+\..+$/.test(v)) return v;
  const stored = storedFbclid() ?? (hasMarketingConsent() ? pendingFbclid : null);
  return stored ? `fb.1.${stored.ts}.${stored.id}` : null;
}

export interface MetaCheckoutContext {
  consent: boolean;
  consentVersion: number;
  src: 'web' | 'native';
  fbp: string | null;
  fbc: string | null;
  url: string;
}

/** Contexte à joindre à tout appel de checkout / inscription guest list. */
export function getMetaCheckoutContext(): MetaCheckoutContext {
  const native = isNative();
  const consent = !native && hasMarketingConsent();
  return {
    consent,
    consentVersion: CONSENT_VERSION,
    src: native ? 'native' : 'web',
    fbp: consent ? getFbp() : null,
    fbc: consent ? getFbc() : null,
    url: typeof window !== 'undefined' ? window.location.href.split('#')[0].slice(0, 480) : '',
  };
}

function ensureStub(): Fbq {
  if (window.fbq) return window.fbq;
  // Stub officiel Meta, écrit lisiblement : les appels faits avant le
  // chargement du script sont mis en file dans `queue`.
  const fbq: Fbq = function (...args: unknown[]) {
    if (fbq.callMethod) fbq.callMethod(...args);
    else fbq.queue!.push(args);
  } as Fbq;
  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = '2.0';
  fbq.queue = [];
  window.fbq = fbq;
  window._fbq = fbq;
  return fbq;
}

function loadScript() {
  if (scriptRequested) return;
  scriptRequested = true;
  const s = document.createElement('script');
  s.async = true;
  s.src = SCRIPT_URL;
  document.head.appendChild(s);
}

function listenConsent() {
  if (listening) return;
  listening = true;
  window.addEventListener(CONSENT_CHANGE_EVENT, () => {
    if (hasMarketingConsent()) {
      persistPendingFbclid();
      if (window.fbq && initialized.size > 0) window.fbq('consent', 'grant');
    } else {
      if (window.fbq) window.fbq('consent', 'revoke');
      expireCookie('_fbp');
      expireCookie('_fbc');
    }
  });
}

/**
 * Initialise les pixels demandés (idempotent). Ne fait RIEN sans consentement
 * publicité ; l'appelant doit rappeler après un changement de consentement
 * (useMetaPixel s'en charge).
 */
export function ensureMetaPixels(pixelIds: string[]): boolean {
  if (!metaPixelAllowedHere() || !hasMarketingConsent()) return false;
  const ids = pixelIds.filter((id) => /^[0-9]{6,32}$/.test(id));
  if (ids.length === 0) return false;
  listenConsent();
  const fbq = ensureStub();
  loadScript();
  let added = false;
  for (const id of ids) {
    if (initialized.has(id)) continue;
    if (initialized.size === 0) fbq('consent', 'grant');
    fbq('init', id);
    fbq('trackSingle', id, 'PageView');
    initialized.add(id);
    added = true;
  }
  return added;
}

export type MetaStandardEvent = 'ViewContent' | 'InitiateCheckout' | 'AddPaymentInfo' | 'Purchase' | 'Lead' | 'CompleteRegistration';

/** Envoie un événement aux pixels donnés (seulement ceux initialisés). */
export function trackMetaEvent(
  pixelIds: string[],
  event: MetaStandardEvent,
  params: Record<string, unknown> = {},
  eventID?: string,
): void {
  if (!metaPixelAllowedHere() || !hasMarketingConsent() || !window.fbq) return;
  for (const id of pixelIds) {
    if (!initialized.has(id)) continue;
    try {
      if (eventID) window.fbq('trackSingle', id, event, params, { eventID });
      else window.fbq('trackSingle', id, event, params);
    } catch {
      // jamais bloquant
    }
  }
}

export function initializedMetaPixels(): string[] {
  return [...initialized];
}
