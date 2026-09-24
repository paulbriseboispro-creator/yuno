import { describe, expect, it } from 'vitest';
import { needsSecondAxis, onceShare, pct, trimLeadingEmpty } from '../communityAnalytics';

describe('communityAnalytics', () => {
  it('pct se tait sans base', () => {
    expect(pct(1, 3)).toBe(33);
    expect(pct(3, 0)).toBeNull();
  });
  it('onceShare lit la tranche « 1 » sur la base connue', () => {
    expect(onceShare({ known: 4, avg: 2, buckets: [{ bucket: '0', n: 1 }, { bucket: '1', n: 3 }] })).toBe(75);
    expect(onceShare({ known: 0, avg: null, buckets: [] })).toBeNull();
  });
  it('sépare les axes quand les ordres de grandeur divergent', () => {
    expect(needsSecondAxis([12000, 13930], [300, 752])).toBe(true);
    expect(needsSecondAxis([10, 20], [8, 15])).toBe(false);
    expect(needsSecondAxis([10], [0])).toBe(false);
  });
  it('coupe le début vide de la croissance', () => {
    const s = [{ contacts: 0, followers: 0 }, { contacts: 0, followers: 0 }, { contacts: 2, followers: 1 }, { contacts: 3, followers: 1 }];
    expect(trimLeadingEmpty(s)).toHaveLength(2);
    expect(trimLeadingEmpty([{ contacts: 1, followers: 0 }])).toHaveLength(1);
  });
});
