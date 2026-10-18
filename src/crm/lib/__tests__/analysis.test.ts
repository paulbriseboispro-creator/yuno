import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pickLanguage } from '@/i18n/locales/crm/modules';
import analysisDict from '@/i18n/locales/crm/modules/analysis';
import {
  DEFAULT_RULES, EVIDENCE_KEYS, FAMILIES, ONE_FORM_KEYS, SLOTS, evidenceKey, displayStatus, familyKind, rateOrNull, statusOf, supportedForSegments, topHypotheses,
} from '../analysis';
import type { FamilyStatus, Hypothesis } from '../analysis';

const LANGS = [pickLanguage(0), pickLanguage(1), pickLanguage(2)];

describe('Analyse client : statut d’une famille (miroir de _crm_an_status)', () => {
  // Mêmes cas que le smoke SQL : un compte où le trait compte, un où le hasard
  // explique tout, un trop petit.
  it('affinité confirmée : gain ≥ 1,3 et z ≥ 2 sur 30 passages ou plus', () => {
    expect(statusOf('affinity', { o: 61, e: 33, v: 20, n: 140 })).toBe('supported');
    expect(statusOf('affinity', { o: 161, e: 88.3, v: 56.5, n: 360 })).toBe('supported');
  });
  it('affinité pas confirmée : le hasard explique tout', () => {
    expect(statusOf('affinity', { o: 78, e: 78.8, v: 45, n: 325 })).toBe('not_supported');
    // Gain sous 1,1 même avec un z correct.
    expect(statusOf('affinity', { o: 329, e: 300.5, v: 150, n: 702 })).toBe('not_supported');
  });
  it('trop petit : à tester, quel que soit l’écart', () => {
    expect(statusOf('affinity', { o: 20, e: 5, v: 4, n: 29 })).toBe('untested');
    expect(statusOf('behaviour', { o: 0, e: 0, v: 0, n: 100 })).toBe('untested');
  });
  it('entre les deux : non concluant', () => {
    // gain 1,14, z 2,9 : au-dessus de « pas confirmée », sous « confirmée ».
    expect(statusOf('affinity', { o: 262, e: 229.7, v: 124, n: 508 })).toBe('inconclusive');
  });
  it('retour : écart d’au moins 30 % et |z| ≥ 2, dans les deux sens', () => {
    expect(statusOf('return', { o: 89, e: 59.4, v: 30, n: 175, n0: 600, z: 4.1 })).toBe('supported');
    expect(statusOf('return', { o: 112, e: 249.8, v: 120, n: 464, n0: 400, z: -8.9 })).toBe('supported');
    expect(statusOf('return', { o: 58, e: 60.3, v: 30, n: 108, n0: 700, z: -0.4 })).toBe('not_supported');
    expect(statusOf('return', { o: 40, e: 20, v: 10, n: 40, n0: 12, z: 3 })).toBe('untested');
  });
  it('les seuils par défaut sont ceux de la version 1 des règles', () => {
    expect(DEFAULT_RULES.status).toEqual({ min_n: 30, gain_supported: 1.3, z_supported: 2, gain_not: 1.1, z_not: 1 });
    expect(DEFAULT_RULES.min_sample).toBe(10);
  });
});

