import { describe, expect, it } from 'vitest';
import { currentNightDate } from '@/lib/nightDate';

// Dates construites en heure LOCALE : le test ne dépend pas du fuseau de la CI.
const at = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo - 1, d, h, mi);

describe('currentNightDate', () => {
  it('le soir même, c’est la date du jour', () => {
    expect(currentNightDate(at(2026, 9, 25, 23, 30))).toBe('2026-09-25');
  });
  it('à 2 h du matin, la nuit de la veille continue', () => {
    expect(currentNightDate(at(2026, 9, 26, 2, 0))).toBe('2026-09-25');
  });
  it('jusqu’à 6 h du matin', () => {
    expect(currentNightDate(at(2026, 9, 26, 5, 59))).toBe('2026-09-25');
    expect(currentNightDate(at(2026, 9, 26, 6, 0))).toBe('2026-09-26');
  });
  it('passe le mois et l’année', () => {
    expect(currentNightDate(at(2027, 1, 1, 3, 0))).toBe('2026-12-31');
  });
});
