import { supabase } from '@/integrations/supabase/client';
import { purgeServiceWorkersAndReload } from './swRecovery';

const EDGE_RELOAD_KEY = 'yuno-edge-fetch-reload-attempted';

/**
 * True only for a fetch-level failure of an edge-function call. supabase-js raises
 * FunctionsFetchError when the underlying fetch() REJECTS (network down, CORS, or a
 * stale service worker mangling the request) — never for an HTTP 4xx/5xx, which is a
 * FunctionsHttpError. So this is the exact fingerprint of the "Failed to send a
 * request to the Edge Function" bug where a returning visitor stuck on an old
 * precached service worker silently cannot pay.
 */
function isStaleEdgeFetchError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = (error as { name?: string }).name;
  const message = (error as { message?: string }).message ?? '';
  return (
    name === 'FunctionsFetchError' ||
    /Failed to send a request to the Edge Function/i.test(message)
  );
}

/**
 * Reads the JSON body an edge function returned alongside a 4xx/5xx.
 *
 * supabase-js raises FunctionsHttpError on any non-2xx and sets `data` to null —
 * so the body the function actually sent ({ error: "Ce club n'a pas encore
 * configuré ses paiements." }) is dropped on the floor, and every caller shows
 * the useless "Edge Function returned a non-2xx status code" instead. The
 * Response is still reachable on `error.context`; this reads it back.
 *
 * Returns null when there is nothing usable to read (no Response, not JSON, body
 * already consumed) — the caller then keeps supabase-js's original error.
 */
async function readEdgeErrorBody(error: unknown): Promise<Record<string, unknown> | null> {
  const context = (error as { context?: unknown }).context;
  if (!(context instanceof Response)) return null;
  try {
    const body = await context.clone().json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  } catch {
    // Corps vide, non-JSON, ou déjà lu : on garde l'erreur d'origine.
    return null;
  }
}

/**
 * Drop-in replacement for `supabase.functions.invoke()` on PAYMENT-critical calls.
 *
 * Same signature, same return shape ({ data, error }). The only added behaviour:
 * when the call fails with a stale-service-worker fetch rejection, it purges every
 * service worker + cache and reloads onto the current build in a single bounce,
 * instead of leaving the buyer on a dead "Failed to send a request..." toast (which
 * silently loses the sale). The returned promise then never resolves — the page is
 * navigating away — so the caller's normal error branch does not flash. A
 * sessionStorage guard caps it at one bounce per session, so a genuine network
 * outage surfaces the real error on the next attempt instead of looping. Mirrors the
 * chunk-load recovery in lazyWithRetry.ts.
 */
// `ReturnType<typeof supabase.functions.invoke>` instancie le générique T avec
// `unknown` (TS remplace un paramètre non contraint par unknown) → tous les
// appelants se prenaient `data: unknown` et ne pouvaient plus lire data.success
// / data.url. On reprend le générique tel que supabase-js le déclare
// (`invoke<T = any>`), ce qui rend le typage utilisable côté appelant.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- calque la signature de supabase-js (`invoke<T = any>`)
export async function invokeEdgeFunction<T = any>(
  name: string,
  options?: Parameters<typeof supabase.functions.invoke>[1],
): Promise<Awaited<ReturnType<typeof supabase.functions.invoke<T>>>> {
  const result = await supabase.functions.invoke<T>(name, options);
  if (
    result.error &&
    isStaleEdgeFetchError(result.error) &&
    sessionStorage.getItem(EDGE_RELOAD_KEY) !== 'true'
  ) {
    sessionStorage.setItem(EDGE_RELOAD_KEY, 'true');
    await purgeServiceWorkersAndReload();
    // Never resolves: the reload above navigates the page away. Hanging here keeps
    // the caller from flashing its error toast before the bounce completes.
    await new Promise<never>(() => {});
  }

  // Business refusal (4xx with a JSON body): hand the caller BOTH the decoded body
  // — so its `data.code` branches (PAYMENTS_DISABLED, ACCOUNT_EXISTS…) still fire —
  // and an error whose message is the one the server actually wrote, in the buyer's
  // language. Without this, a club that hasn't connected Stripe made the pay button
  // look broken: the real reason never reached the screen.
  if (result.error) {
    const body = await readEdgeErrorBody(result.error);
    const serverMessage = typeof body?.error === 'string' ? body.error : null;
    if (body) {
      if (serverMessage) result.error.message = serverMessage;
      return { ...result, data: body as T };
    }
  }

  return result;
}
