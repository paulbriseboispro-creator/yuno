// Client Supabase de l'app (anon key). Écrit à la main — seul `types.ts` est
// généré par `supabase gen types`.
import { createClient, processLock } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';
import type { Database } from './types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

/**
 * Délai maximal AVANT la première réponse (time-to-first-byte). Le minuteur est
 * armé à l'envoi et désarmé dès que les en-têtes arrivent : le téléchargement du
 * corps, lui, n'est jamais interrompu.
 *
 * POURQUOI : `@supabase/auth-js` n'impose AUCUN timeout sur ses appels réseau.
 * Un `fetch` de rafraîchissement de token qui reste en suspens (réseau du club,
 * bascule 4G→wifi, portail captif, WKWebView qui sort de veille) fige
 * `initializePromise` POUR TOUJOURS. Or `getSession()` ET `onAuthStateChange()`
 * commencent tous deux par `await this.initializePromise` : plus aucun
 * événement `INITIAL_SESSION` n'est émis, `loading` ne retombe jamais, et l'app
 * tourne indéfiniment sur son spinner. `lockAcquireTimeout` ne protège pas de ça
 * (il garde la prise du verrou, qui vient APRÈS cette attente).
 */
const TTFB_TIMEOUT_MS = 20_000;

/** Un upload envoie son corps avant de recevoir la moindre en-tête : large marge. */
const UPLOAD_TTFB_TIMEOUT_MS = 120_000;

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/**
 * `fetch` avec plafond de temps de réponse, appliqué à TOUTES les requêtes
 * Supabase (auth, postgrest, storage, functions). Garantit qu'aucune promesse
 * ne reste en suspens : elle aboutit, ou elle échoue — jamais « ni l'un ni
 * l'autre ». Le signal éventuel de l'appelant (`.abortSignal()`) reste honoré.
 */
function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const isUpload = requestUrl(input).includes('/storage/v1/');
  const timeoutMs = isUpload ? UPLOAD_TTFB_TIMEOUT_MS : TTFB_TIMEOUT_MS;

  const controller = new AbortController();
  const callerSignal = init?.signal;
  const abortFromCaller = () => controller.abort(callerSignal?.reason);

  if (callerSignal) {
    if (callerSignal.aborted) abortFromCaller();
    else callerSignal.addEventListener('abort', abortFromCaller, { once: true });
  }

  const timer = setTimeout(() => {
    // `AbortError` (et pas `TimeoutError`) : postgrest-js ne rejoue pas une
    // requête annulée, on échoue franchement au lieu de doubler l'attente.
    controller.abort(
      new DOMException(`Yuno: pas de réponse de Supabase après ${timeoutMs} ms`, 'AbortError'),
    );
  }, timeoutMs);

  return fetch(input, { ...init, signal: controller.signal }).finally(() => {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', abortFromCaller);
  });
}

/**
 * Verrou de session. Sur le web, plusieurs onglets se partagent le même
 * `localStorage` : le verrou inter-contextes du navigateur (`navigator.locks`,
 * choix par défaut de auth-js) est le bon outil. Dans une coquille Capacitor il
 * n'y a QU'UN seul WebView : le verrou inter-contextes n'apporte rien et devient
 * un risque — iOS suspend le WebView en arrière-plan, et un verrou détenu au
 * moment de la suspension n'est jamais relâché. `processLock` (chaîne de
 * promesses en mémoire) donne la même exclusion sans cet écueil.
 */
const isNativeShell = (() => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
})();

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
    ...(isNativeShell ? { lock: processLock } : {}),
  },
  global: {
    fetch: fetchWithTimeout,
  },
});
