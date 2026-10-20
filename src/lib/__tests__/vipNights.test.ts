import { describe, it, expect } from 'vitest';
import { splitVipNights, defaultVipNightId } from '@/lib/vipNights';

const NOW = new Date('2026-10-20T21:00:00Z').getTime();
const night = (id: string, start: string, end: string | null) => ({ id, startAt: start, endAt: end });

describe('vipNights', () => {
  // Arrivent triées du plus tard au plus tôt, comme useOwnerVipData.
  const events = [
    night('far', '2026-10-26T22:00:00Z', '2026-10-27T05:00:00Z'),
    night('next', '2026-10-23T22:00:00Z', '2026-10-24T05:00:00Z'),
    night('tonight', '2026-10-20T22:00:00Z', '2026-10-21T05:00:00Z'),
    night('last-week', '2026-10-13T22:00:00Z', '2026-10-14T05:00:00Z'),
    night('older', '2026-10-06T22:00:00Z', '2026-10-07T05:00:00Z'),
  ];

  it('ouvre sur la soirée de ce soir, pas la plus lointaine', () => {
    expect(defaultVipNightId(events, NOW)).toBe('tonight');
  });

  it('une soirée commencée mais pas finie reste celle du soir', () => {
    const running = [night('running', '2026-10-20T20:00:00Z', '2026-10-21T04:00:00Z'), ...events];
    expect(defaultVipNightId(running, NOW)).toBe('running');
  });

  it('sans soirée ce soir, ouvre la prochaine', () => {
    expect(defaultVipNightId(events.filter(e => e.id !== 'tonight'), NOW)).toBe('next');
  });

  it("rien à venir : pas de soirée par défaut", () => {
    expect(defaultVipNightId(events.filter(e => ['last-week', 'older'].includes(e.id)), NOW)).toBeNull();
  });

  it('range à venir (plus proche en tête) et passées (plus récente en tête)', () => {
    const { upcoming, past } = splitVipNights(events, NOW);
    expect(upcoming.map(e => e.id)).toEqual(['tonight', 'next', 'far']);
    expect(past.map(e => e.id)).toEqual(['last-week', 'older']);
  });

  it('une soirée sans heure de fin reste à venir', () => {
    const { upcoming } = splitVipNights([night('open', '2026-10-20T22:00:00Z', null)], NOW);
    expect(upcoming.map(e => e.id)).toEqual(['open']);
  });
});
