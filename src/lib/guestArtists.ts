/**
 * Line-up invité — les artistes SANS compte Yuno.
 *
 * Le line-up d'une soirée a deux moitiés qui ne se ressemblent pas :
 *
 *  1. Les DJ à compte Yuno (`event_djs` → `djs`). Ils ont une page publique,
 *     un booking, un cachet, une audience. Ils passent par le handshake de
 *     `src/lib/djLineup.ts` : le club propose, le DJ accepte.
 *  2. Les artistes invités (`event_guest_artists`). Un nom, une photo, un lien
 *     Instagram — rien d'autre. Personne n'a de compte à valider, donc rien à
 *     demander : le pro les saisit, ils sont à l'affiche.
 *
 * Un artiste invité n'est JAMAIS une ligne `djs` : pas de page publique, pas de
 * marketplace, pas de demande de booking, pas de cachet. C'est ce qui permet de
 * mettre n'importe quel nom à l'affiche sans polluer l'annuaire des DJ. Le jour
 * où l'artiste crée son compte Yuno, le pro le retire d'ici et l'ajoute par le
 * sélecteur de DJ — les deux listes ne se mélangent jamais.
 *
 * Mesure : le clic vers l'Instagram de l'artiste passe par
 * `track_guest_artist_click`, une RPC SECURITY DEFINER qui reconstruit le
 * visiteur côté serveur (hash salé-jour). Aucun identifiant n'est posé sur
 * l'appareil — même modèle que le trafic plateforme, donc pas de bannière à
 * demander pour ça.
 */
import { supabase } from '@/integrations/supabase/client';

export type GuestArtist = {
  /** Absent tant que la ligne n'est pas enregistrée (brouillon du formulaire). */
  id?: string;
  name: string;
  photoUrl: string | null;
  /** Ce que le pro a tapé ; le serveur en tire le handle et l'URL canonique. */
  instagram: string | null;
  /** Renseigné par le serveur après enregistrement. */
  instagramUrl?: string | null;
  instagramHandle?: string | null;
  /** Clics sortants vers Instagram, cumulés depuis la création. */
  clicks?: number;
};

/** Longueur maximale d'un nom — même borne que le CHECK de la table. */
export const GUEST_ARTIST_NAME_MAX = 80;

/**
 * Miroir exact de `public.normalize_instagram_handle` (migration
 * `20260917100100`). Le serveur reste l'arbitre : cette copie ne sert qu'à
 * montrer au pro, pendant qu'il tape, ce que Yuno a compris.
 *
 * Une saisie qui a la FORME d'une URL doit pointer sur instagram.com ; une
 * saisie sans hôte est un handle nu. On ne peut pas refuser un point ni une
 * terminaison de domaine : de vrais comptes s'appellent « yunoapp.fr ».
 */
