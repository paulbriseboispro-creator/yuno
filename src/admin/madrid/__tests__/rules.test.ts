import { describe, expect, it } from 'vitest';
import { costPer, localVsForeign, madridVerdict, shareOf, trendOf, type VerdictInput } from '../rules';
import type { MadridMonth } from '../data';

const zero = { cur: 0, prev: 0 };
const base: VerdictInput = {
  visitors: zero, exits: zero, exitPeople: zero, returning: { base: 0, back: 0 }, accounts: zero, reportedRows: 0, costsEntered: false,
};

describe('shareOf', () => {
  it('never gives a rate on a small or empty base', () => {
    expect(shareOf(1, 2)).toBeNull();
    expect(shareOf(0, 0)).toBeNull();
    expect(shareOf(null, 50)).toBeNull();
    expect(shareOf(5, null)).toBeNull();
    expect(shareOf(Number.NaN, 50)).toBeNull();
    expect(shareOf(5, 10)).toBe(0.5);
    expect(shareOf(-3, 20)).toBe(0);
  });
});

describe('trendOf', () => {
  it('needs both 20 % and 5 exits', () => {
    expect(trendOf({ cur: 50, prev: 20 })).toBe('up');
    expect(trendOf({ cur: 4, prev: 0 })).toBe('flat');
    expect(trendOf({ cur: 5, prev: 0 })).toBe('up');
    expect(trendOf({ cur: 110, prev: 100 })).toBe('flat');
    expect(trendOf({ cur: 10, prev: 20 })).toBe('down');
    expect(trendOf({ cur: 0, prev: 3 })).toBe('flat');
    expect(trendOf(null)).toBe('flat');
  });
});

describe('madridVerdict', () => {
  it('does not judge on nothing', () => {
    const v = madridVerdict(base);
    expect(v.level).toBe('thin');
    expect(v.returnShare).toBeNull();
    expect(v.weakReturn).toBe(false);
    expect(v.missing).toEqual(['sales', 'costs']);
  });

  it('reads the real 17/11 numbers as growing, with weak return', () => {
    const v = madridVerdict({
      ...base,
      visitors: { cur: 106, prev: 67 }, exits: { cur: 50, prev: 20 }, exitPeople: { cur: 40, prev: 15 },
      returning: { base: 50, back: 1 },
    });
    expect(v.level).toBe('up');
    expect(v.returnShare).toBeCloseTo(0.02);
    expect(v.weakReturn).toBe(true);
  });

  it('judges on visitors alone when exits are few', () => {
    expect(madridVerdict({ ...base, visitors: { cur: 60, prev: 60 }, exits: { cur: 3, prev: 2 } }).level).toBe('flat');
  });

  it('drops the missing parts once known', () => {
    expect(madridVerdict({ ...base, reportedRows: 2, costsEntered: true }).missing).toEqual([]);
  });
});

describe('costPer', () => {
  const m = (o: Partial<MadridMonth>): MadridMonth => ({ m: '2026-10-01', exits: 0, accounts: 0, cost: null, hours: null, note: null, ...o });
  it('is empty without inputs', () => {
    const c = costPer([m({ exits: 40 })]);
    expect(c.months).toBe(0);
    expect(c.perExit).toBeNull();
    expect(costPer(null).perAccount).toBeNull();
  });
  it('divides only by the months that were filled', () => {
    const c = costPer([m({ exits: 40, accounts: 2, cost: 100, hours: 10 }), m({ m: '2026-09-01', exits: 60 })]);
    expect(c.perExit).toBe(2.5);
    expect(c.perAccount).toBe(50);
    expect(c.hoursPerExit).toBe(0.25);
  });
  it('never divides by zero', () => {
    const c = costPer([m({ exits: 0, accounts: 0, cost: 80 })]);
    expect(c.perExit).toBeNull();
    expect(c.perAccount).toBeNull();
    expect(c.cost).toBe(80);
  });
});

describe('localVsForeign', () => {
  it('splits Spain, abroad and unknown', () => {
    expect(localVsForeign([{ key: 'ES', n: 6 }, { key: 'FR', n: 2 }, { key: '?', n: 1 }, { key: 'US', n: 1 }])).toEqual({ local: 6, foreign: 3, unknown: 1 });
    expect(localVsForeign([])).toEqual({ local: 0, foreign: 0, unknown: 0 });
  });
});
