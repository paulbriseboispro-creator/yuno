/**
 * L'action qu'un invité voulait faire avant qu'on lui demande un compte
 * (s'abonner à un club, suivre un DJ, sauvegarder une soirée…).
 *
 * Règle : un clic réservé aux comptes ouvre la fenêtre de compte SUR PLACE
 * (`AccountSheet`), et l'action se fait toute seule dès que la personne est
 * connectée — y compris au retour d'Apple / Google sur le web, qui recharge la
 * page : l'action voyage donc dans localStorage, avec une durée de vie courte.
 *
 * Rejouer une action, c'est toujours AJOUTER (jamais basculer) : quelqu'un qui
 * suivait déjà le club et se reconnecte ne doit pas se retrouver désabonné.
 */
import { supabase } from '@/integrations/supabase/client';
import type { FavoriteType } from '@/contexts/FavoritesContext';
import type { TablesInsert } from '@/integrations/supabase/types';
import { followEventHosts } from '@/lib/coorg';
import { capturePosthog } from '@/lib/posthog';

export type AccountIntent =
  | { kind: 'favorite'; type: FavoriteType; id: string; source?: string }
  | { kind: 'follow_organizer'; organizerUserId: string; source?: string }
  | { kind: 'follow_agency'; agencyId: string; source?: string }
  | { kind: 'follow_event_hosts'; eventId: string };

/** Ce que la fenêtre affiche pour cette action. */
export type IntentVerb = 'subscribe' | 'follow' | 'save' | 'follow_hosts';

export interface IntentDisplay {
  name: string | null;
  image: string | null;
  /** Avatar rond (personne) ou carré arrondi (lieu, organisation, affiche). */
  round: boolean;
}

const STORAGE_KEY = 'yuno:account-intent';
/** Le temps d'un aller-retour Apple / Google, pas d'une soirée entière. */
const TTL_MS = 30 * 60 * 1000;

interface StoredIntent {
  intent: AccountIntent;
  at: number;
}

export function intentVerb(intent: AccountIntent): IntentVerb {
  if (intent.kind === 'follow_event_hosts') return 'follow_hosts';
  // Mêmes mots que le bouton de la page : « S'abonner » pour un club, un
  // organisateur, une agence ou un DJ (FavoriteButton, subscribe.action).
  if (intent.kind === 'follow_organizer' || intent.kind === 'follow_agency') return 'subscribe';
  if (intent.type === 'club' || intent.type === 'affiliate_venue') return 'subscribe';
  if (intent.type === 'dj') return 'follow';
  return 'save';
}

/** Nom court pour PostHog (jamais d'identifiant de personne). */
export function intentLabel(intent: AccountIntent): string {
  return intent.kind === 'favorite' ? `favorite_${intent.type}` : intent.kind;
}

export function storeIntent(intent: AccountIntent): void {
  try {
    const value: StoredIntent = { intent, at: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch { /* stockage indisponible (navigation privée) : l'action en place suffit */ }
}

export function clearIntent(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* idem */ }
}

/** Lit l'action en attente, si elle est encore fraîche. Ne l'efface pas. */
export function peekIntent(): AccountIntent | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredIntent;
    if (!parsed?.intent || typeof parsed.at !== 'number' || Date.now() - parsed.at > TTL_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed.intent;
  } catch {
    return null;
  }
}

/** Nom et image de ce que la personne voulait suivre, pour la fenêtre. */
export async function resolveIntentDisplay(intent: AccountIntent): Promise<IntentDisplay> {
  const none: IntentDisplay = { name: null, image: null, round: false };
  try {
    if (intent.kind === 'follow_organizer') {
      const { data } = await supabase.from('organizer_profiles')
        .select('display_name, avatar_url').eq('user_id', intent.organizerUserId).maybeSingle();
      return { name: data?.display_name ?? null, image: data?.avatar_url ?? null, round: false };
    }
    if (intent.kind === 'follow_agency') {
      const { data } = await supabase.from('agencies')
        .select('name, logo_url').eq('id', intent.agencyId).maybeSingle();
      return { name: data?.name ?? null, image: data?.logo_url ?? null, round: false };
    }
    if (intent.kind === 'follow_event_hosts') {
      const { data } = await supabase.from('events')
        .select('title, poster_url, image_url').eq('id', intent.eventId).maybeSingle();
      return { name: data?.title ?? null, image: data?.poster_url ?? data?.image_url ?? null, round: false };
    }
    switch (intent.type) {
      case 'club': {
        const { data } = await supabase.from('venues').select('name, logo_url').eq('id', intent.id).maybeSingle();
        return { name: data?.name ?? null, image: data?.logo_url ?? null, round: false };
      }
      case 'dj': {
        const { data } = await supabase.from('djs').select('stage_name, profile_image_url').eq('id', intent.id).maybeSingle();
        return { name: data?.stage_name ?? null, image: data?.profile_image_url ?? null, round: true };
      }
      case 'event': {
        const { data } = await supabase.from('events').select('title, poster_url, image_url').eq('id', intent.id).maybeSingle();
        return { name: data?.title ?? null, image: data?.poster_url ?? data?.image_url ?? null, round: false };
      }
      case 'affiliate_venue': {
        const { data } = await supabase.from('affiliate_venues').select('name, logo_url').eq('id', intent.id).maybeSingle();
        return { name: data?.name ?? null, image: data?.logo_url ?? null, round: false };
      }
      case 'affiliate_event': {
        const { data } = await supabase.from('affiliate_events').select('name, flyer_url').eq('id', intent.id).maybeSingle();
        return { name: data?.name ?? null, image: data?.flyer_url ?? null, round: false };
      }
      default:
        return none;
    }
  } catch {
    return none;
  }
}

