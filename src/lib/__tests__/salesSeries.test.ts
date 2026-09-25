import { describe, expect, it } from 'vitest';
import { buildSalesSeries } from '../salesSeries';

describe('buildSalesSeries', () => {
  it('comble les jours sans vente et additionne les piliers', () => {
    const s = buildSalesSeries(
      {
        tickets: [{ date: '2026-09-20', revenue: 24 }],
        tables: [{ date: '2026-09-20', revenue: 100 }, { date: '2026-09-22', revenue: 197 }],
      },
      '2026-09-18',
      '2026-09-24',
    );
    expect(s.unit).toBe('day');
    expect(s.points.map((p) => p.key)).toEqual([
      '2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24',
    ]);
    expect(s.points[2]).toEqual({ key: '2026-09-20', tickets: 24, tables: 100, drinks: 0, total: 124 });
    expect(s.points[4].total).toBe(197);
    expect(s.points.reduce((a, p) => a + p.total, 0)).toBe(321);
  });

  it('ignore ce qui tombe hors période', () => {
    const s = buildSalesSeries({ drinks: [{ date: '2026-09-01', revenue: 50 }] }, '2026-09-20', '2026-09-21');
    expect(s.points.reduce((a, p) => a + p.total, 0)).toBe(0);
  });

  it('passe au mois au-delà de trois mois (« tout le temps »)', () => {
    const s = buildSalesSeries(
      { tickets: [{ date: '2026-05-04', revenue: 10 }, { date: '2026-05-20', revenue: 5 }, { date: '2026-09-24', revenue: 1 }] },
      null,
      '2026-09-24',
    );
    expect(s.unit).toBe('month');
    expect(s.points.map((p) => p.key)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
    expect(s.points[0].tickets).toBe(15);
  });

  it('sans vente ni début, rend le seul jour de fin', () => {
    const s = buildSalesSeries({}, null, '2026-09-24');
    expect(s.points).toHaveLength(1);
    expect(s.points[0].total).toBe(0);
  });
});
