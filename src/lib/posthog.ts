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
import { currentSurface, purchaseSurface } from '@/lib/posthogSurface';

const KEY = (import.meta.env.VITE_POSTHOG_KEY as string | undefined)?.trim() || '';
const HOST = (import.meta.env.VITE_POSTHOG_HOST as string | undefined)?.trim() || 'https://eu.i.posthog.com';

let client: PostHog | null = null;
let loading: Promise<PostHog | null> | null = null;
let listening = false;
// Dernier utilisateur voulu : rejoué si l'identité arrive avant le chargement.
let wantedUser: PosthogUser | null = null;
// Démo : `false` tant qu'aucun compte @womber.fr n'est identifié. Posé sur
// CHAQUE événement (before_send) : un insight qui filtre `is_demo = false`
// ne doit jamais perdre les visiteurs anonymes faute de propriété.
let demo = false;
// Version de l'app native (build App Store + bundle OTA), lue une fois.
let nativeVersion: Record<string, string> = {};
// Source de la prochaine ouverture d'app (tap de push, lien) — posée par
// NativeBridge, consommée par `app_opened`.
let openSource: 'notification' | 'link' | null = null;
// Événements tirés (avec consentement) avant la fin du chargement du SDK.
const queue: Array<[YunoEvent, Record<string, unknown> | undefined]> = [];
const MAX_QUEUE = 50;

/**
 * Plan de marquage Yuno — la liste COMPLÈTE des événements métier. Un nouvel
 * événement s'ajoute ici d'abord (nom en snake_case, au passé), jamais en
 * chaîne libre dans une page : c'est ce qui garde les funnels PostHog lisibles.
 * Propriétés communes : `event_id`, `venue_id`, `pillar`
 * (`tickets` | `tables` | `guest_list` | `drinks`), `value` (euros), `currency`.
 */
export type YunoEvent =
  // ── Client : découverte ──────────────────────────────────────────────────
  | 'explore_viewed' //            { city }
  | 'city_selected' //             { city, source: 'picker' | 'geoloc' | 'url' }
  | 'search_performed' //          { query (≤ 40 car., sans email/tél.), results_count, has_results, city }
  | 'search_result_clicked' //     { result_type, position, query_length }
  | 'explore_filter_applied' //    { filter, value }
  | 'event_viewed' //              { + géo }
  | 'venue_viewed' //              { + géo }
  | 'organizer_viewed' //          { + géo }
  | 'follow_toggled' //            { target_type: 'venue' | 'organizer' | 'dj', following }
  | 'favorite_toggled' //          { favorited, + géo }
  | 'event_shared' //              { channel, + géo }
  | 'waitlist_joined' //           { pillar, + géo }
  // ── Client : achat ───────────────────────────────────────────────────────
  | 'checkout_started' //          { pillar, + géo }
  | 'checkout_step_completed' //   { pillar, step: 'quantity' | 'tier' | 'details' | 'payment' }
  | 'ticket_tier_selected' //      { tier_id, price, quantity }
  | 'promo_code_applied' //        { pillar, result: 'applied' | 'rejected', reason }
  | 'promoter_attributed' //       { pillar, source: 'link' | 'code' }
  | 'table_zone_viewed' //         { zone_id }
  | 'table_pack_selected' //       { pack_id, payment_mode, price }
  | 'drinks_menu_viewed' //        { venue_id }
  | 'drink_added_to_cart' //       { venue_id, price }
  | 'checkout_failed' //           { pillar, reason (code court, jamais le message brut) }
  | 'purchase_completed' //        { pillar, payment, value, currency } — navigateur ; l'ARGENT = `order_paid_server`
  | 'guest_list_joined' //         { pillar: 'guest_list', via_invite }
  | 'wallet_pass_clicked' //       { pillar }
  // ── Client : app ─────────────────────────────────────────────────────────
  | 'app_opened' //                { cold_start, source: 'icon' | 'notification' | 'link' }
  | 'push_opened' //               { kind: 'campaign' | 'auto', campaign_id?, notification_key? }
  | 'install_banner_viewed' //     { placement }
  | 'install_banner_clicked' //    { placement }
  | 'app_store_clicked' //         { placement }
  | 'pwa_installed'
  | 'user_signed_up'
  | 'user_signed_in'
  // ── Pro ──────────────────────────────────────────────────────────────────
  | 'pro_event_created' //         { scope, source }
  | 'pro_event_published' //       { scope, pillars[] }
  | 'pillar_toggled' //            { pillar, enabled, scope }
  | 'stripe_connect_started' //    { scope }
  | 'stripe_connect_completed' //  { scope }
  | 'venue_went_live'
  | 'promo_code_created' //        { scope, kind: 'percent' | 'amount', pillars[] }
  | 'contacts_imported' //         { scope, rows, channels[] }
  | 'email_automation_toggled' //  { scope, kind, enabled }
  | 'email_campaign_sent'
  | 'push_campaign_sent'
  | 'sms_campaign_sent' //         { scope, recipients }
  | 'team_member_invited' //       { scope, role }
  | 'live_view_opened' //          { scope }
  | 'event_report_opened' //       { scope }
  | 'ai_assistant_used'; //        { assistant: 'owner' | 'agency' | 'help' | 'client' }

