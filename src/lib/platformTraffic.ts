// Mesure d'audience plateforme (« GA maison ») — voir migration 20260827100000.
//
// ZÉRO stockage côté client : pas de cookie, pas de localStorage, pas de
// sessionStorage. L'identité visiteur et la session sont reconstruites côté
// serveur (hash salé-jour IP+UA, purgé à J+2) — c'est ce qui permet de mesurer
// SANS bannière de consentement (modèle Plausible), y compris les visiteurs qui
// refusent les cookies. Ne JAMAIS ajouter d'identifiant persistant ici sans
// repasser par la CMP (src/lib/consent.ts).
//
// Tout est fire-and-forget : une panne de tracking ne doit jamais toucher l'UX.
import { supabase } from '@/integrations/supabase/client';
import { isNative, isProApp } from '@/lib/native';

// Surfaces pro/staff : hors périmètre — on mesure l'audience publique/cliente.
// (/promoteur, /p, /promo, /rp restent trackés : ce sont des pages PUBLIQUES.)
const SKIP_PREFIXES = [
  '/admin', '/owner', '/manager', '/organizer-app', '/agency-app', '/agency',
  '/barman', '/bouncer', '/cloakroom', '/vip-host', '/staff', '/pro',
  // Dashboards — attention : /affiliate-event et /affiliate-venue sont publics,
  // d'où le test « segment exact » (p === x || p.startsWith(x + '/')).
  '/affiliate', '/promoter',
];

let currentSession: string | null = null;
let currentView: number | null = null;
let viewStartedAt = 0;
let heartbeatTimer: number | null = null;
let lifecycleReady = false;

function isTrackable(pathname: string): boolean {
  if (import.meta.env.DEV) return false;
  if (isProApp()) return false; // app staff Yuno Pro : hors périmètre
  if (!isNative()) {
    // Ne pas polluer la prod depuis un preview local du build.
    const h = window.location.hostname;
    if (h !== 'yunoapp.eu' && !h.endsWith('.yunoapp.eu')) return false;
  }
  return !SKIP_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

function elapsedSeconds(): number {
  return Math.max(0, Math.round((Date.now() - viewStartedAt) / 1000));
}

/** Durée réelle + présence « en direct », via le SDK (onglet actif). */
function sendHeartbeat(): void {
  if (!currentSession || !currentView) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase.rpc('platform_heartbeat' as any, {
    p_session_id: currentSession,
    p_view_id: currentView,
    p_seconds: elapsedSeconds(),
  }).then(() => {}, () => {});
}

/** Même battement, en keepalive : le SDK ne survit pas à un onglet qui se
 *  ferme, un fetch keepalive oui (pattern de useVisitorTracking). */
function sendHeartbeatKeepalive(): void {
  if (!currentSession || !currentView) return;
  const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/platform_heartbeat`;
  const body = JSON.stringify({
    p_session_id: currentSession,
    p_view_id: currentView,
    p_seconds: elapsedSeconds(),
  });
  const headers = {
    'Content-Type': 'application/json',
    'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    'Prefer': 'return=minimal',
  };
  fetch(url, { method: 'POST', headers, body, keepalive: true }).catch(() => {});
}

function startHeartbeatLoop(): void {
  if (heartbeatTimer !== null) return;
  heartbeatTimer = window.setInterval(sendHeartbeat, 60_000);
}

function stopHeartbeatLoop(): void {
  if (heartbeatTimer !== null) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

/** Une vue de page par changement de route (appelé par PlatformTrafficTracker). */
export function trackPlatformPageView(pathname: string, search: string): void {
  if (!isTrackable(pathname)) {
    // Passage vers une surface pro : clore proprement la vue en cours.
    if (currentView) sendHeartbeat();
    currentSession = null;
    currentView = null;
    return;
  }

  // Durée finale de la page précédente avant d'ouvrir la suivante.
  if (currentView) sendHeartbeat();

  const params = new URLSearchParams(search);
  let utmSource = params.get('utm_source') || '';
  let utmMedium = params.get('utm_medium') || '';
  // Attribution des canaux maison quand aucun utm explicite :
  // ?an= / ?pc= = clic sur un push Yuno, ?via= = lien affilié.
  if (!utmSource && (params.get('an') || params.get('pc'))) {
    utmSource = 'yuno-push';
    utmMedium = utmMedium || 'notification';
  }
  if (!utmSource && params.get('via')) utmSource = 'affiliate-link';

  let referrerHost = '';
  try {
    if (document.referrer) referrerHost = new URL(document.referrer).hostname;
  } catch {
    // referrer illisible : tant pis, la session sera « direct »
  }

  viewStartedAt = Date.now();
  currentView = null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase.rpc('track_platform_view' as any, {
    p_path: pathname,
    p_referrer_host: referrerHost || null,
    p_utm_source: utmSource || null,
    p_utm_medium: utmMedium || null,
    p_utm_campaign: params.get('utm_campaign') || null,
    p_language: navigator.language || null,
    p_is_native: isNative(),
  }).then(({ data }) => {
    const d = data as { s?: string; v?: number } | null;
    if (d?.s && d?.v) {
      currentSession = d.s;
      currentView = d.v;
    }
  }, () => {});
}

/** Écouteurs de cycle de vie (montés une seule fois). */
export function initPlatformTrafficLifecycle(): void {
  if (lifecycleReady) return;
  lifecycleReady = true;

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      sendHeartbeatKeepalive();
      stopHeartbeatLoop();
    } else {
      startHeartbeatLoop();
    }
  });
  window.addEventListener('pagehide', sendHeartbeatKeepalive);
  if (document.visibilityState !== 'hidden') startHeartbeatLoop();
}
