import { describe, expect, it } from 'vitest';
import { bucketByHour, hourKey, hourlyKeys } from '../shortPeriods';

describe('shortPeriods', () => {
  const now = new Date(2026, 8, 25, 14, 37, 12);

  it('ends on the current hour, oldest first', () => {
    const keys = hourlyKeys(24, now);
    expect(keys).toHaveLength(24);
    expect(keys[23]).toBe(new Date(2026, 8, 25, 14).toISOString());
    expect(keys[0]).toBe(new Date(2026, 8, 24, 15).toISOString());
  });

  it('keys a timestamp by the start of its local hour', () => {
    expect(hourKey(new Date(2026, 8, 25, 3, 59, 59))).toBe(new Date(2026, 8, 25, 3).toISOString());
  });

  it('buckets rows, keeps empty hours at zero and drops rows out of range', () => {
    const rows = [
      { at: new Date(2026, 8, 25, 14, 5).toISOString(), v: 10 },
      { at: new Date(2026, 8, 25, 14, 30).toISOString(), v: 5 },
      { at: new Date(2026, 8, 25, 12, 0).toISOString(), v: 2 },
      { at: new Date(2026, 8, 23, 12, 0).toISOString(), v: 99 },
    ];
    const series = bucketByHour(rows, 48, r => r.at, r => r.v, now);
    expect(series).toHaveLength(48);
    expect(series[47].value).toBe(15);
    expect(series[45].value).toBe(2);
    expect(series.reduce((s, p) => s + p.value, 0)).toBe(17);
  });

  it('counts rows when no value accessor is given', () => {
    const rows = [{ at: now.toISOString() }, { at: now.toISOString() }];
    expect(bucketByHour(rows, 24, r => r.at, undefined, now)[23].value).toBe(2);
  });
});
