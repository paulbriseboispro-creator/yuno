import { describe, expect, it } from 'vitest';
import {
  addDaysToDate, affiliateEventEndAt, currentNightDate, isAffiliateEventOver, nightlifeDateOf, upcomingWeekendDates,
} from '../affiliateEventTime';

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

describe('currentNightDate (Europe/Paris, rollover 8 h)', () => {
  // Instants UTC : l'heure d'été de Paris/Madrid est UTC+2, l'hiver UTC+1.
  it('stays on last night until 8 am local', () => {
    expect(currentNightDate(new Date('2026-09-26T00:30:00Z'))).toBe('2026-09-25'); // 02:30 Madrid
    expect(currentNightDate(new Date('2026-09-26T05:59:00Z'))).toBe('2026-09-25'); // 07:59
    expect(currentNightDate(new Date('2026-09-26T06:00:00Z'))).toBe('2026-09-26'); // 08:00
  });

  it('is today during the day and the evening', () => {
    expect(currentNightDate(new Date('2026-09-25T15:30:00Z'))).toBe('2026-09-25');
    expect(currentNightDate(new Date('2026-09-25T21:59:00Z'))).toBe('2026-09-25'); // 23:59
  });

  it('follows winter time', () => {
    expect(currentNightDate(new Date('2026-12-05T06:30:00Z'))).toBe('2026-12-04'); // 07:30 CET
    expect(currentNightDate(new Date('2026-12-05T07:00:00Z'))).toBe('2026-12-05'); // 08:00 CET
  });
});

describe('date helpers', () => {
  it('reads the Paris calendar date', () => {
    expect(nightlifeDateOf(new Date('2026-09-25T22:30:00Z'))).toBe('2026-09-26');
  });

  it('adds days across months', () => {
    expect(addDaysToDate('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDaysToDate('2026-03-28', 2)).toBe('2026-03-30');
  });

  it('lists the coming weekend, tonight included', () => {
    // Vendredi 25/09 à 17:30 Madrid
    expect(upcomingWeekendDates(new Date('2026-09-25T15:30:00Z'))).toEqual(['2026-09-25', '2026-09-26', '2026-09-27']);
    // Mardi 29/09
    expect(upcomingWeekendDates(new Date('2026-09-29T15:30:00Z'))).toEqual(['2026-10-02', '2026-10-03', '2026-10-04']);
  });
});

describe('affiliateEventEndAt', () => {
  it('rolls a morning closing time to the next day', () => {
    expect(affiliateEventEndAt('2026-09-25', '23:59:00', '06:00:00')).toBe('2026-09-26T06:00:00');
    expect(affiliateEventEndAt('2026-09-25', '00:00:00', '06:00:00')).toBe('2026-09-26T06:00:00');
    expect(affiliateEventEndAt('2026-09-30', null, null)).toBe('2026-10-01T05:30:00');
  });

  it('keeps an evening closing time on the same day', () => {
    expect(affiliateEventEndAt('2026-09-25', '18:00:00', '23:00:00')).toBe('2026-09-25T23:00:00');
  });
});
