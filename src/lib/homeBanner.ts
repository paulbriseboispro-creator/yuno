// Bannière d'accueil de la Console (club et organisateur).
//
// Ce n'est PAS la couverture de la page publique : celle-ci est cadrée pour la
// page publique (4:3 côté organisateur, bandeau libre côté club) et, étirée dans
// le héros d'accueil (~4,5:1 sur ordinateur, ~1,5:1 sur téléphone), elle ne
// montrait qu'une tranche prise au hasard. La bannière d'accueil vit dans sa
// propre colonne (`venues.home_banner`, `organizer_profiles.home_banner`) et se
// règle depuis l'accueil lui-même, avec un aperçu ordinateur + téléphone.
//
// Le cadrage est un POINT FOCAL + un zoom, jamais un recadrage figé : le héros
// change de proportions avec la largeur de l'écran, un rectangle découpé une
// fois pour toutes serait faux sur l'un des deux. `object-position: x% y%` aligne
// le point x%/y% de l'image sur le point x%/y% du cadre, et le zoom se fait
// autour de ce même point (`transform-origin`) : le sujet choisi reste visible
// à toutes les largeurs.
import type { CSSProperties } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { compressImage } from '@/lib/compressImage';

export type HomeBannerDim = 'light' | 'medium' | 'strong';

export interface HomeBanner {
  url: string;
  /** Point focal horizontal, 0-100. */
  x: number;
  /** Point focal vertical, 0-100. */
  y: number;
  /** Zoom autour du point focal, 1-2,5. */
  zoom: number;
  /** Voile posé sur la photo pour que le nom reste lisible. */
  dim: HomeBannerDim;
}

export type HomeBannerScope =
  | { kind: 'venue'; id: string }
  | { kind: 'organizer'; id: string };

export const HOME_BANNER_MIN_ZOOM = 1;
export const HOME_BANNER_MAX_ZOOM = 2.5;
/** En dessous, la photo est étirée sur un grand écran et paraît floue. */
export const HOME_BANNER_MIN_WIDTH = 1400;
/** Largeur d'export : un héros plein écran sur un écran Retina. */
export const HOME_BANNER_EXPORT_WIDTH = 2400;

const DIM_FILTER: Record<HomeBannerDim, string> = {
  light: 'brightness(0.78) saturate(1.15)',
  medium: 'brightness(0.6) saturate(1.25)',
  strong: 'brightness(0.42) saturate(1.3)',
};

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** Lit la colonne jsonb ; toute forme inattendue ⇒ pas de bannière. */
export function normalizeHomeBanner(raw: unknown): HomeBanner | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.url !== 'string' || !/^https?:\/\//.test(r.url)) return null;
  const dim: HomeBannerDim = r.dim === 'light' || r.dim === 'strong' ? r.dim : 'medium';
  return {
    url: r.url,
    x: clamp(num(r.x, 50), 0, 100),
    y: clamp(num(r.y, 50), 0, 100),
    zoom: clamp(num(r.zoom, 1), HOME_BANNER_MIN_ZOOM, HOME_BANNER_MAX_ZOOM),
    dim,
  };
}

/** Style de l'<img> plein cadre (object-fit: cover attendu). */
export function homeBannerImageStyle(b: Pick<HomeBanner, 'x' | 'y' | 'zoom' | 'dim'>): CSSProperties {
  const pos = `${b.x}% ${b.y}%`;
  return {
    objectFit: 'cover',
    objectPosition: pos,
    transform: b.zoom > 1 ? `scale(${b.zoom})` : undefined,
    transformOrigin: pos,
    filter: DIM_FILTER[b.dim],
  };
}

/**
 * Nouveau point focal après un glissé de (dx, dy) pixels dans un cadre
 * (cw × ch) montrant une image naturelle (nw × nh). Glisser vers la droite
 * découvre la gauche de l'image : le point focal recule.
 */
export function panHomeBanner(
  b: Pick<HomeBanner, 'x' | 'y' | 'zoom'>,
  dx: number,
  dy: number,
  frame: { cw: number; ch: number; nw: number; nh: number },
): { x: number; y: number } {
  const { cw, ch, nw, nh } = frame;
  if (!cw || !ch || !nw || !nh) return { x: b.x, y: b.y };
  const cover = Math.max(cw / nw, ch / nh);
  // Débord total visible en déplaçant le point focal de 0 à 100 %.
  const spanX = Math.max(nw * cover * b.zoom - cw, 24);
  const spanY = Math.max(nh * cover * b.zoom - ch, 24);
  return {
    x: clamp(b.x - (dx / spanX) * 100, 0, 100),
    y: clamp(b.y - (dy / spanY) * 100, 0, 100),
  };
}

/** Compresse et dépose la photo dans le Storage de la portée ; rend l'URL publique. */
export async function uploadHomeBanner(scope: HomeBannerScope, file: File): Promise<string> {
  const compressed = await compressImage(file, HOME_BANNER_EXPORT_WIDTH, 0.86);
  const ext = compressed.type === 'image/png' ? 'png' : compressed.type === 'image/webp' ? 'webp' : 'jpg';
  let bucket: string;
  let path: string;
  if (scope.kind === 'venue') {
    // Premier dossier = id du club : c'est ce que vérifie la policy
    // `is_venue_owner(auth.uid(), foldername[1])` du bucket venue-assets.
    bucket = 'venue-assets';
    path = `${scope.id}/home-banner-${Date.now()}.${ext}`;
  } else {
    // Le fichier est déposé sous le dossier de la PERSONNE (policy du bucket).
    const { data } = await supabase.auth.getUser();
    const uid = data.user?.id;
    if (!uid) throw new Error('not_authenticated');
    bucket = 'profile-photos';
    path = `${uid}/org-home-banner-${Date.now()}.${ext}`;
  }
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, compressed, { upsert: false, contentType: compressed.type || 'image/jpeg' });
  if (error) throw error;
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

/**
 * Lecture isolée : si la migration n'est pas encore appliquée, seule la
 * bannière manque — jamais le club ni l'organisation.
 */
export async function fetchHomeBanner(scope: HomeBannerScope): Promise<HomeBanner | null> {
  if (scope.kind === 'venue') {
    const { data, error } = await supabase.from('venues').select('home_banner').eq('id', scope.id).maybeSingle();
    return error ? null : normalizeHomeBanner(data?.home_banner);
  }
  const { data, error } = await supabase.from('organizer_profiles').select('home_banner').eq('user_id', scope.id).maybeSingle();
  return error ? null : normalizeHomeBanner(data?.home_banner);
}

export async function saveHomeBanner(scope: HomeBannerScope, banner: HomeBanner | null): Promise<void> {
  const value: Json = banner
    ? { url: banner.url, x: Math.round(banner.x * 10) / 10, y: Math.round(banner.y * 10) / 10, zoom: Math.round(banner.zoom * 100) / 100, dim: banner.dim }
    : null;
  const { data, error } = scope.kind === 'venue'
    ? await supabase.from('venues').update({ home_banner: value }).eq('id', scope.id).select('id')
    : await supabase.from('organizer_profiles').update({ home_banner: value }).eq('user_id', scope.id).select('user_id');
  if (error) throw error;
  // Un refus RLS ne lève rien côté PostgREST : zéro ligne touchée.
  if (!data || data.length === 0) throw new Error('not_allowed');
}
