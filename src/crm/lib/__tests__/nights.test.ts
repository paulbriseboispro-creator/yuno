import { describe, expect, it } from 'vitest';
import type { NightRow } from '@/crm/data/nights';
import { daysUntil, deltaPct, lacksMessage, pastKind, pickMessage, seriesChips, splitPeriods, totals, upKind } from '../nights';

const night = (o: Partial<NightRow>): NightRow => ({
  id: 'x', title: 'Soirée', series: 'Soirée', start_at: '2026-10-10T21:00:00Z', end_at: '2026-10-11T03:00:00Z', tz: 'Europe/Paris',
  url: null, cover_url: null, street: null, city: null, lineup: [], upcoming: true, sale_opens_at: null,
  sold: 0, cap: null, sold_out: false, revenue: 0, buyers: 0, new_buyers: 0, today: 0, tiers: null, msgs: null, ...o,
});

describe('upKind', () => {
  const now = Date.parse('2026-10-04T12:00:00Z');
  it('complet avant tout le reste', () => {
    expect(upKind(night({ sold: 400, cap: 400 }), now)).toBe('full');
    expect(upKind(night({ sold: 10, cap: null, sold_out: true }), now)).toBe('full');
  });
  it('pas encore en vente seulement sans vente', () => {
    expect(upKind(night({ sale_opens_at: '2026-10-10T10:00:00Z' }), now)).toBe('soon');
    expect(upKind(night({ sale_opens_at: '2026-10-10T10:00:00Z', sold: 3, cap: 100 }), now)).toBe('sale');
  });
  it('presque complet dès 80 %, en vente sinon ou sans jauge', () => {
    expect(upKind(night({ sold: 80, cap: 100 }), now)).toBe('almost');
    expect(upKind(night({ sold: 79, cap: 100 }), now)).toBe('sale');
    expect(upKind(night({ sold: 79, cap: null }), now)).toBe('sale');
  });
});

describe('pastKind', () => {
  it('suit les seuils de la maquette', () => {
    expect(pastKind(night({ sold: 100, cap: 100 }))).toBe('full');
    expect(pastKind(night({ sold: 75, cap: 100 }))).toBe('good');
    expect(pastKind(night({ sold: 55, cap: 100 }))).toBe('fair');
    expect(pastKind(night({ sold: 54, cap: 100 }))).toBe('low');
    expect(pastKind(night({ sold: 54, cap: null }))).toBe('unknown');
  });
});

describe('messages', () => {
  it('brouillon, puis planifié, puis le dernier envoyé', () => {
    const msgs = [{ state: 'sent', id: 'a' }, { state: 'plan', id: 'b' }, { state: 'draft', id: 'c' }];
    expect(pickMessage(msgs)?.id).toBe('c');
    expect(pickMessage(msgs.slice(0, 2))?.id).toBe('b');
    expect(pickMessage([])).toBeNull();
  });
  it('« rien de prévu » ne vise pas une soirée complète', () => {
    expect(lacksMessage(night({ msgs: [] }), 'sale')).toBe(true);
    expect(lacksMessage(night({ msgs: [] }), 'full')).toBe(false);
  });
});

describe('périodes, séries, totaux', () => {
  const now = new Date('2026-10-04T12:00:00Z');
  const past = [
    night({ id: 'a', series: 'Warehouse Session', start_at: '2026-09-19T21:00:00Z', sold: 90, cap: 100, revenue: 1000 }),
    night({ id: 'b', series: 'Warehouse Session', start_at: '2026-08-01T21:00:00Z', sold: 50, cap: null, revenue: 500 }),
    night({ id: 'c', series: 'Deep Night', start_at: '2026-03-01T21:00:00Z', sold: 40, cap: 80, revenue: 400 }),
    night({ id: 'd', series: 'Deep Night', start_at: '2025-09-01T21:00:00Z', sold: 40, cap: 80, revenue: 400 }),
  ];
  it('sépare la période et la même durée juste avant', () => {
    const { inW, prevW } = splitPeriods(past, 6, now);
    expect(inW.map((n) => n.id)).toEqual(['a', 'b']);
    expect(prevW.map((n) => n.id)).toEqual(['c']);
  });
  it('ne propose que les séries qui reviennent', () => {
    expect(seriesChips(past)).toEqual([
      { key: 'warehouse session', label: 'Warehouse Session', n: 2 },
      { key: 'deep night', label: 'Deep Night', n: 2 },
    ]);
    expect(seriesChips(past.slice(0, 1))).toEqual([]);
  });
  it('le remplissage ne compte que les soirées à capacité connue', () => {
    const tt = totals(past.slice(0, 2));
    expect(tt).toMatchObject({ nights: 2, sold: 140, cap: 100, capKnown: 1, revenue: 1500 });
    expect(tt.fill).toBeCloseTo(0.9);
  });
  it('pas d’écart sous 3 soirées de comparaison', () => {
    expect(deltaPct(120, 100, 2)).toBeNull();
    expect(deltaPct(120, 100, 3)).toBeCloseTo(20);
  });
});

describe('daysUntil', () => {
  it('compte en jours calendaires du fuseau de la soirée', () => {
    expect(daysUntil('2026-10-10T21:00:00Z', 'Europe/Paris', new Date('2026-10-04T12:00:00Z'))).toBe(6);
    // 23 h 30 à Paris le 10 = 21 h 30 UTC : c'est « ce soir » vu du 10 à midi.
    expect(daysUntil('2026-10-10T21:30:00Z', 'Europe/Paris', new Date('2026-10-10T10:00:00Z'))).toBe(0);
    // Soirée du samedi 23 h, il est 1 h du matin dimanche à Paris : elle a commencé hier.
    expect(daysUntil('2026-10-10T21:00:00Z', 'Europe/Paris', new Date('2026-10-10T23:30:00Z'))).toBe(-1);
  });
});