// Côté serveur (supabase/functions/_shared/posthog.ts), hors de ce type :
// `order_paid_server` — la vérité sur l'argent, capturée sous la transition
// atomique pending→paid. C'est lui qui fait foi dans le dashboard.

export type PosthogUser = { id: string; createdAt?: string | null; roles?: readonly string[]; email?: string | null };

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
        // Erreurs JS ($exception) : lues par surface et version d'app dans la
        // section « Santé » du dashboard.
        capture_exceptions: true,
        before_send: (event) => {
          if (!event) return null;
          if (isSupportSessionActive()) return null;
          if (event.event === '$snapshot' && onProSurface()) return null;
          // Surface recalculée à CHAQUE envoi : une session passe de
          // `web_app` à `console` en ouvrant /owner (src/lib/posthogSurface.ts).
          event.properties = {
            ...event.properties,
            surface: currentSurface(),
            is_demo: demo,
            ...nativeVersion,
          };
          return event;
        },
      });
      posthog.register({
        platform: isNative() ? 'ios' : 'web',
        app: isProApp() ? 'pro' : 'client',
      });
      if (isNative()) void readNativeVersion();
      client = posthog;
      if (wantedUser) applyIdentity(posthog, wantedUser);
      for (const [event, props] of queue.splice(0)) posthog.capture(event, props);
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

const SIGNUP_WINDOW_MS = 15 * 60 * 1000;

function applyIdentity(ph: PostHog, user: PosthogUser) {
  const roles = [...(user.roles ?? [])].sort();
  // Démo @womber.fr : jamais un chiffre (cf. CLAUDE.md « la démo n'est pas un
  // chiffre ») — marquée pour pouvoir l'exclure de chaque insight PostHog.
  const isDemo = /@womber\.fr$/i.test(user.email ?? '');
  demo = isDemo;
  ph.register({ is_demo: isDemo });
  if (user.id !== ph.get_distinct_id()) {
    ph.identify(user.id, { roles, is_pro: roles.some((r) => r !== 'client'), is_demo: isDemo });
  } else {
    ph.setPersonProperties({ roles, is_pro: roles.some((r) => r !== 'client'), is_demo: isDemo });
  }
  // Inscription : le compte a moins de 15 min. Une fois par compte et par onglet.
  const created = user.createdAt ? Date.parse(user.createdAt) : NaN;
  if (Number.isFinite(created) && Date.now() - created < SIGNUP_WINDOW_MS) {
    const flag = `yuno_ph_su_${user.id}`;
    try {
      if (sessionStorage.getItem(flag)) return;
      sessionStorage.setItem(flag, '1');
    } catch {
      // Storage indispo : au pire un doublon, jamais bloquant.
    }
    ph.capture('user_signed_up', { roles });
  }
}

