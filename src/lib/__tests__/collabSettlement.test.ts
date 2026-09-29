import { describe, expect, it } from 'vitest';
import { normalizeSplitRules, readSettlement, withSettlement, collectorForcedToVenue } from '../splitRules';
import { getCollabTerms, COLLAB_TERMS_VERSION } from '../collabContractTerms';
import { collabSettlement } from '../../../supabase/functions/_shared/payment-split.ts';

const PILLARS = {
  tickets: { organizer_pct: 30, venue_pct: 70 },
  tables: { organizer_pct: 30, venue_pct: 70 },
  drinks: { organizer_pct: 0, venue_pct: 100 },
};
const TIERED = { ...PILLARS, remuneration: { mode: 'tiered_total', tiers: [{ from: 0, pct: 5 }] } };

describe('readSettlement (front) = collabSettlement (edge) = normalize_collab_settlement (SQL)', () => {
  const cases: [string, Record<string, unknown> | null][] = [
    ['absent', null],
    ['stripe', { ...PILLARS, settlement: { mode: 'stripe' } }],
    ['virement club', { ...PILLARS, settlement: { mode: 'transfer', collector: 'venue', payment_terms_days: 7 } }],
    ['virement orga', { ...PILLARS, settlement: { mode: 'transfer', collector: 'organizer', payment_terms_days: 30 } }],
    ['virement délai inconnu', { ...PILLARS, settlement: { mode: 'transfer', collector: 'organizer', payment_terms_days: 12 } }],
    ['barème + orga', { ...TIERED, settlement: { mode: 'transfer', collector: 'organizer' } }],
    ['tables total dépensé + orga', { ...PILLARS, tables: { organizer_pct: 30, venue_pct: 70, basis: 'total_spend' }, settlement: { mode: 'transfer', collector: 'organizer' } }],
  ];
  it.each(cases)('%s : même mode et même encaisseur des deux côtés', (_n, rules) => {
    const front = readSettlement(rules);
    const edge = collabSettlement(rules);
    expect(front.mode).toBe(edge.mode);
    if (front.mode === 'transfer' && edge.mode === 'transfer') expect(front.collector).toBe(edge.collector);
  });
  it('délai borné à 7 / 15 / 30, 15 par défaut', () => {
    expect(readSettlement({ settlement: { mode: 'transfer', payment_terms_days: 12 } })).toMatchObject({ payment_terms_days: 15 });
    expect(readSettlement({ settlement: { mode: 'transfer', payment_terms_days: 30 } })).toMatchObject({ payment_terms_days: 30 });
  });
  it('barème / total dépensé : encaisseur forcé au club', () => {
    expect(collectorForcedToVenue(TIERED)).toBe(true);
    expect(readSettlement({ ...TIERED, settlement: { mode: 'transfer', collector: 'organizer' } })).toMatchObject({ collector: 'venue' });
  });
});

describe('normalizeSplitRules préserve le règlement', () => {
  it('un contrat par virement le reste après normalisation', () => {
    const n = normalizeSplitRules({ ...PILLARS, settlement: { mode: 'transfer', collector: 'organizer', payment_terms_days: 7 } });
    expect(n?.settlement).toEqual({ mode: 'transfer', collector: 'organizer', payment_terms_days: 7 });
  });
  it('stripe : pas de bloc settlement', () => {
    expect(normalizeSplitRules(PILLARS)?.settlement).toBeUndefined();
  });
  it('withSettlement pose ou retire le bloc', () => {
    expect(withSettlement(PILLARS, { mode: 'transfer', collector: 'organizer' })).toMatchObject({ settlement: { mode: 'transfer', collector: 'organizer', payment_terms_days: 15 } });
    expect('settlement' in withSettlement({ ...PILLARS, settlement: { mode: 'transfer' } }, { mode: 'stripe' })).toBe(false);
  });
});

describe('Contrat : texte selon le mode de règlement', () => {
  const titles = (t: ReturnType<typeof getCollabTerms>) => t.articles.map((a) => a.title.fr);
  const splitNote = (t: ReturnType<typeof getCollabTerms>) => {
    const a = t.articles.find((x) => x.kind === 'split');
    return a && a.kind === 'split' ? a : null;
  };
  const allText = (t: ReturnType<typeof getCollabTerms>) => JSON.stringify(t.articles);

  it('version courante = 2026-09-29', () => expect(COLLAB_TERMS_VERSION).toBe('2026-09-29'));

  it('Stripe : texte identique à 2026-09-26 (aucun article de virement, aucun jeton)', () => {
    const now = getCollabTerms('2026-09-29');
    const before = getCollabTerms('2026-09-26');
    expect(titles(now)).toEqual(titles(before));
    expect(allText(now)).not.toContain('{collector}');
    expect(titles(now)).not.toContain('Règlement par virement');
    expect(splitNote(now)?.note).toEqual(splitNote(before)?.note);
  });

  it('par pilier : la note barème ne fuit plus (bug corrigé)', () => {
    const t = getCollabTerms('2026-09-26');
    const a = splitNote(t);
    expect(a?.noteTiered).toBeUndefined();
    expect(a?.note.fr).not.toContain('barème');
  });

  it('virement encaissé par l\'orga : article inséré, jetons remplacés, numérotation continue', () => {
    const t = getCollabTerms('2026-09-29', { settlement: { mode: 'transfer', collector: 'organizer', payment_terms_days: 7 } });
    expect(titles(t)).toContain('Règlement par virement');
    expect(t.articles.map((a) => a.num)).toEqual(t.articles.map((_, i) => i + 1));
    expect(splitNote(t)?.note.fr).toContain("L'Organisateur encaisse");
    expect(splitNote(t)?.note.en).toContain('The Organizer collects');
    expect(allText(t)).toContain('sous 7 jours');
    expect(allText(t)).toContain("(l'Organisateur)");
    expect(allText(t)).not.toMatch(/\{collector\}|\{days\}/);
    expect(allText(t)).not.toContain('de le Club');
  });

  it('barème sans Stripe : pas d\'article de virement, décompte en variante virement', () => {
    const t = getCollabTerms('2026-09-29', { tiered: true, settlement: { mode: 'transfer', collector: 'venue' } });
    expect(titles(t)).not.toContain('Règlement par virement');
    const nc = t.articles.find((a) => a.kind === 'night_closing');
    const text = JSON.stringify(nc);
    expect(text).toContain("rien n'est retenu par la plateforme");
    expect(text).toContain('la totalité de sa rémunération par virement');
    expect(splitNote(t)?.note.fr).toContain('barème');
  });

  it('version ancienne signée : le mode virement n\'invente pas d\'article', () => {
    const t = getCollabTerms('2026-09-21', { settlement: { mode: 'transfer', collector: 'venue' } });
    expect(titles(t)).not.toContain('Règlement par virement');
  });
});
