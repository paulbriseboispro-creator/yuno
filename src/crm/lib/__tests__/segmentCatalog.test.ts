import { describe, expect, it } from 'vitest';
import { interpolate, makeFormatters } from '@/crm/i18n';
import { pickLanguage } from '@/i18n/locales/crm/modules';
import type { SegmentCatalog } from '@/crm/data/segmentCatalog';
import { hasCriteria } from '@/crm/data/clients';
import {
  CATALOG_ITEMS, DYNAMIC_TEMPLATES, RECOMMENDED, REC_MIN, SEG_GROUPS, SEGMENT_TEMPLATES, areaLabel, criteria, growthIsBad, templateGroup,
} from '../segments';
import { catalogEntries, countryNamer, coveragePct, groupEntries, recommendedEntries, toCreateItems } from '../segmentCatalog';

const LANGS = [pickLanguage(0), pickLanguage(1), pickLanguage(2)];
const fr = LANGS[1];
const fmt = makeFormatters('fr');
const t = (k: string, v?: Record<string, string | number>) => interpolate(fr[k] ?? k, v);
const F = { t, eur: fmt.eur, country: countryNamer('fr') };

const item = (key: string, n: number, extra: Partial<SegmentCatalog['items'][number]> = {}) => ({
  key, n, reachable: Math.floor(n / 2), params: {}, def: CATALOG_ITEMS.find((x) => x.key === key)?.def ?? { seg: 'all' as const, f: {} }, ...extra,
});

const catalog = (over: Partial<SegmentCatalog> = {}): SegmentCatalog => ({
  total: 2650, reachable: 2020, payers: 1298,
  coverage: { age: 1373, gender: 1394, area: 2310, country: 1969 },
  home: 'FR', has_next_event: true, has_messages: true,
  items: [
    item('freq_loyal', 696), item('once', 380), item('loin', 4), item('winback', 0),
    item('regulars_no_ticket', 528), item('buyers', 1298), item('vip', 120),
    item('gl_loyal', 40), item('clicked_no_buy', 55),
    item('spend_top', 145, { params: { threshold: 170 }, def: { seg: 'all', f: { sp_min: 170 } } }),
    item('geo_area:boulogne billancourt', 203, { params: { area: 'Boulogne-Billancourt' }, def: { seg: 'all', f: { area: ['boulogne billancourt'] } } }),
    item('geo_abroad', 3, { params: { home: 'FR' }, def: { seg: 'all', f: { country_not: 'FR' } } }),
    item('geo_country:es', 31, { params: { code: 'ES' }, def: { seg: 'all', f: { country: ['ES'] } } }),
  ],
  existing: ['once'],
  ...over,
});

