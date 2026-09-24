import { describe, expect, it } from 'vitest';
import { countdownFor, fillPct, pillarLines, showsRevenue, todayActivity, type EventSales } from '../eventsSales';
import { pickEventId } from '@/hooks/useEventParam';

const base: EventSales = {
  id: 'e1',
  title: 'Night',
  startAt: '2026-09-26T21:00:00Z',
  endAt: '2026-09-27T04:00:00Z',
  poster: null,
  status: 'active',
  isActive: true,
  publishedAt: null,
  dayStart: '2026-09-23T22:00:00Z',
  tickets: { enabled: true, soldOut: false, capacity: 120, sold: 9, today: 6 },
  tables: { enabled: false, soldOut: false, capacity: 8, booked: 0, today: 0, guests: 0 },
  guestList: { enabled: true, soldOut: false, capacity: null, registered: 2, today: 0 },
  drinks: null,
  visits: { total: 60, today: 19 },
  revenue: { total: 0, today: 0, tickets: 0, tables: 0, drinks: 0 },
};

describe('countdownFor', () => {
  it('compte en jours calendaires de Paris, pas en tranches de 24 h', () => {
    // Jeudi 24/09 10 h Paris → samedi 26/09 23 h Paris = J-2.
    expect(countdownFor('2026-09-26T21:00:00Z', '2026-09-27T04:00:00Z', new Date('2026-09-24T08:00:00Z')))
      .toEqual({ kind: 'days', days: 2 });
  });

  it('ce soir, demain, en cours, passé', () => {
    const start = '2026-09-24T21:00:00Z';
    const end = '2026-09-25T04:00:00Z';
    expect(countdownFor(start, end, new Date('2026-09-24T08:00:00Z'))).toEqual({ kind: 'today' });
    expect(countdownFor(start, end, new Date('2026-09-23T21:59:00Z'))).toEqual({ kind: 'tomorrow' });
    expect(countdownFor(start, end, new Date('2026-09-24T23:00:00Z'))).toEqual({ kind: 'live' });
    expect(countdownFor(start, end, new Date('2026-09-25T05:00:00Z'))).toEqual({ kind: 'past' });
  });

  it("un jour change à minuit à Paris, même quand c'est encore la veille en UTC", () => {
    // 23 h 30 UTC le 24 = 1 h 30 le 25 à Paris : la soirée du 25 au soir est « ce soir ».
    expect(countdownFor('2026-09-25T21:00:00Z', '2026-09-26T03:00:00Z', new Date('2026-09-24T23:30:00Z')))
      .toEqual({ kind: 'today' });
  });
});

describe('fillPct', () => {
  it('borne, arrondit, et se tait sans jauge', () => {
    expect(fillPct(9, 120)).toBe(8);
    expect(fillPct(300, 120)).toBe(100);
    expect(fillPct(5, null)).toBeNull();
    expect(fillPct(5, 0)).toBeNull();
  });
});

describe('pillarLines', () => {
  it('garde les piliers ouverts ou qui ont vendu, dans l’ordre billets → tables → guest list', () => {
    const lines = pillarLines(base);
    expect(lines.map((l) => l.key)).toEqual(['tickets', 'guestList']);
    expect(lines[0]).toMatchObject({ count: 9, today: 6, pct: 8 });
    expect(lines[1].pct).toBeNull();
  });

  it('un pilier éteint qui a vendu reste visible', () => {
    const lines = pillarLines({ ...base, tables: { ...base.tables, booked: 2 } });
    expect(lines.map((l) => l.key)).toEqual(['tickets', 'tables', 'guestList']);
  });
});

describe('showsRevenue', () => {
  it('une soirée guest list seule ne montre pas 0 €', () => {
    expect(showsRevenue({ ...base, tickets: { ...base.tickets, enabled: false, sold: 0 } })).toBe(false);
  });
  it('une billetterie ouverte montre son CA, même à 0', () => {
    expect(showsRevenue(base)).toBe(true);
  });
  it('sans droit sur l’argent, jamais', () => {
    expect(showsRevenue({ ...base, revenue: null })).toBe(false);
  });
});

describe('todayActivity', () => {
  it('additionne billets, tables et inscrits du jour', () => {
    expect(todayActivity({ ...base, guestList: { ...base.guestList, today: 3 } })).toBe(9);
  });
});

describe('pickEventId', () => {
  it('n’accepte qu’un uuid', () => {
    expect(pickEventId('AAAAAAAA-0000-0000-0000-000000000001')).toBe('aaaaaaaa-0000-0000-0000-000000000001');
    expect(pickEventId('abc')).toBeNull();
    expect(pickEventId(null)).toBeNull();
  });
});
