import { describe, expect, it } from 'vitest';
import { interpolate, makeFormatters, pluralKey } from '@/crm/i18n';
import { pickLanguage } from '@/i18n/locales/crm/modules';
import type { JrCampaign, JrFilters, Journey } from '@/crm/data/journey';
import { avgConvOf, biggestLoss, campConv, durShort, gapLabel, hasPrevious, pc, spanLabel } from '@/crm/pages/journey/jrLib';

// Le même `T` que useCrmT(), en français, sur le vrai dictionnaire.
const fr = pickLanguage(1);
const fmt = makeFormatters('fr');
const T = {
  ...fmt,
  t: (k: string, v?: Record<string, string | number>) => interpolate(fr[k] ?? k, v),
  tp: (k: string, n: number, v?: Record<string, string | number>) => interpolate(fr[`${k}.${pluralKey('fr', n)}`] ?? k, { n, ...v }),
} as unknown as Parameters<typeof durShort>[0];

const camp = (received: number, buyers: number): JrCampaign => ({
  id: String(received), name: 'c', sent_at: '2026-10-01T16:00:00Z', event_id: null, event_title: null,
  received, opened: 0, clicked: 0, ticket_clicks: 0, buyers, back: 0, revenue: null, within2d: 0,
  buyers_seg: { hab: 0, occ: 0, nou: 0, end: 0, none: 0 },
});

describe('Parcours client : formats', () => {
  it('écrit un pourcentage entier dès 10 %, une décimale en dessous', () => {
    expect(pc(T, 0.163)).toBe('16 %');
    expect(pc(T, 0.087)).toBe('8,7 %');
  });
  it('écrit un délai en heures sous 24 h, en jours au-delà', () => {
    expect(durShort(T, 6.4)).toBe('6 h');
    expect(durShort(T, 0.2)).toBe('1 h');
    expect(durShort(T, 61.32)).toBe('2,6 j');
    expect(durShort(T, 48)).toBe('2 j');
  });
  it('écrit l’écart entre deux pas du fil', () => {
    expect(gapLabel(T, 2 * 60_000)).toBe('+2 min');
    expect(gapLabel(T, 5 * 3_600_000)).toBe('+5 h');
    expect(gapLabel(T, 86_400_000)).toBe('+1 jour');
    expect(gapLabel(T, 8 * 86_400_000)).toBe('+8 jours');
    expect(spanLabel(T, 3 * 86_400_000)).toBe('3 jours');
  });
});

describe('Parcours client : règles de lecture', () => {
  it('désigne la plus grosse perte parmi les trois premières étapes', () => {
    expect(biggestLoss([416, 320, 184, 68, 12])).toBe(2);
    expect(biggestLoss([100, 20, 18, 10, 0])).toBe(0);
    // Le retour (dernière perte) n'est jamais désigné, même plus fort.
    expect(biggestLoss([100, 90, 80, 70, 1])).toBe(2);
  });
  it('ne compare qu’à une période d’avant qui existe', () => {
    const d = { days: 30, prev: [234, 138, 76, 36, 18] } as unknown as Journey;
    const f: JrFilters = { period: '30d', event: null, campaign: null, channel: 'all', seg: 'all', cmp: true };
    expect(hasPrevious(d, f)).toBe(true);
    expect(hasPrevious(d, { ...f, cmp: false })).toBe(false);
    expect(hasPrevious(d, { ...f, campaign: 'x' })).toBe(false);
    expect(hasPrevious({ ...d, days: 365 } as Journey, f)).toBe(false);
    expect(hasPrevious({ ...d, prev: [0, 0, 0, 0, 0] } as Journey, f)).toBe(false);
  });
  it('rapporte les acheteurs aux destinataires, campagne par campagne et en moyenne', () => {
    expect(campConv(camp(132, 21))).toBeCloseTo(0.159, 3);
    expect(campConv(camp(0, 0))).toBe(0);
    expect(avgConvOf([camp(100, 10), camp(300, 10)])).toBe(0.05);
    expect(avgConvOf([])).toBe(0);
  });
});

describe('Parcours client : textes', () => {
  it('a ses clés dans les trois langues', () => {
    const keys = Object.keys(fr).filter((k) => k.startsWith('yc.jr.'));
    expect(keys.length).toBeGreaterThan(150);
    for (const i of [0, 2] as const) {
      const other = pickLanguage(i);
      for (const k of keys) expect(other[k], k).toBeTruthy();
    }
  });
});
