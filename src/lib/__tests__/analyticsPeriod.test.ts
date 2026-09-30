import { describe, expect, it } from 'vitest';
import { DEFAULT_PERIOD, PERIODS, parsePeriod, periodHours, salesPeriodOf } from '../analyticsPeriod';

describe('période des vues globales', () => {
  it('propose les six mêmes choix partout', () => {
    expect(PERIODS).toEqual(['24h', '48h', '7d', '30d', '90d', 'all']);
  });
  it('retombe sur la période par défaut pour une valeur inconnue', () => {
    expect(parsePeriod(null)).toBe(DEFAULT_PERIOD);
    expect(parsePeriod('3j')).toBe(DEFAULT_PERIOD);
    expect(parsePeriod('7d')).toBe('7d');
  });
  it('donne des heures, et rien pour « tout »', () => {
    expect(periodHours('24h')).toBe(24);
    expect(periodHours('7d')).toBe(168);
    expect(periodHours('90d')).toBe(2160);
    expect(periodHours('all')).toBeNull();
  });
  it('se lit en soirées pour Ventes', () => {
    expect(salesPeriodOf('24h')).toBe('d1');
    expect(salesPeriodOf('30d')).toBe('d30');
    expect(salesPeriodOf('all')).toBe('all');
  });
});
