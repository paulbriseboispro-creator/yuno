import { describe, expect, it } from 'vitest';
import { interpolate, makeFormatters } from '@/crm/i18n';
import { pickLanguage } from '@/i18n/locales/tixana/modules';
import type { SegmentCatalog } from '@/tickets/clients/data/segmentCatalog';
import {
  CATALOG_ITEMS, DYNAMIC_TEMPLATES, RECOMMENDED, SEG_GROUPS, SEGMENT_TEMPLATES, criteria, templateGroup,
} from '../segments';
import { catalogEntries, countryNamer, recommendedEntries } from '../segmentCatalog';

const LANGS = [pickLanguage(0), pickLanguage(1), pickLanguage(2)];
const fr = LANGS[1];
const fmt = makeFormatters('fr');
const t = (k: string, v?: Record<string, string | number>) => interpolate(fr[k] ?? k, v);
const F = { t, eur: fmt.eur, country: countryNamer('fr') };

describe('Yuno Tickets › Segments : le catalogue', () => {
  it('chaque modèle fixe et calculé a un nom et une règle dans les trois langues', () => {
    const bases = [...SEGMENT_TEMPLATES.map((x) => x.id), ...Object.keys(DYNAMIC_TEMPLATES)];
    for (const b of bases) {
      for (const L of LANGS) {
        expect(L[`ya.seg.tpl.${b}.name`], `${b}.name`).toBeTruthy();
        expect(L[`ya.seg.tpl.${b}.rule`], `${b}.rule`).toBeTruthy();
      }
    }
  });

  it('chaque famille a son titre dans les trois langues', () => {
    for (const g of SEG_GROUPS) for (const L of LANGS) expect(L[`ya.segcat.g.${g}`], g).toBeTruthy();
  });

  it("n'a ni « Ce qui fait venir » ni pages d'inscription (moteurs du CRM)", () => {
    expect(SEG_GROUPS as string[]).not.toContain('why');
    expect(SEGMENT_TEMPLATES.some((x) => x.id.startsWith('why_') || x.id === 'page' || x.id === 'src_utm')).toBe(false);
    expect(RECOMMENDED.some((x) => x.startsWith('why_'))).toBe(false);
    // Les sources sont celles de Yuno Tickets (_tix_filter_sql).
    for (const x of SEGMENT_TEMPLATES) for (const s of x.def.f?.src ?? []) expect(['yuno', 'import', 'other']).toContain(s);
  });

  it('les recommandations ne dépendent que de l’effectif et de la prochaine soirée', () => {
    const cat: SegmentCatalog = {
      total: 300, reachable: 200, payers: 120,
      coverage: { age: 0, gender: 0, area: 0, country: 0 }, home: null,
      has_next_event: false, has_messages: false,
      items: [
        { key: 'regulars_no_ticket', n: 40, reachable: 20, params: {}, def: CATALOG_ITEMS.find((x) => x.key === 'regulars_no_ticket')!.def },
        { key: 'once', n: 50, reachable: 30, params: {}, def: CATALOG_ITEMS.find((x) => x.key === 'once')!.def },
        { key: 'loin', n: 4, reachable: 2, params: {}, def: CATALOG_ITEMS.find((x) => x.key === 'loin')!.def },
      ],
      existing: [],
    };
    const entries = catalogEntries(cat, F);
    // « Prochaine soirée » sans soirée à venir : indisponible, jamais recommandé.
    expect(entries.find((e) => e.key === 'regulars_no_ticket')?.disabled).toBe('noNext');
    expect(recommendedEntries(entries).map((e) => e.key)).toEqual(['once']);
    expect(templateGroup('src_yuno')).toBe('source');
  });

  it('dit une provenance Yuno en pastille', () => {
    expect(criteria({ seg: 'all', f: { src: ['yuno'] } }, t)).toEqual([{ k: fr['ya.cli.f.src'], v: fr['ya.cli.f.src.yuno'] }]);
  });
});
