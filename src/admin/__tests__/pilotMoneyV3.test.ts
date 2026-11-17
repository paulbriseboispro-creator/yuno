import { describe, expect, it } from 'vitest';
import { biggestDrop, cohortStory, dueBucket, isFlatZero, monthsSince, mrrBridge, shareOrNull } from '../pilotage/rules';

describe('règles v3 de Pilotage et Argent', () => {
  it('biggestDrop : en personnes, null sans perte ni étape', () => {
    expect(biggestDrop([])).toBeNull();
    expect(biggestDrop([5])).toBeNull();
    expect(biggestDrop([0, 0, 0])).toBeNull();
    expect(biggestDrop([40, 28, 3, 1])).toBe(2);
    expect(biggestDrop([10, 10, 9])).toBe(2);
    // Une étape qui « remonte » (données de sources différentes) ne compte pas.
    expect(biggestDrop([3, 8, 2])).toBe(2);
  });

  it('shareOrNull : aucun pourcentage sous 10', () => {
    expect(shareOrNull(1, 2)).toBeNull();
    expect(shareOrNull(3, 0)).toBeNull();
    expect(shareOrNull(5, 10)).toBe(0.5);
  });

  it('cohortStory : la plus récente à 3 mois de recul (sinon 1), sinon la dernière sans conclusion', () => {
    expect(cohortStory([])).toBeNull();
    expect(cohortStory([{ m: '2026-11', size: 0, months_elapsed: 0, active: [0] }])).toBeNull();
    expect(cohortStory([{ m: '2026-11', size: 2, months_elapsed: 0, active: [2] }])).toEqual({ m: '2026-11', size: 2, still: null, after: 0 });
    expect(cohortStory([
      { m: '2026-08', size: 3, months_elapsed: 3, active: [3, 2, 2, 1] },
      { m: '2026-09', size: 5, months_elapsed: 2, active: [5, 4, 4] },
      { m: '2026-11', size: 1, months_elapsed: 0, active: [1] },
    ])).toEqual({ m: '2026-08', size: 3, still: 1, after: 3 });
    expect(cohortStory([
      { m: '2026-09', size: 5, months_elapsed: 2, active: [5, 4, 4] },
      { m: '2026-11', size: 1, months_elapsed: 0, active: [1] },
    ])).toEqual({ m: '2026-09', size: 5, still: 4, after: 2 });
  });

  it('mrrBridge : départ + nouveaux − perdus + autres = fin', () => {
    expect(mrrBridge([])).toBeNull();
    expect(mrrBridge([{ new: 24, lost: 0, mrr: 24 }])).toEqual({ start: 0, added: 24, lost: 0, other: 0, end: 24 });
    const b = mrrBridge([{ new: 0, lost: 0, mrr: 48 }, { new: 24, lost: 24, mrr: 58 }])!;
    expect(b).toEqual({ start: 48, added: 24, lost: 24, other: 10, end: 58 });
    expect(b.start + b.added - b.lost + b.other).toBe(b.end);
  });

  it('dueBucket : alertes et litiges maintenant, échéances rangées', () => {
    const now = Date.parse('2026-11-17T12:00:00Z');
    expect(dueBucket({ alert: true }, now)).toBe('now');
    expect(dueBucket({ disputed: true, due: '2027-01-01' }, now)).toBe('now');
    expect(dueBucket({ due: '2026-11-10T00:00:00Z' }, now)).toBe('now');
    expect(dueBucket({ due: '2026-11-20T00:00:00Z' }, now)).toBe('week');
    expect(dueBucket({ due: '2026-12-20T00:00:00Z' }, now)).toBe('later');
    expect(dueBucket({ due: null }, now)).toBe('later');
    expect(dueBucket({ due: 'pas une date' }, now)).toBe('later');
  });

  it('monthsSince et isFlatZero', () => {
    const now = Date.parse('2026-11-17T12:00:00Z');
    expect(monthsSince('2026-09-20', now)).toBe(1);
    expect(monthsSince('2026-09-17', now)).toBe(2);
    expect(monthsSince(null, now)).toBeNull();
    expect(monthsSince('2027-01-01', now)).toBe(0);
    expect(isFlatZero([])).toBe(true);
    expect(isFlatZero([0, null, 0])).toBe(true);
    expect(isFlatZero([0, 1])).toBe(false);
  });
});
