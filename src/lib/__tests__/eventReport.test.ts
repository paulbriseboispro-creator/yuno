import { describe, expect, it } from 'vitest';
import { availableMetrics, buildCurve, compareAtSameD, conversionPct, paceProjection, referenceFor, reportHasActivity, reportHeadline, share, targetStatus, todayD, type EventReport } from '../eventReport';

function report(over: Partial<EventReport> & { series: EventReport['series'] }, startAt = '2026-09-26T21:00:00Z', now = '2026-09-24T10:00:00Z'): EventReport {
  return {
    ok: true, now, tz: 'Europe/Paris', dayStart: now, money: true, scope: 'venue',
    event: { id: 'e', title: 'Night', startAt, endAt: '2026-09-27T04:00:00Z', poster: null, status: 'active', cancelled: false, publishedAt: null, createdAt: now, venueName: null, phase: 'before' },
    totals: {
      tickets: { sold: 9, today: 6, orders: 5, capacity: 120, enabled: true, soldOut: false },
      tables: { booked: 0, today: 0, guests: 0, capacity: null, enabled: false, soldOut: false },
      guestList: { registered: 2, today: 0, capacity: null, enabled: true, soldOut: false },
      drinks: null,
      revenue: { total: 0, today: 0, tickets: 0, tables: 0, drinks: 0 },
      visits: { total: 60, today: 19, withOrder: 6 },
    },
    lines: [], visitSources: [], audience: { people: 0, returning: 0, new: 0, buyers: 0, priorEvents: 0 },
    channels: [], links: [], messages: [],
    ...over,
  };
}

const day = (d: number, tickets: number, amount = 0) => ({ d, tickets, tables: 0, guests: 0, amount, visits: 0 });

describe('todayD', () => {
  it('compte les jours calendaires du fuseau de la soirée', () => {
    expect(todayD(report({ series: [] }))).toBe(2);
    expect(todayD(report({ series: [] }, '2026-09-26T21:00:00Z', '2026-09-28T10:00:00Z'))).toBe(-2);
  });
});

describe('buildCurve', () => {
  it('cumule, aligne deux soirées sur J-N, et ne dessine pas le futur', () => {
    const main = report({ series: [day(5, 2), day(2, 6)] });
    const cmp = report({ series: [day(6, 1), day(4, 3), day(1, 10), day(0, 5)] }, '2026-09-12T21:00:00Z', '2026-09-20T10:00:00Z');
    const pts = buildCurve(main, cmp, 'tickets');
    expect(pts[0].d).toBe(6);
    const at = (d: number) => pts.find((p) => p.d === d)!;
    expect(at(5).main).toBe(2);
    expect(at(2).main).toBe(8);
    expect(at(1).main).toBeNull(); // demain : pas encore vécu
    expect(at(2).compare).toBe(4);
    expect(at(0).compare).toBe(19);
    expect(pts[pts.length - 1].d).toBe(-1);
  });

  it('par jour quand on ne cumule pas', () => {
    const main = report({ series: [day(3, 2), day(2, 6)] });
    const pts = buildCurve(main, null, 'tickets', false);
    expect(pts.find((p) => p.d === 2)!.main).toBe(6);
    expect(pts.every((p) => p.compare === null)).toBe(true);
  });

  it('les ventes d’avant J-90 entrent dans le point de départ', () => {
    const main = report({ series: [day(120, 7), day(3, 1)] });
    const pts = buildCurve(main, null, 'tickets');
    expect(pts[0].d).toBe(90);
    expect(pts[0].main).toBe(7);
  });

  it('rien à dessiner sans activité', () => {
    expect(buildCurve(report({ series: [] }), null, 'tickets')).toEqual([]);
  });
});

describe('compareAtSameD', () => {
  it('compare au même J-N qu’aujourd’hui', () => {
    const main = report({ series: [day(5, 2), day(2, 6)] });
    const cmp = report({ series: [day(6, 1), day(4, 3), day(1, 10)] });
    expect(compareAtSameD(main, cmp, 'tickets')).toEqual({ main: 8, compare: 4 });
  });
});

describe('availableMetrics', () => {
  it('pas de CA sur une soirée qui n’a rien encaissé, les visites toujours', () => {
    expect(availableMetrics(report({ series: [] }))).toEqual(['tickets', 'guests', 'visits']);
  });
});

describe('share / conversionPct', () => {
  it('arrondit et se tait sans base', () => {
    expect(share(1, 3)).toBe(33);
    expect(share(1, 0)).toBeNull();
    expect(conversionPct(6, 60)).toBe(10);
    expect(conversionPct(1, 0)).toBeNull();
  });
});

