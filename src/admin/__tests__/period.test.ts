import { describe, expect, it } from 'vitest';
import { parseAdminPeriod, periodRange, relativeDelta, withPeriod, DEFAULT_ADMIN_PERIOD } from '../context/period';

describe('admin period', () => {
  it('reads ?p= and falls back to 30 days', () => {
    expect(parseAdminPeriod('7d')).toBe('7d');
    expect(parseAdminPeriod('12m')).toBe('12m');
    expect(parseAdminPeriod('1y')).toBe(DEFAULT_ADMIN_PERIOD);
    expect(parseAdminPeriod(null)).toBe('30d');
  });

  it('compares with the same length just before', () => {
    const now = new Date('2026-11-16T12:00:00Z');
    const r = periodRange('7d', now);
    expect(r.to.toISOString()).toBe('2026-11-16T12:00:00.000Z');
    expect(r.from.toISOString()).toBe('2026-11-09T12:00:00.000Z');
    expect(r.prevTo.toISOString()).toBe(r.from.toISOString());
    expect(r.prevFrom.toISOString()).toBe('2026-11-02T12:00:00.000Z');
    expect(periodRange('12m', now).days).toBe(365);
  });

  it('never invents a change from a zero base', () => {
    expect(relativeDelta(10, 0)).toBeNull();
    expect(relativeDelta(null, 3)).toBeNull();
    expect(relativeDelta(15, 10)).toBeCloseTo(0.5);
    expect(relativeDelta(5, 10)).toBeCloseTo(-0.5);
  });

  it('writes p in the address only when it differs from the default', () => {
    expect(withPeriod('?tab=a', '30d')).toBe('?tab=a');
    expect(withPeriod('?tab=a&p=7d', '30d')).toBe('?tab=a');
    expect(withPeriod('', '90d')).toBe('?p=90d');
  });
});
