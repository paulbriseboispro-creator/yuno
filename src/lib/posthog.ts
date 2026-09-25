/**
 * PostHog — analytics produit (web + apps natives Yuno / Yuno Pro).
 *
 * Ce que ce module garantit :
 *  - Rien ne part sans clé : `VITE_POSTHOG_KEY` absente ⇒ no-op complet (aucun
 *    script chargé, aucun appel réseau). La clé projet `phc_…` est publique.
 *  - Consentement : même porte que la mesure d'audience maison
 *    (`hasAnalyticsConsent`, src/lib/consent.ts). Sur le web, PostHog n'est
 *    chargé qu'APRÈS l'acceptation « mesure d'audience » du bandeau cookies ;
 *    un refus ultérieur coupe la capture, efface l'identité et purge le
 *    stockage `ph_*`. En natif le consentement analytics est acquis d'office
 *    (étiquette de confidentialité App Store), comme pour le reste.
 *  - Chargement paresseux : `posthog-js` est un import dynamique, il ne pèse
 *    pas sur le chunk d'entrée ni sur le premier écran.
 *  - Replay de session : jamais sur une surface pro/staff (Console, app Pro,
 *    scans de porte, super admin) — les `$snapshot` y sont jetés dans
 *    `before_send`. Ailleurs, tous les champs de saisie sont masqués. Le replay
 *    ne tourne que s'il est activé dans les réglages du projet PostHog.
 *  - Session d'accès assisté (un admin Yuno dans le compte d'un pro) : aucun
 *    événement ne part — il serait attribué au pro.
 *  - Identité : `identify(user.id)` seulement, jamais d'email ni de téléphone.
 *
 * Hôte : `VITE_POSTHOG_HOST`, défaut l'instance EU (RGPD).
 */
import type { PostHog } from 'posthog-js';
import { CONSENT_CHANGE_EVENT, hasAnalyticsConsent } from '@/lib/consent';
import { isNative, isProApp, isProPath } from '@/lib/native';
import { isSupportSessionActive } from '@/lib/supportSession';

const KEY = (import.meta.env.VITE_POSTHOG_KEY as string | undefined)?.trim() || '';
const HOST = (import.meta.env.VITE_POSTHOG_HOST as string | undefined)?.trim() || 'https://eu.i.posthog.com';

let client: PostHog | null = null;
let loading: Promise<PostHog | null> | null = null;
let listening = false;
// Dernier utilisateur voulu : rejoué si l'identité arrive avant le chargement.
let wantedUserId: string | null = null;

export function posthogEnabled(): boolean {
  return KEY.length > 0;
}

function onProSurface(): boolean {
  if (isProApp()) return true;
  try {
    return isProPath(window.location.pathname);
  } catch {
    return false;
  }
}

function purgePosthogStorage() {
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('ph_') || k.startsWith('__ph_')) localStorage.removeItem(k);
    }
  } catch {
    // no-op
  }
  try {
    const host = window.location.hostname.split('.');
    const parent = host.length >= 2 ? `.${host.slice(-2).join('.')}` : null;
    for (const c of document.cookie.split('; ')) {
      const name = c.split('=')[0];
      if (!name.startsWith('ph_') && !name.startsWith('__ph_')) continue;
      const expired = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
      document.cookie = expired;
      // PostHog pose son cookie sur le domaine parent (cross_subdomain_cookie).
      if (parent) document.cookie = `${expired}; domain=${parent}`;
    }
  } catch {
    // no-op
  }
}

async function load(): Promise<PostHog | null> {
  if (client) return client;
  if (loading) return loading;
  loading = import('posthog-js')
    .then(({ default: posthog }) => {
      posthog.init(KEY, {
        api_host: HOST,
        person_profiles: 'identified_only',
        capture_pageview: 'history_change',
        capture_pageleave: true,
        persistence: 'localStorage+cookie',
        session_recording: { maskAllInputs: true },
        before_send: (event) => {
          if (!event) return null;
          if (isSupportSessionActive()) return null;
          if (event.event === '$snapshot' && onProSurface()) return null;
          return event;
        },
      });
      posthog.register({
        platform: isNative() ? 'ios' : 'web',
        app: isProApp() ? 'pro' : 'client',
      });
      client = posthog;
      if (wantedUserId) posthog.identify(wantedUserId);
      return posthog;
    })
    .catch(() => {
      loading = null;
      return null;
    });
  return loading;
}

function applyConsent() {
  if (hasAnalyticsConsent()) {
    void load().then((ph) => {
      if (!ph?.has_opted_out_capturing()) return;
      ph.set_config({ disable_persistence: false });
      ph.opt_in_capturing();
    });
    return;
  }
  if (client) {
    client.opt_out_capturing();
    client.reset();
    // Sans ça, PostHog réécrit son cookie juste après la purge.
    client.set_config({ disable_persistence: true });
  }
  purgePosthogStorage();
}

/** À appeler une fois au démarrage. Charge PostHog si clé + consentement. */
export function initPosthog() {
  if (!posthogEnabled() || typeof window === 'undefined') return;
  if (!listening) {
    listening = true;
    window.addEventListener(CONSENT_CHANGE_EVENT, applyConsent);
  }
  if (hasAnalyticsConsent()) void load();
}

/** Relie les événements au compte connecté (id Supabase seul) ; `null` = déconnexion. */
export function identifyPosthogUser(userId: string | null) {
  if (!posthogEnabled()) return;
  const previous = wantedUserId;
  wantedUserId = userId;
  if (!client) return;
  if (userId) {
    if (userId !== client.get_distinct_id()) client.identify(userId);
  } else if (previous) {
    client.reset();
  }
}

/** Événement métier. Silencieux tant que PostHog n'est pas chargé (pas de consentement). */
export function capturePosthog(event: string, properties?: Record<string, unknown>) {
  client?.capture(event, properties);
}
