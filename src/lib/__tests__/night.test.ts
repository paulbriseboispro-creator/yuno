import { describe, expect, it } from 'vitest';
import { nightDate, nightsBetween, localDateTime, shiftIsoDate } from '../analytics/night';

describe('la nuit (12:00 → 11:59)', () => {
  it('rattache 02 h du matin à la veille, dans le fuseau du club', () => {
    // 2026-09-27T00:30Z = 02:30 à Paris (été) → nuit du 26.
    expect(nightDate('2026-09-27T00:30:00Z', 'Europe/Paris')).toBe('2026-09-26');
    // 2026-09-26T21:30Z = 23:30 à Paris → nuit du 26.
    expect(nightDate('2026-09-26T21:30:00Z', 'Europe/Paris')).toBe('2026-09-26');
    // 09:59 à Paris → encore la nuit d'avant ; 12:00 → la nouvelle.
    expect(nightDate('2026-09-27T07:59:00Z', 'Europe/Paris')).toBe('2026-09-26');
    expect(nightDate('2026-09-27T10:00:00Z', 'Europe/Paris')).toBe('2026-09-27');
  });
  it('suit le fuseau demandé', () => {
    // 2026-09-27T09:30Z = 11:30 à Madrid (nuit du 26), 12:30 à Athènes (nuit du 27).
    expect(nightDate('2026-09-27T09:30:00Z', 'Europe/Madrid')).toBe('2026-09-26');
    expect(nightDate('2026-09-27T09:30:00Z', 'Europe/Athens')).toBe('2026-09-27');
  });
  it('lit l heure locale', () => {
    const p = localDateTime('2026-09-26T23:15:00Z', 'Europe/Paris');
    expect(p).toEqual({ date: '2026-09-27', hour: 1, minute: 15 });
  });
  it('compte les nuits entre deux instants', () => {
    expect(nightsBetween('2026-09-20T22:00:00Z', '2026-09-26T21:30:00Z', 'Europe/Paris')).toBe(6);
    expect(nightsBetween('2026-09-27T00:30:00Z', '2026-09-26T21:30:00Z', 'Europe/Paris')).toBe(0);
    expect(shiftIsoDate('2026-03-01', -1)).toBe('2026-02-28');
  });
});