describe('Analyse client : ce que l’écran affiche', () => {
  it('une famille éteinte se tait, une leçon commune reste à part', () => {
    expect(displayStatus({ status: 'supported', availability: 'uniform' })).toBe('off');
    expect(displayStatus({ status: 'untested', availability: 'unavailable' })).toBe('off');
    expect(displayStatus({ status: 'supported', availability: 'ok' })).toBe('supported');
    expect(displayStatus({ status: 'inconclusive', availability: 'ok', prior: { accounts: 6, gain: 1.5, status: 'supported' } })).toBe('prior_only');
    expect(displayStatus({ status: 'inconclusive', availability: 'ok' })).toBe('untested');
    // Jamais « observée ailleurs » à la place d'un statut tranché du compte.
    expect(displayStatus({ status: 'not_supported', availability: 'ok', prior: { accounts: 6, gain: 1.5, status: 'supported' } })).toBe('not_supported');
  });
  it('aucun taux sous 10 personnes', () => {
    expect(rateOrNull(4, 9)).toBeNull();
    expect(rateOrNull(4, 10)).toBeCloseTo(0.4);
    expect(rateOrNull(null, 40)).toBeNull();
  });
  it('montre d’abord les hypothèses fortes, puis celles confirmées sur le compte', () => {
    const h = (f: Hypothesis['f'], s: Hypothesis['s'], status: Hypothesis['status'] = 'untested'): Hypothesis => ({ f, s, k: 'x', p: {}, status, availability: 'ok' });
    const top = topHypotheses([h('genre', 'medium'), h('series', 'medium', 'supported'), h('artist', 'strong'), h('format', 'weak')], 2);
    expect(top.map((x) => x.f)).toEqual(['artist', 'series']);
    const off = topHypotheses([{ ...h('weekday', 'strong'), availability: 'uniform' }, h('genre', 'weak')], 2);
    expect(off.map((x) => x.f)).toEqual(['genre']);
  });
  it('recommande un segment seulement pour une famille confirmée (et un retour dans le bon sens)', () => {
    const f = (family: string, kind: FamilyStatus['kind'], status: FamilyStatus['status'], direction: FamilyStatus['direction'] = null) =>
      ({ family, variant: '', kind, status, availability: 'ok' as const, direction }) as Pick<FamilyStatus, 'family' | 'variant' | 'kind' | 'status' | 'availability' | 'direction'>;
    const s = supportedForSegments([
      f('artist', 'affinity', 'supported'), f('genre', 'affinity', 'not_supported'),
      f('discovery', 'return', 'supported', 'less'), f('brought', 'return', 'supported', 'more'),
      f('passing', 'return', 'supported', 'less'),
    ]);
    expect([...s].sort()).toEqual(['artist', 'brought', 'passing']);
  });
  it('une seule venue : la preuve passe au singulier', () => {
    expect(evidenceKey('group.with', { n: 1, of: 1 })).toBe('group.with.one');
    expect(evidenceKey('group.with', { n: 3, of: 4 })).toBe('group.with');
    expect(evidenceKey('artist.repeat', { of: 1 })).toBe('artist.repeat');
  });
  it('chaque famille a son genre de test', () => {
    expect(familyKind('artist')).toBe('affinity');
    expect(familyKind('launch')).toBe('behaviour');
    expect(familyKind('channel')).toBe('return');
  });
});

describe('Analyse client : textes', () => {
  it('chaque famille, statut, force, preuve et créneau existe dans les trois langues', () => {
    const keys = [
      ...FAMILIES.flatMap((f) => [`yc.why.fam.${f}`, `yc.why.famq.${f}`]),
      ...['supported', 'not_supported', 'untested', 'prior_only', 'off'].map((s) => `yc.why.st.${s}`),
      ...['strong', 'medium', 'weak'].map((s) => `yc.why.str.${s}`),
      ...EVIDENCE_KEYS.map((k) => `yc.why.ev.${k}`),
      ...ONE_FORM_KEYS.map((k) => `yc.why.ev.${k}.one`),
      ...SLOTS.map((s) => `yc.why.slot.${s}`),
    ];
    for (const d of LANGS) for (const k of keys) expect(d[k], k).toBeTruthy();
  });
  it('n’affirme jamais un motif (« vient pour », « fan de », « aime »…)', () => {
    const banned = [
      /vient pour/i, /viennent pour/i, /\bfan de\b/i, /\baime\b/i, /\baiment\b/i, /son ami/i, /il préfère/i,
      /comes? for\b/i, /\bfan of\b/i, /\bloves?\b/i, /\bhis friend\b/i, /\bher friend\b/i, /\bprefers?\b/i,
      /viene por/i, /vienen por/i, /le encanta/i, /su amig[oa]/i, /\bprefiere\b/i,
    ];
    const bad: string[] = [];
    for (const [k, triple] of Object.entries(analysisDict)) {
      for (const s of triple) for (const re of banned) if (re.test(s)) bad.push(`${k}: ${s}`);
    }
    expect(bad).toEqual([]);
  });
  it('une clé de la Console CRM n’est définie qu’une fois, tous modules confondus', () => {
    const dir = join(process.cwd(), 'src/i18n/locales/crm/modules');
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
      for (const m of readFileSync(join(dir, f), 'utf8').matchAll(/^\s*'(yc\.[^']+)':/gm)) {
        if (seen.has(m[1])) dupes.push(`${m[1]} (${seen.get(m[1])} / ${f})`);
        seen.set(m[1], f);
      }
    }
    expect(dupes).toEqual([]);
  });
});
