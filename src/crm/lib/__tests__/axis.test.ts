import { describe, expect, it } from 'vitest';
import { COARSE_STEPS, niceTop } from '../axis';

describe('niceTop', () => {
  it('pas fins : 71 → 80, 132 → 150', () => {
    expect(niceTop(71, { headroom: 1.05 })).toBe(80);
    expect(niceTop(132)).toBe(150);
  });
  it('pas grossiers : 71 → 100, 38 → 50', () => {
    expect(niceTop(71, { headroom: 1.12, steps: COARSE_STEPS })).toBe(100);
    expect(niceTop(38, { headroom: 1.12, steps: COARSE_STEPS })).toBe(50);
  });
  it('vide : la valeur de repli', () => {
    expect(niceTop(0)).toBe(100);
    expect(niceTop(-3, { empty: 1 })).toBe(1);
    expect(niceTop(Number.NaN, { empty: 10 })).toBe(10);
  });
  it('un maximum déjà rond garde sa marge', () => {
    expect(niceTop(100)).toBe(120);
  });
});
