import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

import { homeBannerImageStyle, normalizeHomeBanner, panHomeBanner } from '../homeBanner';

describe('normalizeHomeBanner', () => {
  it('rejects anything that is not a banner object with an http(s) url', () => {
    expect(normalizeHomeBanner(null)).toBeNull();
    expect(normalizeHomeBanner('https://x.test/a.jpg')).toBeNull();
    expect(normalizeHomeBanner({ x: 10 })).toBeNull();
    expect(normalizeHomeBanner({ url: 'javascript:alert(1)' })).toBeNull();
    expect(normalizeHomeBanner({ url: 'blob:http://x/1' })).toBeNull();
  });

  it('fills defaults and clamps out-of-range values', () => {
    expect(normalizeHomeBanner({ url: 'https://x.test/a.jpg' })).toEqual({ url: 'https://x.test/a.jpg', x: 50, y: 50, zoom: 1, dim: 'medium' });
    expect(normalizeHomeBanner({ url: 'https://x.test/a.jpg', x: -5, y: 140, zoom: 9, dim: 'neon' }))
      .toEqual({ url: 'https://x.test/a.jpg', x: 0, y: 100, zoom: 2.5, dim: 'medium' });
    expect(normalizeHomeBanner({ url: 'https://x.test/a.jpg', x: '30', zoom: NaN, dim: 'strong' })?.x).toBe(50);
  });
});

describe('homeBannerImageStyle', () => {
  it('zooms around the focal point so the chosen subject stays in frame at any width', () => {
    const s = homeBannerImageStyle({ x: 20, y: 70, zoom: 1.4, dim: 'light' });
    expect(s.objectPosition).toBe('20% 70%');
    expect(s.transformOrigin).toBe('20% 70%');
    expect(s.transform).toBe('scale(1.4)');
  });

  it('adds no transform at zoom 1', () => {
    expect(homeBannerImageStyle({ x: 50, y: 50, zoom: 1, dim: 'medium' }).transform).toBeUndefined();
  });
});

describe('panHomeBanner', () => {
  // 3:1 photo (2400 × 800) in a 1100 × 250 frame: cover scale = 1100/2400,
  // rendered 1100 × 366.7 → only vertical overflow (~117 px).
  const frame = { cw: 1100, ch: 250, nw: 2400, nh: 800 };

  it('dragging down reveals the top of the photo (focal point moves up)', () => {
    const next = panHomeBanner({ x: 50, y: 50, zoom: 1 }, 0, 30, frame);
    expect(next.y).toBeLessThan(50);
    expect(next.x).toBe(50);
  });

  it('dragging across the whole overflow goes from one edge to the other', () => {
    const overflow = 2400 * (1100 / 2400) * (800 / 2400) * 3 - 250; // ≈ 116.7
    expect(panHomeBanner({ x: 50, y: 100, zoom: 1 }, 0, overflow, frame).y).toBeCloseTo(0, 5);
  });

  it('clamps to 0-100', () => {
    expect(panHomeBanner({ x: 50, y: 50, zoom: 1 }, 0, -5000, frame).y).toBe(100);
    expect(panHomeBanner({ x: 50, y: 50, zoom: 1 }, 5000, 0, frame).x).toBe(0);
  });

  it('is a no-op before the image size is known', () => {
    expect(panHomeBanner({ x: 42, y: 17, zoom: 1 }, 30, 30, { ...frame, nw: 0 })).toEqual({ x: 42, y: 17 });
  });
});
