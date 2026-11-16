import { describe, expect, it } from 'vitest';
import { cohortCell } from '../pilotage/format';

const base = { m: '2026-10', months_elapsed: 1, active: [12, 6, 0, 0, 0, 0, 0], amount: [1000, 400, 0, 0, 0, 0, 0] };

describe('cohort cells', () => {
  it('hides months that have not happened yet', () => {
    expect(cohortCell({ ...base, size: 12 }, 2, 'accounts')).toBeNull();
  });
  it('gives a share from 10 accounts, raw numbers under', () => {
    expect(cohortCell({ ...base, size: 12 }, 1, 'accounts')).toEqual({ raw: 6, pct: 0.5 });
    expect(cohortCell({ ...base, size: 4, active: [4, 2, 0, 0, 0, 0, 0] }, 1, 'accounts')).toEqual({ raw: 2, pct: null });
  });
  it('reads sales as a share of M0', () => {
    expect(cohortCell({ ...base, size: 4 }, 1, 'sales')).toEqual({ raw: 400, pct: 0.4 });
  });
});
