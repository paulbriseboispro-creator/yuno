import { describe, expect, it } from 'vitest';
import {
  bestNight, chartSeries, metricValue, nightDeltas, pillarHasActivity, pillarKpis, pillarsFor,
  type SalesNight, type SalesOverview, type SalesTotals,
} from '../salesOverview';

const totals = (o: Partial<SalesTotals> = {}): SalesTotals => ({
  nights: 4, revenue: 4000, rev_tickets: 1000, rev_tables: 2500, rev_bar: 500, stripe: 80,
  entries: 200, ticket_entries: 120, customers: 150,
  tickets: 150, ticket_orders: 100, ticket_cap: 400, tickets_with_cap: 150,
  tables: 10, table_guests: 60, tables_arrived: 8, bar_orders: 50,
  gl_registered: 100, gl_entered: 70, ...o,
});

const night = (id: string, start: string, o: Partial<SalesNight> = {}): SalesNight => ({
  id, title: id, start_at: start, poster: null,
  revenue: 1000, rev_tickets: 250, rev_tables: 600, rev_bar: 150,
  entries: 50, customers: 40, tickets: 40, ticket_cap: 100, tables: 2, table_guests: 12, tables_arrived: 2,
  bar_orders: 12, gl_registered: 25, gl_entered: 18, ...o,
});

const data = (o: Partial<SalesOverview> = {}): SalesOverview => ({
  ok: true, money: true, has_bar: true, period: 'last4', generated_at: '2026-09-25T10:00:00Z',
  current: totals(), previous: totals({ revenue: 2000, entries: 100, customers: 90 }),
  nights: [], rounds: [], packs: [], products: [], bar_service_min: 6, holders: [], upcoming: null, ...o,
});

describe('salesOverview', () => {
  it('Vue d\'ensemble : CA, entrées, dépense par tête, clients', () => {
    const k = pillarKpis(data(), 'all');
    expect(k.map((x) => x.key)).toEqual(['revenue', 'entries', 'spendPerHead', 'customers']);
    expect(k[2].value).toBe(20);
    expect(k[2].previous).toBe(20);
  });

  it('sans l\'argent, les tuiles de montant sont remplacées', () => {
    const k = pillarKpis(data({ money: false, current: totals({ revenue: undefined }) }), 'all');
    expect(k.some((x) => x.money)).toBe(false);
    expect(k).toHaveLength(4);
  });

  it('remplissage de période sur les soirées qui ont une capacité', () => {
    expect(metricValue(totals(), 'fill')).toBeCloseTo(37.5);
  });

  it('présence guest list', () => {
    expect(metricValue(totals(), 'glPresence')).toBe(70);
  });

  it('temps de service du bar : pas de comparaison', () => {
    const k = pillarKpis(data(), 'bar');
    const svc = k.find((x) => x.key === 'barService')!;
    expect(svc.value).toBe(6);
    expect(svc.previous).toBeNull();
  });

  it('l\'organisateur n\'a pas de bar', () => {
    expect(pillarsFor({ has_bar: false })).not.toContain('bar');
  });

  it('activité par pilier', () => {
    expect(pillarHasActivity(totals({ bar_orders: 0 }), 'bar')).toBe(false);
    expect(pillarHasActivity(totals(), 'tables')).toBe(true);
  });

  it('série : une barre par soirée, dans l\'ordre du temps', () => {
    const s = chartSeries([night('b', '2026-09-20T21:00:00Z'), night('a', '2026-09-13T21:00:00Z')], ['revenue']);
    expect(s.unit).toBe('night');
    expect(s.points.map((p) => p.key)).toEqual(['a', 'b']);
  });

  it('série : regroupée par mois au-delà du plafond, ratios recalculés sur les sommes', () => {
    const ns = [
      night('a', '2026-08-01T21:00:00Z', { revenue: 1000, entries: 10 }),
      night('b', '2026-08-08T21:00:00Z', { revenue: 3000, entries: 90 }),
      night('c', '2026-09-05T21:00:00Z'),
    ];
    const s = chartSeries(ns, ['spendPerHead'], { maxBars: 2 });
    expect(s.unit).toBe('month');
    expect(s.points[0].values.spendPerHead).toBe(40); // 4000 / 100, pas (100 + 33) / 2
  });

  it('meilleure soirée et écart avec la précédente', () => {
    const ns = [night('b', '2026-09-20T21:00:00Z', { revenue: 1500 }), night('a', '2026-09-13T21:00:00Z', { revenue: 1000 })];
    expect(bestNight(ns, 'revenue')?.id).toBe('b');
    expect(nightDeltas(ns, 'revenue').get('b')).toBe(50);
    expect(nightDeltas(ns, 'revenue').get('a')).toBeNull();
    expect(bestNight([ns[0]], 'revenue')).toBeNull();
  });

  it('dépense par tête et présence sur leurs dénominateurs de période', () => {
    // 10 000 € sur 400 entrées des soirées dont on voit l'argent ET scannées,
    // 250 entrées de plus sur une soirée seulement accueillie.
    const t = totals({ revenue: 10000, entries: 650, spend_revenue: 10000, spend_entries: 400,
      gl_registered: 300, gl_entered: 100, gl_presence_registered: 120, gl_presence_entered: 100 });
    expect(metricValue(t, 'spendPerHead')).toBe(25);
    expect(Math.round(metricValue(t, 'glPresence') ?? 0)).toBe(83);
    // Une ligne de soirée reste son propre dénominateur.
    expect(metricValue(night('a', '2026-09-13T21:00:00Z'), 'spendPerHead')).toBe(20);
  });

  it('aucune soirée dont on voit l\'argent : CA et dépense « — », jamais 0 €', () => {
    const t = totals({ revenue: 0, money_nights: 0 });
    expect(metricValue(t, 'revenue')).toBeNull();
    expect(metricValue(t, 'spendPerHead')).toBeNull();
    expect(metricValue(t, 'entries')).toBe(200);
  });

  it('série : pas de valeur = pas de barre, remplissage mensuel sur les soirées à capacité', () => {
    const s1 = chartSeries([night('a', '2026-09-13T21:00:00Z', { ticket_cap: null })], ['fill']);
    expect(s1.points[0].values.fill).toBeNull();
    const ns = [
      night('a', '2026-08-01T21:00:00Z', { tickets: 50, ticket_cap: 100 }),
      night('b', '2026-08-08T21:00:00Z', { tickets: 80, ticket_cap: null }),
      night('c', '2026-09-05T21:00:00Z'),
    ];
    const s = chartSeries(ns, ['fill'], { maxBars: 2 });
    expect(s.points[0].values.fill).toBe(50); // 50 / 100, pas (50 + 80) / 100
  });

  it('série mensuelle : le mois de Paris, pas celui d\'UTC', () => {
    const ns = [
      night('a', '2026-08-31T22:30:00Z'), // 1er septembre, 00 h 30 à Paris
      night('b', '2026-08-10T21:00:00Z'),
      night('c', '2026-09-05T21:00:00Z'),
    ];
    const s = chartSeries(ns, ['revenue'], { maxBars: 2 });
    expect(s.points.map((p) => p.key)).toEqual(['2026-08', '2026-09']);
    expect(s.points[1].values.revenue).toBe(2000);
  });
});