/** Relie les événements au compte connecté (id Supabase seul) ; `null` = déconnexion. */
export function identifyPosthogUser(user: PosthogUser | null) {
  if (!posthogEnabled()) return;
  const previous = wantedUser;
  wantedUser = user;
  if (!client) return;
  if (user) applyIdentity(client, user);
  else if (previous) {
    demo = false;
    client.reset();
  }
}

/**
 * Événement métier du plan de marquage. Sans consentement : rien. Avec
 * consentement mais SDK encore en chargement : mis en file, envoyé au chargement.
 */
export function capturePosthog(event: YunoEvent, properties?: Record<string, unknown>) {
  if (!posthogEnabled()) return;
  if (client) {
    client.capture(event, properties);
    return;
  }
  if (!hasAnalyticsConsent() || queue.length >= MAX_QUEUE) return;
  queue.push([event, properties]);
  void load();
}

/**
 * Version de l'app native : `app_version` = version App Store (build),
 * `ota_bundle` = bundle web livré par Capgo. Posées sur chaque événement
 * (before_send) pour lire les erreurs et l'adoption version par version.
 */
async function readNativeVersion() {
  try {
    const { App } = await import('@capacitor/app');
    const info = await App.getInfo();
    nativeVersion = { ...nativeVersion, app_version: `${info.version} (${info.build})` };
  } catch {
    // Pas d'info native : on n'invente rien.
  }
  try {
    const { CapacitorUpdater } = await import('@capgo/capacitor-updater');
    const { bundle } = await CapacitorUpdater.current();
    if (bundle?.version) nativeVersion = { ...nativeVersion, ota_bundle: bundle.version };
  } catch {
    // Bundle embarqué (pas d'OTA) : pas de propriété.
  }
}

/**
 * NativeBridge signale d'où vient l'ouverture en cours (tap de notification,
 * lien universel / deep link) — lu par `app_opened` juste après.
 */
export function noteAppOpenSource(source: 'notification' | 'link') {
  openSource = source;
}

let lifecycleBound = false;

/**
 * Ouvertures d'app (natif) et installation PWA (web). `app_opened` part au
 * démarrage (`cold_start: true`) et à chaque retour au premier plan, avec un
 * court délai pour laisser NativeBridge poser la source (le tap de push et le
 * lien arrivent juste après l'événement de reprise).
 */
export function trackAppLifecycle() {
  if (!posthogEnabled() || lifecycleBound || typeof window === 'undefined') return;
  lifecycleBound = true;
  const fireOpen = (coldStart: boolean) => {
    window.setTimeout(() => {
      capturePosthog('app_opened', { cold_start: coldStart, source: openSource ?? 'icon' });
      openSource = null;
    }, coldStart ? 1500 : 800);
  };
  if (isNative()) {
    fireOpen(true);
    void import('@capacitor/app')
      .then(({ App }) => App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) fireOpen(false);
      }))
      .catch(() => {});
    return;
  }
  window.addEventListener('appinstalled', () => capturePosthog('pwa_installed'));
}

/** Contexte analytics joint à tout checkout / inscription guest list. */
export type AnalyticsCheckoutContext = {
  /** Consentement « mesure d'audience » au moment de l'achat (natif = acquis). */
  consent: boolean;
  /** Surface d'achat : web_app / pwa / ios_app / ios_pro. */
  surface: string;
  /** Identifiant PostHog du navigateur — seulement avec consentement. */
  distinctId: string | null;
};

/**
 * Voyage dans le corps des `create-*` puis dans les métadonnées Stripe
 * (`ph_*`) : c'est ce qui permet à la capture serveur `order_paid_server`
 * (supabase/functions/_shared/posthog.ts) de dire où la vente a eu lieu et,
 * avec consentement seulement, de la relier à la personne.
 */
export function getAnalyticsCheckoutContext(): AnalyticsCheckoutContext {
  const consent = hasAnalyticsConsent();
  let distinctId: string | null = null;
  if (consent && client) {
    try {
      distinctId = client.get_distinct_id() || null;
    } catch {
      distinctId = null;
    }
  }
  return { consent, surface: purchaseSurface(), distinctId };
}
