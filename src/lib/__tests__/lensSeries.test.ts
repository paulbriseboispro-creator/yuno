import { describe, expect, it } from 'vitest';
import { fillAxis } from '../lensSeries';

describe('fillAxis', () => {
  const blank = { visits: 0 };
  it('ne trace rien sans donnée', () => {
    expect(fillAxis([], blank)).toEqual([]);
  });
  it('soirée : J-N continus jusqu’au jour J, du plus loin au plus proche', () => {
    const out = fillAxis([{ d: 4, visits: 3 }, { d: 1, visits: 5 }], blank);
    expect(out.map((p) => p.d)).toEqual([4, 3, 2, 1, 0]);
    expect(out.map((p) => p.visits)).toEqual([3, 0, 0, 5, 0]);
    expect(out[0].key).toBe('d4');
  });
  it('période : dates continues, les jours vides à zéro', () => {
    const out = fillAxis([{ date: '2026-09-01', visits: 2 }, { date: '2026-09-04', visits: 7 }], blank);
    expect(out.map((p) => p.key)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04']);
    expect(out.map((p) => p.visits)).toEqual([2, 0, 0, 7]);
  });
  it('période : traverse un changement de mois', () => {
    const out = fillAxis([{ date: '2026-09-29', visits: 1 }, { date: '2026-10-02', visits: 1 }], blank);
    expect(out.map((p) => p.key)).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
  });
});
