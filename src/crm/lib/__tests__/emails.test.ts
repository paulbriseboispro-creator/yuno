import { describe, expect, it } from 'vitest';
import { audienceLabel, cleanLink, delta, draftGaps, perK, rate, shortName } from '../emails';

const t = (k: string) => ({ 'yc.em.aud.all': 'Toute la base', 'yc.em.aud.custom': 'Sélection', 'yc.cli.seg.hab': 'Habitués', 'yc.cli.seg.nou': 'Nouveaux' } as Record<string, string>)[k] ?? k;

describe('taux et écarts', () => {
  it('rend null sans dénominateur', () => {
    expect(rate(3, 0)).toBeNull();
    expect(rate(1, 4)).toBe(0.25);
    expect(perK({ purchases: 61, n: 6040 })).toBeCloseTo(10.1, 1);
  });
  it('écart en points pour un taux, en % pour une quantité', () => {
    expect(delta(0.5, 0.435, 'pt')).toEqual({ v: expect.closeTo(6.5, 5), up: true });
    expect(delta(6780, 2230, 'pct')?.v).toBeCloseTo(204, 0);
    expect(delta(10, 0, 'pct')).toBeNull();
  });
});

describe('audience', () => {
  it('nomme les segments, garde le libellé donné, dédoublonne', () => {
    expect(audienceLabel([{ kind: 'crm', def: { seg: 'hab', f: {} } }, { kind: 'crm', def: { seg: 'nou', f: {} } }], t)).toBe('Habitués + Nouveaux');
    expect(audienceLabel([{ kind: 'crm', def: { seg: 'all', f: {} } }], t)).toBe('Toute la base');
    expect(audienceLabel([{ kind: 'crm', def: { seg: 'all', f: { ev: ['x'] } } }], t)).toBe('Sélection');
    expect(audienceLabel([{ kind: 'crm', label: '55 acheteurs de X' }], t)).toBe('55 acheteurs de X');
    expect(audienceLabel([], t)).toBeNull();
    expect(audienceLabel([{ kind: 'import', importId: 'z' }], t)).toBeNull();
  });
  it('liste ce qu’il manque à un brouillon', () => {
    expect(draftGaps({ subject: ' ', audiences: [], has_content: false })).toEqual(['subject', 'audience', 'content']);
    expect(draftGaps({ subject: 'Ok', audiences: [{ kind: 'crm', def: { seg: 'all' } }], has_content: true })).toEqual([]);
  });
});

describe('textes', () => {
  it('tronque et nettoie', () => {
    expect(shortName('Nouveautés de la rentrée au Bunker', 20)).toBe('Nouveautés de la r…');
    expect(cleanLink('https://shotgun.live/events/x/?yc=abc&utm_source=yuno&ref=2')).toBe('shotgun.live/events/x/?ref=2');
  });
});
