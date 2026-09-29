import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';

/**
 * Le club du compte connecté, lu UNE fois et partagé par toute la Console Club.
 *
 * POURQUOI : `useOwnerVenue()` est monté par `useVenueContext()`, lui-même
 * appelé par des dizaines de pages et de composants — chacun relançait sa
 * propre lecture (`getUser` + `venues`), jusqu'à 6 fois par navigation, toutes
 * sérialisées derrière le verrou de session. Et chacune avait son délai de 8 s
 * qui, une fois dépassé, laissait le composant sans club POUR TOUJOURS : un
 * écran vide ou un squelette qui ne s'en va jamais.
 *
 * Ici : une lecture en vol à la fois, le résultat servi à tous, une erreur qui
 * ne reste jamais figée (le prochain composant monté relance), et un
 * changement de compte qui vide tout.
 */

// Liste explicite (pas de select('*')) : les internals Stripe/facturation sont
// retirés du rôle authenticated (migration 20260823180003) — un select('*')
// prendrait un 403 sur TOUTE la requête. Le privé passe par get_my_venue_private.
const OWNER_VENUE_COLUMNS = 'id, name, city, address, cover_url, logo_url, floor_plan_url, legal_name, siret, vat_number';
type OwnerVenueRow = Pick<Tables<'venues'>, 'id' | 'name' | 'city' | 'address' | 'cover_url' | 'logo_url' | 'floor_plan_url' | 'legal_name' | 'siret' | 'vat_number'>;

export interface OwnerVenue {
  id: string;
  name: string;
  city: string;
  address?: string;
  coverUrl?: string;
  logoUrl?: string;
  floorPlanUrl?: string;
  legalName?: string;
  siret?: string;
  vatNumber?: string;
}

export interface OwnerVenueState {
  /** Club dont le compte est propriétaire (`venues.owner_id`). */
  owned: OwnerVenue | null;
  /** Repli : club rattaché au profil (`profiles.venue_id`) quand le compte n'en possède aucun. */
  attached: OwnerVenue | null;
  loading: boolean;
  /** `not_authenticated` | `fetch_failed` | null */
  error: string | null;
}

const REQUEST_TIMEOUT_MS = 12_000;
const MAX_ATTEMPTS = 2;

let state: OwnerVenueState = { owned: null, attached: null, loading: true, error: null };
let loadedFor: string | null = null;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(next: OwnerVenueState) {
  state = next;
  listeners.forEach((l) => l());
}

function toVenue(row: OwnerVenueRow): OwnerVenue {
  return {
    id: row.id,
    name: row.name,
    city: row.city,
    address: row.address || undefined,
    coverUrl: row.cover_url || undefined,
    logoUrl: row.logo_url || undefined,
    floorPlanUrl: row.floor_plan_url || undefined,
    legalName: row.legal_name || undefined,
    siret: row.siret || undefined,
    vatNumber: row.vat_number || undefined,
  };
}

function withTimeout<T>(p: PromiseLike<T>, ms: number): Promise<T> {
  return Promise.race([
    Promise.resolve(p),
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Supabase timeout after ${ms}ms`)), ms)),
  ]);
}

async function read(userId: string): Promise<Pick<OwnerVenueState, 'owned' | 'attached'>> {
  const { data: owned, error } = await withTimeout(
    supabase.from('venues').select(OWNER_VENUE_COLUMNS).eq('owner_id', userId).maybeSingle(),
    REQUEST_TIMEOUT_MS,
  );
  if (error) throw error;
  if (owned) return { owned: toVenue(owned as OwnerVenueRow), attached: null };

  const { data: profile } = await withTimeout(
    supabase.from('profiles').select('venue_id').eq('id', userId).maybeSingle(),
    REQUEST_TIMEOUT_MS,
  );
  if (!profile?.venue_id) return { owned: null, attached: null };
  const { data: attached } = await withTimeout(
    supabase.from('venues').select(OWNER_VENUE_COLUMNS).eq('id', profile.venue_id).maybeSingle(),
    REQUEST_TIMEOUT_MS,
  );
  return { owned: null, attached: attached ? toVenue(attached as OwnerVenueRow) : null };
}

async function load(): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id ?? null;
  if (!userId) {
    loadedFor = null;
    emit({ owned: null, attached: null, loading: false, error: 'not_authenticated' });
    return;
  }
  if (loadedFor !== userId) emit({ owned: null, attached: null, loading: true, error: null });
  else if (!state.loading) emit({ ...state, loading: true });

  let lastError: unknown = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const venues = await read(userId);
      loadedFor = userId;
      emit({ ...venues, loading: false, error: null });
      return;
    } catch (err) {
      lastError = err;
    }
  }
  console.error('Error fetching owner venue:', lastError);
  // L'erreur n'est pas mise en cache : le prochain `ensure` relancera la lecture.
  loadedFor = null;
  emit({ ...state, loading: false, error: 'fetch_failed' });
}

/** Lance la lecture si elle n'a pas déjà été faite (ou si la précédente a échoué). */
export function ensureOwnerVenue(force = false): Promise<void> {
  if (inflight) return inflight;
  if (!force && loadedFor && !state.error) return Promise.resolve();
  inflight = load().finally(() => { inflight = null; });
  return inflight;
}

export function refetchOwnerVenue(): Promise<void> {
  if (inflight) return inflight.then(() => ensureOwnerVenue(true));
  return ensureOwnerVenue(true);
}

let authWatch = false;
export function subscribeOwnerVenue(onChange: () => void) {
  if (!authWatch) {
    authWatch = true;
    // Changement de compte (bascule démo, déconnexion) : le club de l'ancien
    // compte ne vaut rien pour le nouveau.
    supabase.auth.onAuthStateChange((_event, session) => {
      const userId = session?.user?.id ?? null;
      if (userId === loadedFor) return;
      if (!loadedFor && !userId) return;
      loadedFor = null;
      if (listeners.size > 0) setTimeout(() => { void ensureOwnerVenue(); }, 0);
    });
  }
  listeners.add(onChange);
  return () => { listeners.delete(onChange); };
}

export function getOwnerVenueState(): OwnerVenueState {
  return state;
}