const isDuplicate = (error: unknown) => (error as { code?: string } | null)?.code === '23505';

const FAVORITE_COLUMN: Record<FavoriteType, 'venue_id' | 'event_id' | 'drink_id' | 'dj_id' | 'affiliate_event_id' | 'affiliate_venue_id'> = {
  club: 'venue_id',
  event: 'event_id',
  drink: 'drink_id',
  dj: 'dj_id',
  affiliate_event: 'affiliate_event_id',
  affiliate_venue: 'affiliate_venue_id',
};

type LooseRpc = (name: string, params: Record<string, unknown>) => Promise<{ error: unknown }>;
// Lié au client : `supabase.rpc` détaché perd son `this` et lève à l'appel.
const rpc = (supabase.rpc as unknown as LooseRpc).bind(supabase);

/**
 * Fait l'action pour la personne connectée. Rend true si l'état voulu est
 * atteint (y compris quand il l'était déjà).
 */
export async function runIntent(intent: AccountIntent, userId: string): Promise<boolean> {
  try {
    if (intent.kind === 'favorite') {
      const column = FAVORITE_COLUMN[intent.type];
      const { data: existing } = await supabase.from('favorites').select('id')
        .eq('user_id', userId).eq('favorite_type', intent.type).eq(column, intent.id).maybeSingle();
      if (existing) return true;
      const { error } = intent.source && (intent.type === 'club' || intent.type === 'dj')
        ? await rpc('follow_subject', { p_favorite_type: intent.type, p_target_id: intent.id, p_source: intent.source })
        : await supabase.from('favorites').insert([{ user_id: userId, favorite_type: intent.type, [column]: intent.id } as TablesInsert<'favorites'>]);
      if (error && !isDuplicate(error)) return false;
      capturePosthog(intent.type === 'club' || intent.type === 'dj' || intent.type === 'affiliate_venue' ? 'follow_toggled' : 'favorite_toggled', {
        target_type: intent.type === 'dj' ? 'dj' : 'venue',
        following: true,
        favorited: true,
        item_type: intent.type,
        source: intent.source ?? 'account_sheet',
        via: 'account_sheet',
      });
      return true;
    }
    if (intent.kind === 'follow_organizer') {
      const { data: existing } = await supabase.from('organizer_profile_followers').select('id')
        .eq('organizer_user_id', intent.organizerUserId).eq('user_id', userId).maybeSingle();
      if (existing) return true;
      const { error } = await rpc('follow_organizer', { p_organizer_user_id: intent.organizerUserId, p_source: intent.source ?? null });
      if (error && !isDuplicate(error)) return false;
      capturePosthog('follow_toggled', { target_type: 'organizer', following: true, source: intent.source ?? null, via: 'account_sheet' });
      return true;
    }
    if (intent.kind === 'follow_agency') {
      const { error } = await rpc('follow_agency', { p_agency_id: intent.agencyId, p_source: intent.source ?? null });
      if (error && !isDuplicate(error)) return false;
      capturePosthog('follow_toggled', { target_type: 'agency', following: true, source: intent.source ?? null, via: 'account_sheet' });
      return true;
    }
    await followEventHosts(intent.eventId);
    capturePosthog('event_hosts_followed', { event_id: intent.eventId, via: 'account_sheet' });
    return true;
  } catch (err) {
    console.warn('[account-intent] replay failed:', err);
    return false;
  }
}

/** Les pages qui affichent un état local (suivre un organisateur…) l'écoutent. */
export const INTENT_DONE_EVENT = 'yuno:account-intent-done';

export function announceIntentDone(intent: AccountIntent): void {
  window.dispatchEvent(new CustomEvent<AccountIntent>(INTENT_DONE_EVENT, { detail: intent }));
}

export function onIntentDone(handler: (intent: AccountIntent) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<AccountIntent>).detail);
  window.addEventListener(INTENT_DONE_EVENT, listener);
  return () => window.removeEventListener(INTENT_DONE_EVENT, listener);
}