describe('reportHeadline', () => {
  it('une soirée sans aucune activité ne se note pas : elle est vide', () => {
    const r = report({
      series: [],
      totals: {
        tickets: { sold: 0, today: 0, orders: 0, capacity: 650, enabled: true, soldOut: false },
        tables: { booked: 0, today: 0, guests: 0, capacity: 4, enabled: true, soldOut: false },
        guestList: { registered: 0, today: 0, capacity: 127, enabled: true, soldOut: false },
        drinks: null, revenue: { total: 0, today: 0, tickets: 0, tables: 0, drinks: 0 },
        visits: { total: 0, today: 0, withOrder: 0 },
      },
    });
    expect(reportHasActivity(r)).toBe(false);
    expect(reportHeadline(r, null).kind).toBe('empty');
  });

  it('pendant la vente : billets vendus et référence au même J-N', () => {
    const main = report({ series: [day(5, 2), day(2, 6)] });
    const cmp = report({ series: [day(6, 1), day(4, 3), day(1, 10)] }, '2026-09-12T21:00:00Z', '2026-09-20T10:00:00Z');
    const h = reportHeadline(main, cmp);
    expect(h).toMatchObject({ kind: 'selling', pillar: 'tickets', sold: 9, daysBefore: 2, reference: 4 });
  });

  it('après la soirée : la porte, et les entrées de la référence', () => {
    const after = { ...report({ series: [] }, '2026-09-20T21:00:00Z', '2026-09-24T10:00:00Z') };
    after.event = { ...after.event, phase: 'after' };
    after.totals = { ...after.totals, door: { entered: 80, expected: 100 } };
    const ref = { ...after, totals: { ...after.totals, door: { entered: 60, expected: 90 } } };
    expect(reportHeadline(after, ref)).toMatchObject({ kind: 'after', entered: 80, expected: 100, reference: 60 });
    expect(referenceFor(after, ref, 'tickets')).toBe(9);
  });
});

describe('objectif et rythme', () => {
  const ppl = (d: number, people: number) => ({ d, tickets: people, tables: 0, guests: 0, amount: 0, visits: 0, people });
  // Soirée dans 2 jours (J-2), 60 attendus aujourd'hui.
  const main = () => {
    const r = report({ series: [ppl(10, 20), ppl(3, 40)] });
    r.totals = { ...r.totals, door: { entered: 0, expected: 60 } };
    return r;
  };
  // Référence passée : 100 attendus au total, 40 déjà là à J-2 (d ≥ 2).
  const ref = () => {
    const r = report({ series: [ppl(9, 10), ppl(4, 30), ppl(1, 20), ppl(0, 40)] }, '2026-09-12T21:00:00Z', '2026-09-24T10:00:00Z');
    r.event = { ...r.event, phase: 'after' };
    return r;
  };

  it('projette au rythme de la référence', () => {
    // 60 attendus / (40 / 100) = 150
    expect(paceProjection(main(), ref())).toEqual({ projected: 150, refTitle: 'Night' });
  });

  it('sans soirée comparée terminée, prend la référence choisie serveur', () => {
    const r = main();
    r.pace = { refId: 'x', refTitle: 'The Revival', d: 2, final: 448, atSameD: 262 };
    // 60 / (262 / 448) ≈ 102,6
    expect(paceProjection(r, null)).toEqual({ projected: 103, refTitle: 'The Revival' });
  });

  it('se tait sans référence terminée, ou trop mince', () => {
    const live = ref(); live.event = { ...live.event, phase: 'before' };
    expect(paceProjection(main(), live)).toBeNull();
    expect(paceProjection(main(), null)).toBeNull();
    const thin = report({ series: [ppl(4, 5), ppl(0, 10)] }, '2026-09-12T21:00:00Z');
    thin.event = { ...thin.event, phase: 'after' };
    expect(paceProjection(main(), thin)).toBeNull();
  });

  it('mesure les attendus avant, les entrées après', () => {
    expect(targetStatus(main(), ref(), 200)).toEqual({ kind: 'progress', target: 200, current: 60, measure: 'expected', pace: { projected: 150, refTitle: 'Night' } });
    const after = ref(); after.totals = { ...after.totals, door: { entered: 77, expected: 100 } };
    expect(targetStatus(after, null, 90)).toMatchObject({ current: 77, measure: 'entered', pace: null });
    expect(targetStatus(main(), null, null)).toEqual({ kind: 'none' });
  });
});
