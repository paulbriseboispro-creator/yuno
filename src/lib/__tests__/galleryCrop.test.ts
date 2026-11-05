import { describe, expect, it } from 'vitest';
import {
  clampCrop, coverScale, drawRect, maxOffset, parseGalleryCrops, parseGalleryImages, pruneGalleryCrops,
} from '../galleryCrop';

describe('galleryCrop', () => {
  it('remplit le cadre au zoom 1 (paysage plus large que 4:3)', () => {
    // 2000×1000 dans 1600×1200 : la hauteur commande.
    expect(coverScale(2000, 1000, 1600, 1200)).toBeCloseTo(1.2);
    const r = drawRect({ x: 0, y: 0, zoom: 1 }, 2000, 1000);
    expect(r.dh).toBeCloseTo(1200);
    expect(r.dw).toBeCloseTo(2400);
    expect(r.dx).toBeCloseTo(-400);
    expect(r.dy).toBeCloseTo(0);
  });

  it('ne laisse jamais de bande vide', () => {
    // Portrait 1000×2000 : marge horizontale nulle au zoom 1.
    expect(maxOffset(1000, 2000, 1).x).toBeCloseTo(0);
    expect(maxOffset(1000, 2000, 1).y).toBeGreaterThan(0);
    const c = clampCrop({ x: 0.9, y: -5, zoom: 1 }, 1000, 2000);
    expect(c.x).toBe(0);
    const r = drawRect(c, 1000, 2000);
    expect(r.dy).toBeLessThanOrEqual(0);
    expect(r.dy + r.dh).toBeGreaterThanOrEqual(1200 - 1e-6);
  });

  it('borne le zoom et répare les valeurs illisibles', () => {
    expect(clampCrop({ x: NaN, y: 0, zoom: 9 }, 1600, 1200)).toEqual({ x: 0, y: 0, zoom: 4 });
    expect(clampCrop({ x: 0, y: 0, zoom: 0.2 }, 1600, 1200).zoom).toBe(1);
  });

  it('un cadre se rejoue à n’importe quelle taille de sortie', () => {
    const c = clampCrop({ x: 0.1, y: -0.05, zoom: 2 }, 3000, 2000);
    const big = drawRect(c, 3000, 2000, 1600, 1200);
    const small = drawRect(c, 3000, 2000, 400, 300);
    expect(small.dx * 4).toBeCloseTo(big.dx);
    expect(small.dy * 4).toBeCloseTo(big.dy);
  });

  it('lit la colonne jsonb avec tolérance', () => {
    expect(parseGalleryCrops(null)).toEqual({});
    expect(parseGalleryCrops([])).toEqual({});
    expect(parseGalleryCrops({ a: { src: 's', x: 0, y: 0, zoom: 1 }, b: { x: 1 }, c: 'x' }))
      .toEqual({ a: { src: 's', x: 0, y: 0, zoom: 1 } });
    expect(parseGalleryImages(['a', '', 3, 'b'])).toEqual(['a', 'b']);
    expect(parseGalleryImages(null)).toEqual([]);
  });

  it('oublie le cadre d’une photo retirée', () => {
    const crops = { a: { src: 'sa', x: 0, y: 0, zoom: 1 }, b: { src: 'sb', x: 0, y: 0, zoom: 1 } };
    expect(Object.keys(pruneGalleryCrops(['b'], crops))).toEqual(['b']);
  });
});
