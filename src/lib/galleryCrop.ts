/**
 * Recadrage des photos de galerie (club et organisateur) — règles pures.
 *
 * Une photo de galerie s'affiche toujours en 4:3 (page publique, Console). Le
 * pro la cadre dans l'éditeur ; le cadre est gardé dans `gallery_crops`, par
 * URL de la photo recadrée, pour pouvoir rouvrir l'éditeur sur l'image
 * d'origine avec le même cadre (migration 20261130140000).
 *
 * Le cadre est indépendant de la taille d'écran :
 *  - `zoom` ≥ 1 : 1 = l'image remplit tout juste le cadre (aucune bande vide) ;
 *  - `x`, `y` : décalage du centre de l'image par rapport au centre du cadre,
 *    en fraction de la largeur (x) et de la hauteur (y) du cadre.
 */

import type { Json } from '@/integrations/supabase/types';

export interface CropState {
  x: number;
  y: number;
  zoom: number;
}

export interface GalleryCropEntry extends CropState {
  /** Image d'origine (non recadrée). */
  src: string;
}

export type GalleryCrops = Record<string, GalleryCropEntry>;

export const GALLERY_ASPECT = 4 / 3;
export const GALLERY_OUT_W = 1600;
export const GALLERY_OUT_H = 1200;
export const GALLERY_ZOOM_MIN = 1;
export const GALLERY_ZOOM_MAX = 4;

export const DEFAULT_CROP: CropState = { x: 0, y: 0, zoom: 1 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Échelle (px image → px cadre) qui remplit le cadre au zoom 1. */
export function coverScale(natW: number, natH: number, frameW: number, frameH: number): number {
  return Math.max(frameW / natW, frameH / natH);
}

/**
 * Décalage maximal (en fraction du cadre) pour que l'image couvre toujours le
 * cadre au zoom donné.
 */
export function maxOffset(natW: number, natH: number, zoom: number, aspect = GALLERY_ASPECT): { x: number; y: number } {
  const frameW = 1;
  const frameH = 1 / aspect;
  const s = coverScale(natW, natH, frameW, frameH) * zoom;
  return {
    x: Math.max(0, (natW * s - frameW) / 2 / frameW),
    y: Math.max(0, (natH * s - frameH) / 2 / frameH),
  };
}

/** Ramène un cadre dans les bornes : zoom autorisé, image qui couvre le cadre. */
export function clampCrop(state: CropState, natW: number, natH: number, aspect = GALLERY_ASPECT): CropState {
  const zoom = clamp(Number.isFinite(state.zoom) ? state.zoom : 1, GALLERY_ZOOM_MIN, GALLERY_ZOOM_MAX);
  const m = maxOffset(natW, natH, zoom, aspect);
  return {
    zoom,
    x: clamp(Number.isFinite(state.x) ? state.x : 0, -m.x, m.x),
    y: clamp(Number.isFinite(state.y) ? state.y : 0, -m.y, m.y),
  };
}

/** Où dessiner l'image d'origine dans une sortie de outW × outH px. */
export function drawRect(
  state: CropState,
  natW: number,
  natH: number,
  outW = GALLERY_OUT_W,
  outH = GALLERY_OUT_H,
): { dx: number; dy: number; dw: number; dh: number } {
  const s = coverScale(natW, natH, outW, outH) * state.zoom;
  const dw = natW * s;
  const dh = natH * s;
  return {
    dw,
    dh,
    dx: outW / 2 - dw / 2 + state.x * outW,
    dy: outH / 2 - dh / 2 + state.y * outH,
  };
}

/** Lecture tolérante de la colonne jsonb : toute entrée illisible est ignorée. */
export function parseGalleryCrops(raw: unknown): GalleryCrops {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: GalleryCrops = {};
  for (const [url, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const e = v as Record<string, unknown>;
    if (typeof e.src !== 'string' || !e.src) continue;
    const x = Number(e.x), y = Number(e.y), zoom = Number(e.zoom);
    if (![x, y, zoom].every(Number.isFinite)) continue;
    out[url] = { src: e.src, x, y, zoom };
  }
  return out;
}

/** Lecture tolérante d'une liste de photos (text[] chez l'organisateur, jsonb chez le club). */
export function parseGalleryImages(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((u): u is string => typeof u === 'string' && u.length > 0) : [];
}

/** Ne garde que les cadres des photos encore dans la galerie. */
export function pruneGalleryCrops(images: string[], crops: GalleryCrops): GalleryCrops {
  const keep = new Set(images);
  return Object.fromEntries(Object.entries(crops).filter(([url]) => keep.has(url)));
}

/** Valeur à écrire dans la colonne jsonb gallery_crops. */
export function galleryCropsToJson(crops: GalleryCrops): Json {
  return crops as unknown as Json;
}
