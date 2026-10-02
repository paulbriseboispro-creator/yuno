import { describe, it, expect } from 'vitest';
import { cumulativeCurve, curveWindow, soldBy, daysUntil, newBuyersShare } from '../crm';

describe('courbe J-N cumulée', () => {
  it('cumule de J-max à J-0 et garde le total les jours sans vente', () => {
    const c = cumulativeCurve([{ d: 3, tickets: 2 }, { d: 1, tickets: 5 }, { d: 0, tickets: 1 }], 4);
    expect(c).toEqual([
      { d: 4, total: 0 }, { d: 3, total: 2 }, { d: 2, total: 2 }, { d: 1, total: 7 }, { d: 0, total: 8 },
    ]);
  });

  it('les ventes plus anciennes que la fenêtre entrent dans le premier point', () => {
    const c = cumulativeCurve([{ d: 40, tickets: 10 }, { d: 2, tickets: 1 }], 7);
    expect(c[0]).toEqual({ d: 7, total: 10 });
    expect(c[c.length - 1]).toEqual({ d: 0, total: 11 });
  });

  it('fenêtre = première vente, entre 7 et 60 jours', () => {
    expect(curveWindow([{ d: 3, tickets: 1 }])).toBe(7);
    expect(curveWindow([{ d: 21, tickets: 1 }], [{ d: 30, tickets: 0 }])).toBe(21);
    expect(curveWindow([{ d: 120, tickets: 1 }])).toBe(60);
    expect(curveWindow(null, undefined)).toBe(7);
  });
});

describe('comparaison au même moment', () => {
  it('compte ce qui était vendu à J-d ou avant', () => {
    const pts = [{ d: 10, tickets: 4 }, { d: 5, tickets: 3 }, { d: 0, tickets: 9 }];
    expect(soldBy(pts, 5)).toBe(7);
    expect(soldBy(pts, 0)).toBe(16);
    expect(soldBy(pts, 11)).toBe(0);
  });
});

describe('jours avant la soirée', () => {
  it('compte en jours calendaires du fuseau, pas en tranches de 24 h', () => {
    const now = new Date('2026-10-02T22:30:00Z'); // 00:30 le 3 à Paris
    expect(daysUntil('2026-10-03T21:00:00Z', now)).toBe(0);
    expect(daysUntil('2026-10-05T21:00:00Z', now)).toBe(2);
    expect(daysUntil('2026-10-01T21:00:00Z', now)).toBe(-2);
  });
});

describe('part de nouveaux acheteurs', () => {
  it('se tait sous 10 acheteurs', () => {
    expect(newBuyersShare(3, 9)).toBeNull();
    expect(newBuyersShare(4, 10)).toBe(40);
  });
});
