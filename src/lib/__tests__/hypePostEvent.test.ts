import { describe, expect, it } from 'vitest';
import { computeNightStats, type NightInput } from '../hypePostEvent';

// Bug vécu (19/09) : la soirée WOH du 11 septembre — 29 inscrits guest list,
// 1 scan — affichait 0 participant, présence « — », verdict 0/10. Le moteur ne
// lisait que `tickets`. Une entrée guest list est un billet GRATUIT : elle
// compte comme un billet dans toutes les stats d'affluence.

const START = Date.UTC(2026, 8, 11, 21, 30);
const END = START + 8 * 3_600_000;

const base = (over: Partial<NightInput> = {}): NightInput => ({
  eventStart: START,
  eventEnd: END,
  capacity: null,
  tickets: [],
  orders: [],
  tables: [],
  pageViews: 0,
  newCustomers: 0,
  returningCustomers: 0,
  topSegment: null,
  benchmark: { eventsCount: 0, avgAttendance: null, avgRevenuePerHead: null, avgDrinksPerHead: null },
  numEvents: 1,
  ...over,
});

const guests = (n: number, scanned: number) =>
  Array.from({ length: n }, (_, i) => ({
    createdAt: START - 86_400_000,
    scanned: i < scanned,
    scannedAt: i < scanned ? START + 30 * 60_000 : null,
    email: `guest${i}@example.com`,
  }));

describe('computeNightStats — la guest list est un billet gratuit', () => {
  it('29 inscrits, 1 scan : 29 attendus, 1 présent, présence 3 %', () => {
    const s = computeNightStats(base({ guestEntries: guests(29, 1), offer: { drinks: false, paid: false } }));
    expect(s.ticketsSold).toBe(29);
    expect(s.paidTickets).toBe(0);
    expect(s.guestListEntries).toBe(29);
    expect(s.guestListScanned).toBe(1);
    expect(s.attendance).toBe(1);
    expect(s.hasScanData).toBe(true);
    expect(Math.round(s.showUpRatePct!)).toBe(3);
    expect(s.guestListSharePct).toBe(100);
    expect(s.medianArrivalLabel).not.toBeNull();
    expect(s.timeline.reduce((sum, b) => sum + b.entries, 0)).toBe(1);
  });

  it('billets payés + guest list s’additionnent, part guest list = invités / total', () => {
    const s = computeNightStats(base({
      tickets: [{ quantity: 10, revenue: 200, stripe: 3, createdAt: START - 1, refunded: false, refundAmount: 0, isGuest: false, email: 'a@b.c',
        attendees: Array.from({ length: 10 }, () => ({ scanned: true, scannedAt: START + 60_000, drinkRedeemed: false })) }],
      guestEntries: guests(30, 20),
      capacity: 50,
    }));
    expect(s.ticketsSold).toBe(40);
    expect(s.attendance).toBe(30);
    expect(s.showUpRatePct).toBe(75);
    expect(s.sellThroughPct).toBe(80);
    expect(s.fillPct).toBe(60);
    expect(s.guestListSharePct).toBe(75);
  });

  it('une soirée gratuite pleine peut viser le haut du barème : bar et dépense sortent du score', () => {
    const full = computeNightStats(base({ guestEntries: guests(120, 110), capacity: 120, pageViews: 300, offer: { drinks: false, paid: false } }));
    const asClub = computeNightStats(base({ guestEntries: guests(120, 110), capacity: 120, pageViews: 300, offer: { drinks: true, paid: true } }));
    expect(full.overallScore).toBeGreaterThan(asClub.overallScore);
    expect(full.overallScore).toBeGreaterThanOrEqual(6);
  });

  it('sans guestEntries, le moteur se comporte comme avant', () => {
    const s = computeNightStats(base());
    expect(s.ticketsSold).toBe(0);
    expect(s.attendance).toBe(0);
    expect(s.hasScanData).toBe(false);
    expect(s.showUpRatePct).toBeNull();
  });
});