describe('Catalogue de segments : textes', () => {
  it('chaque modèle fixe et calculé a un nom et une règle dans les trois langues', () => {
    const bases = [...SEGMENT_TEMPLATES.map((x) => x.id), ...Object.keys(DYNAMIC_TEMPLATES)];
    for (const d of LANGS) for (const b of bases) {
      expect(d[`yc.seg.tpl.${b}.name`], b).toBeTruthy();
      expect(d[`yc.seg.tpl.${b}.rule`], b).toBeTruthy();
    }
  });
  it('chaque famille a un titre et un sous-titre ; chaque recommandation, une idée d’envoi', () => {
    for (const d of LANGS) {
      for (const g of SEG_GROUPS) { expect(d[`yc.segcat.g.${g}`]).toBeTruthy(); expect(d[`yc.segcat.g.${g}.s`]).toBeTruthy(); }
      for (const r of RECOMMENDED) expect(d[`yc.segcat.idea.${r}`], r).toBeTruthy();
    }
  });
  it('les neuf modèles d’avant gardent leur identifiant (un segment créé garde son template)', () => {
    const ids = SEGMENT_TEMPLATES.map((x) => x.id);
    for (const id of ['vip', 'loin', 'once', 'recent', 'sms', 'never_clicked', 'clicked_no_buy', 'small_spend', 'page']) expect(ids).toContain(id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('nomme les modèles calculés avec leur seuil, leur ville et leur pays', () => {
    const e = catalogEntries(catalog(), F);
    expect(e.find((x) => x.key === 'spend_top')?.name).toBe('Meilleurs clients (top 10 %)');
    expect(e.find((x) => x.key === 'spend_top')?.rule).toContain('170 €');
    expect(e.find((x) => x.key === 'geo_area:boulogne billancourt')?.name).toBe('Clients · Boulogne-Billancourt');
    expect(e.find((x) => x.key === 'geo_country:es')?.name).toBe('Clients · Espagne');
  });
});

describe('Catalogue de segments : recommandations', () => {
  const e = catalogEntries(catalog(), F);

  it('recommande à partir de 10 personnes, jamais un modèle déjà créé', () => {
    const rec = recommendedEntries(e).map((x) => x.key);
    expect(rec).not.toContain('once'); // déjà créé
    expect(rec).not.toContain('loin'); // 4 personnes
    expect(rec).not.toContain('winback'); // personne
    expect(rec).not.toContain('freq_loyal'); // pas un modèle recommandé
    expect(rec).toEqual(['regulars_no_ticket', 'spend_top', 'clicked_no_buy', 'gl_loyal']);
    expect(e.find((x) => x.key === 'loin')?.idea).toBeTruthy();
    expect(REC_MIN).toBe(10);
  });
  it('sans soirée à venir, « Prochaine soirée » est indisponible et jamais recommandée', () => {
    const e2 = catalogEntries(catalog({ has_next_event: false }), F);
    const r = e2.find((x) => x.key === 'regulars_no_ticket');
    expect(r?.disabled).toBe('noNext');
    expect(r?.rec).toBe(false);
  });
  it('tait « À l’étranger » sous 10 personnes', () => {
    expect(e.some((x) => x.key === 'geo_abroad')).toBe(false);
  });
  it('range par famille ; dans « Dépense », le seuil calculé passe avant les montants fixes', () => {
    const g = groupEntries(e);
    expect(g.map((x) => x.group)).toEqual(['loyalty', 'next', 'spend', 'guest', 'messages', 'geo']);
    expect(g.find((x) => x.group === 'spend')?.entries.map((x) => x.key)).toEqual(['spend_top', 'buyers', 'vip']);
  });
  it('ne crée que les modèles cochables, nommés dans la langue du pro', () => {
    const items = toCreateItems(e, ['once', 'spend_top', 'geo_country:es', 'inconnu']);
    expect(items.map((x) => x.template)).toEqual(['spend_top', 'geo_country:es']);
    expect(items[0]).toMatchObject({ name: 'Meilleurs clients (top 10 %)', definition: { seg: 'all', f: { sp_min: 170 } } });
    expect(items[0].description).toContain('170 €');
  });
  it('mesure la couverture d’une donnée en points', () => {
    expect(coveragePct(1373, 2650)).toBe(52);
    expect(coveragePct(0, 0)).toBeNull();
  });
});

describe('Catalogue de segments : critères et familles', () => {
  it('rattache une clé calculée à sa famille', () => {
    expect(templateGroup('geo_area:saint denis')).toBe('geo');
    expect(templateGroup('spend_top')).toBe('spend');
    expect(templateGroup('gl_loyal')).toBe('guest');
    expect(templateGroup('inconnu')).toBeNull();
  });
  it('dit les nouveaux critères en pastilles', () => {
    const c = criteria({ seg: 'hab', f: { nb_min: 2, nb_max: 3, age_min: 18, age_max: 21, gender: 'female', area: ['saint denis'], country_not: 'FR', up: 'no', sp_min: 170, ch: 'both', last_lt_days: 90 } }, t);
    const txt = c.map((x) => `${x.k}=${x.v}`);
    expect(txt).toContain('Soirées faites=2 à 3');
    expect(txt).toContain('Âge=18 à 21');
    expect(txt).toContain('Genre=femme');
    expect(txt).toContain('Ville=Saint Denis');
    expect(txt).toContain('Pays=autre que FR');
    expect(txt).toContain('Prochaine soirée=pas encore de place');
    expect(txt).toContain('Total dépensé=170 € ou plus');
    expect(txt).toContain('Dernière visite=il y a moins de 3 mois');
  });
  it('une ville lisible depuis sa clé', () => {
    expect(areaLabel('boulogne billancourt')).toBe('Boulogne Billancourt');
  });
  it('la croissance des segments « à reconquérir » est une mauvaise nouvelle', () => {
    expect(growthIsBad({ key: 'x', kind: 'custom', template: 'winback' })).toBe(true);
    expect(growthIsBad({ key: 'x', kind: 'custom', template: 'geo_area:paris' })).toBe(false);
    expect(growthIsBad({ key: 'x', kind: 'custom', template: 'spend_top' })).toBe(false);
  });
});

describe('hasCriteria : un segment enregistré n’est jamais « toute la base »', () => {
  it('compte un critère que la liste Clients ne dessine pas', () => {
    expect(hasCriteria({ seg: 'all', f: { msg: 'never_clicked' } })).toBe(true);
    expect(hasCriteria({ seg: 'all', f: { age_min: 18 } })).toBe(true);
    expect(hasCriteria({ seg: 'all', f: { area: [] } })).toBe(false);
    expect(hasCriteria({ seg: 'all', f: { last: '' } })).toBe(false);
    expect(hasCriteria({ seg: 'all', f: {}, q: ' ' })).toBe(false);
    expect(hasCriteria({ seg: 'end', f: {} })).toBe(true);
  });
});
