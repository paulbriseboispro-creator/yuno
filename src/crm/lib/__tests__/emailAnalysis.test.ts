import { describe, expect, it } from 'vitest';
import { bestSlot, kindStats, metricOf, personalOpen, slotGrid, subjectBuckets, trend, type Campaign } from '../emailAnalysis';

const camp = (p: Partial<Campaign>): Campaign => ({
  id: 'x', name: 'x', subject: 'x', sent_at: '2026-10-01T16:00:00Z', kind: null, n: 100, received: 100,
  opened: 50, clicked: 20, purchases: 2, revenue: 20, bounced: 0, complained: 0, unsub: 0, ...p,
});

describe('metricOf', () => {
  it('ouvertures et clics sur les reçus, achats pour 1 000 envoyés', () => {
    const c = camp({ n: 200, received: 180, opened: 90, clicked: 36, purchases: 4 });
    expect(metricOf(c, 'or')).toBeCloseTo(0.5);
    expect(metricOf(c, 'cr')).toBeCloseTo(0.2);
    expect(metricOf(c, 'bp')).toBeCloseTo(20);
  });
  it('rien reçu = 0, jamais NaN', () => {
    expect(metricOf(camp({ n: 0, received: 0 }), 'or')).toBe(0);
    expect(metricOf(camp({ n: 0, received: 0 }), 'bp')).toBe(0);
  });
});

describe('trend', () => {
  it('moitié récente contre moitié ancienne', () => {
    expect(trend([1, 1, 2, 2])).toBeCloseTo(1);
    expect(trend([2, 2, 1, 1, 1])).toBeCloseTo(-0.5);
  });
  it('se tait sous 4 campagnes ou sur une base nulle', () => {
    expect(trend([1, 2, 3])).toBeNull();
    expect(trend([0, 0, 1, 1])).toBeNull();
  });
});

describe('bestSlot', () => {
  const grid = [
    { d: 3, h: 5, n: 550, clicked: 145 },
    { d: 6, h: 5, n: 370, clicked: 139 },
    { d: 0, h: 5, n: 35, clicked: 20 },
  ];
  it('le meilleur taux parmi les cases assez fournies', () => {
    const { best, avg } = bestSlot(grid);
    expect(best?.d).toBe(6);
    expect(avg).toBeCloseTo(304 / 955);
  });
  it('une case mince est montrée mais jamais « meilleure »', () => {
    const cells = slotGrid(grid);
    expect(cells[0 * 8 + 5]?.low).toBe(true);
    expect(cells.filter(Boolean)).toHaveLength(3);
    expect(bestSlot([{ d: 0, h: 0, n: 20, clicked: 10 }]).best).toBeNull();
  });
});

describe('kindStats', () => {
  it('regroupe par modèle, classe par achats pour 1 000', () => {
    const k = kindStats([
      camp({ kind: 'annonce', n: 100, purchases: 1 }),
      camp({ kind: 'annonce', n: 100, purchases: 3 }),
      camp({ kind: 'lineup', n: 100, purchases: 5 }),
      camp({ kind: null, n: 50, purchases: 0 }),
    ]);
    expect(k.map((x) => x.kind)).toEqual(['lineup', 'annonce', 'autre']);
    expect(k[1].perK).toBeCloseTo(20);
    expect(k[1].campaigns).toBe(2);
  });
});

describe('objets', () => {
  it('quatre longueurs, vides à null', () => {
    const b = subjectBuckets([{ b: 1, campaigns: 2, received: 200, opened: 100 }]);
    expect(b[0]).toBeNull();
    expect(b[1]?.rate).toBeCloseTo(0.5);
  });
  it('au prénom contre sans, seulement si les deux existent', () => {
    expect(personalOpen([camp({ subject: '{{prénom}}, salut', opened: 60 }), camp({ subject: 'Salut', opened: 40 })]))
      .toEqual({ with: 0.6, without: 0.4 });
    expect(personalOpen([camp({ subject: 'Salut' })])).toBeNull();
  });
});
