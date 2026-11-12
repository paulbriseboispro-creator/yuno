import { describe, expect, it } from 'vitest';
import { dailyFromCumulative, headlineDayIndex } from '../visitsCurve';

describe('dailyFromCumulative', () => {
  it('rend les visites de chaque jour', () => {
    expect(dailyFromCumulative([2, 3, 22, 34])).toEqual([2, 1, 19, 12]);
  });
  it('garde les jours à venir à null', () => {
    expect(dailyFromCumulative([5, 9, null, null])).toEqual([5, 4, null, null]);
  });
  it('ne descend jamais sous zéro', () => {
    expect(dailyFromCumulative([4, 3])).toEqual([4, 0]);
  });
});

describe('headlineDayIndex', () => {
  it('prend la veille pour une soirée à venir', () => {
    expect(headlineDayIndex(7, true)).toBe(6);
  });
  it('prend le dernier jour pour une soirée passée', () => {
    expect(headlineDayIndex(13, false)).toBe(13);
  });
  it('garde le premier jour quand la soirée vient d’être publiée', () => {
    expect(headlineDayIndex(0, true)).toBe(0);
  });
});