export function normalizeInstagramHandle(raw: string | null | undefined): string | null {
  let v = (raw || '').trim();
  if (!v) return null;

  const looksLikeUrl = /^(https?:\/\/|www\.|m\.)/i.test(v) || /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+\//.test(v);
  if (looksLikeUrl) {
    if (!/^(https?:\/\/)?(www\.|m\.)?instagram\.com\//i.test(v)) return null;
    v = v.replace(/^(https?:\/\/)?(www\.|m\.)?instagram\.com\//i, '');
  }

  v = v.replace(/^@/, '');
  v = v.split('?')[0].split('#')[0].split('/')[0];

  if (!/^[A-Za-z0-9._]{1,30}$/.test(v)) return null;
  return v.toLowerCase();
}

export function instagramUrlFor(handle: string | null): string | null {
  return handle ? `https://www.instagram.com/${handle}/` : null;
}

// ─── Lecture ────────────────────────────────────────────────────────────────

type Row = {
  id: string;
  name: string;
  photo_url: string | null;
  instagram_url: string | null;
  instagram_handle: string | null;
  instagram_clicks: number;
};

const SELECT = 'id, name, photo_url, instagram_url, instagram_handle, instagram_clicks, position';

function toArtist(r: Row): GuestArtist {
  return {
    id: r.id,
    name: r.name,
    photoUrl: r.photo_url,
    instagram: r.instagram_url,
    instagramUrl: r.instagram_url,
    instagramHandle: r.instagram_handle,
    clicks: r.instagram_clicks ?? 0,
  };
}

/** Line-up invité d'une soirée, dans l'ordre choisi par le pro. */
export async function loadGuestArtists(eventId: string): Promise<GuestArtist[]> {
  const { data } = await supabase
    .from('event_guest_artists')
    .select(SELECT)
    .eq('event_id', eventId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });
  return ((data || []) as Row[]).map(toArtist);
}

/**
 * Le carnet d'artistes : tous les invités que l'appelant a déjà programmés,
 * avec leur photo et leur Instagram, pour les reposer en un clic.
 *
 * C'est la réponse à « peut-on récupérer la photo Instagram automatiquement ».
 * Non : Instagram n'expose plus de profil public à un serveur (mesuré le
 * 2026-09-17, 0 réussite sur 6 depuis les edge functions, alors que le même
 * appel passe depuis une connexion résidentielle). La photo se met donc à la
 * main — mais une seule fois dans la vie de l'artiste, pas à chaque soirée.
 */
export async function loadGuestArtistBook(query?: string): Promise<BookEntry[]> {
  const { data } = await supabase.rpc('get_guest_artist_book', { p_query: query?.trim() || undefined });
  return ((data || []) as Array<{
    name: string;
    photo_url: string | null;
    instagram_url: string | null;
    instagram_handle: string | null;
    times_used: number;
    last_used_at: string | null;
  }>).map((r) => ({
    name: r.name,
    photoUrl: r.photo_url,
    instagram: r.instagram_url,
    instagramUrl: r.instagram_url,
    instagramHandle: r.instagram_handle,
    timesUsed: r.times_used ?? 0,
  }));
}

export type BookEntry = GuestArtist & { timesUsed: number };

// ─── Écriture ───────────────────────────────────────────────────────────────

/**
 * Persiste le line-up invité d'une soirée déjà enregistrée.
 *
 * Contrairement au line-up DJ, on ne peut PAS effacer puis réinsérer : chaque
 * ligne porte son compteur de clics, et un delete+insert le remettrait à zéro
 * à chaque enregistrement de la soirée. On fait donc un vrai diff — suppression
 * des retirés, mise à jour des conservés, insertion des nouveaux.
 */
export async function saveGuestArtists(
  eventId: string,
  artists: GuestArtist[],
): Promise<{ errors: Array<{ name: string; message: string }> }> {
  const errors: Array<{ name: string; message: string }> = [];

  const clean = artists
    .map((a) => ({ ...a, name: a.name.trim().slice(0, GUEST_ARTIST_NAME_MAX) }))
    .filter((a) => a.name.length > 0);

  const { data: existing } = await supabase
    .from('event_guest_artists')
    .select('id')
    .eq('event_id', eventId);
  const existingIds = new Set((existing || []).map((r) => r.id));
  const keptIds = new Set(clean.map((a) => a.id).filter(Boolean) as string[]);

  const removed = [...existingIds].filter((id) => !keptIds.has(id));
  if (removed.length > 0) {
    const { error } = await supabase.from('event_guest_artists').delete().in('id', removed);
    if (error) errors.push({ name: '—', message: error.message });
  }

  for (let i = 0; i < clean.length; i += 1) {
    const a = clean[i];
    const payload = {
      name: a.name,
      photo_url: a.photoUrl || null,
      // Le serveur normalise : on lui envoie la saisie brute, il range.
      instagram_url: (a.instagram || '').trim() || null,
      position: i,
    };
    const { error } = a.id && existingIds.has(a.id)
      ? await supabase.from('event_guest_artists').update(payload).eq('id', a.id)
      : await supabase.from('event_guest_artists').insert({ ...payload, event_id: eventId });
    if (error) errors.push({ name: a.name, message: error.message });
  }

  return { errors };
}

// ─── Mesure du clic sortant ─────────────────────────────────────────────────

/**
 * Compte un clic vers l'Instagram d'un artiste invité.
 *
 * `keepalive` : le clic ouvre un autre onglet (ou quitte la page sur mobile),
 * donc une requête ordinaire serait annulée avant d'atteindre le serveur — le
 * compteur resterait à zéro. On passe par `fetch` direct plutôt que par le SDK
 * pour pouvoir poser ce drapeau ; même approche que les clics de Yuno Links.
 * Tout échec est avalé : une mesure ratée ne doit jamais retenir le visiteur.
 */
export function trackGuestArtistClick(artistId: string | undefined): void {
  if (!artistId) return;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return;
  try {
    void fetch(`${url}/rest/v1/rpc/track_guest_artist_click`, {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
      body: JSON.stringify({ p_artist_id: artistId }),
    }).catch(() => { /* best-effort */ });
  } catch { /* best-effort */ }
}
