import { describe, expect, it } from 'vitest';
import { hasCriteria, NIGHT_RELS } from '@/tickets/clients/data/clients';
import { TIXANA_DICT } from '@/i18n/locales/tixana/modules';

const EV = '94ea9bbb-73eb-4f97-8b00-53def4917749';

describe('Clients › vos billets par soirée', () => {
  it('« vue depuis une soirée » et « venu à » comptent comme des critères (Écrire à… ne vise pas toute la base)', () => {
    expect(hasCriteria({ seg: 'all', f: {} })).toBe(false);
    expect(hasCriteria({ seg: 'all', f: { rel: { ev: EV, k: 'back' } } })).toBe(true);
    expect(hasCriteria({ seg: 'all', f: { came: [EV] } })).toBe(true);
    expect(hasCriteria({ seg: 'all', f: { came: [] } })).toBe(false);
  });

  it('les quatre lectures ont leur texte dans les trois langues', () => {
    for (const k of NIGHT_RELS) {
      for (const key of [`ya.na.g.${k}`]) {
        const tr = TIXANA_DICT[key];
        expect(tr, key).toBeDefined();
        expect(tr.every((x) => x.trim().length > 0), key).toBe(true);
      }
    }
    for (const k of ['back', 'held', 'new']) expect(TIXANA_DICT[`ya.na.g.${k}.def`], k).toBeDefined();
  });

  it('chaque pluriel a ses deux formes et chaque clé ses trois langues', () => {
    const keys = Object.keys(TIXANA_DICT).filter((k) => k.startsWith('ya.na.') || k === 'ya.cli.f.came' || k === 'ya.cli.f.came.title');
    expect(keys.length).toBeGreaterThan(20);
    for (const k of keys) expect(TIXANA_DICT[k].length, k).toBe(3);
    for (const base of ['ya.na.people', 'ya.na.tickets', 'ya.na.pool']) {
      expect(TIXANA_DICT[`${base}.one`], base).toBeDefined();
      expect(TIXANA_DICT[`${base}.other`], base).toBeDefined();
    }
  });

  it('le filtre « Place pour » ne se dit plus « A participé à » (il retient les places, venues ou non)', () => {
    expect(TIXANA_DICT['ya.cli.f.ev.title'][0]).toBe('Has a place for');
    expect(TIXANA_DICT['ya.cli.f.ev.title'][1]).toBe('A une place pour');
  });
});
