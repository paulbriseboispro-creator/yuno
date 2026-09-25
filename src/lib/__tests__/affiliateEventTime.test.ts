import { describe, expect, it } from 'vitest';
import { isAffiliateEventOver } from '../affiliateEventTime';

describe('isAffiliateEventOver', () => {
  it('keeps tonight’s event alive all day and all night', () => {
    expect(isAffiliateEventOver('2026-09-25', new Date(2026, 8, 25, 17, 30))).toBe(false);
    expect(isAffiliateEventOver('2026-09-25', new Date(2026, 8, 26, 4, 0))).toBe(false);
    expect(isAffiliateEventOver('2026-09-25', new Date(2026, 8, 26, 11, 59))).toBe(false);
  });

  it('ends the next day at noon', () => {
    expect(isAffiliateEventOver('2026-09-25', new Date(2026, 8, 26, 12, 0))).toBe(true);
    expect(isAffiliateEventOver('2026-09-24', new Date(2026, 8, 25, 17, 30))).toBe(true);
  });

  it('handles month ends', () => {
    expect(isAffiliateEventOver('2026-09-30', new Date(2026, 9, 1, 3, 0))).toBe(false);
    expect(isAffiliateEventOver('2026-09-30', new Date(2026, 9, 1, 13, 0))).toBe(true);
  });
});
