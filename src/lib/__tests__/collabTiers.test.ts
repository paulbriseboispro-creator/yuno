import { describe, expect, it } from 'vitest';
import {
  normalizeSplitRules, readRemuneration, isTieredRules, tierFor, tieredPillarBlocks, validateTiers,
} from '../splitRules';
import type { CollabRemuneration } from '@/hooks/useOrganizerPartnerships';

// Les termes réels du premier deal à barème (Goya Thursday terms), tels
// qu'envoyés par le club : « < 3,5k = 0 % · 3,5k–5,5k = 7 % · 5,5k–7,5k = 11 % ·
// 7,5k–10k = 15 % · 10k–12,5k = 20 % · > 12,5k = 24 % ».
const GOYA: CollabRemuneration = {
  mode: 'tiered_total',
  tiers_mode: 'flat',
  tiers: [
    { from: 0, pct: 0 },
    { from: 3500, pct: 7 },
    { from: 5500, pct: 11 },
    { from: 7500, pct: 15 },
    { from: 10000, pct: 20 },
    { from: 12500, pct: 24 },
  ],
};

describe('tierFor — barème « flat » (le taux du palier atteint sur tout le total)', () => {
  it('rend 0 sous le premier seuil', () => {
    expect(tierFor(GOYA, 0)).toEqual({ pct: 0, amount: 0 });
    expect(tierFor(GOYA, 3499.99)).toEqual({ pct: 0, amount: 0 });
  });
  it('bascule au palier dès le seuil atteint (« à partir de »)', () => {
    expect(tierFor(GOYA, 3500)).toEqual({ pct: 7, amount: 245 });
    expect(tierFor(GOYA, 5500)).toEqual({ pct: 11, amount: 605 });
    expect(tierFor(GOYA, 12500)).toEqual({ pct: 24, amount: 3000 });
  });
  it('reproduit la table de l\'analyse (8 200 € → 15 % → 1 230 €)', () => {
    expect(tierFor(GOYA, 8200)).toEqual({ pct: 15, amount: 1230 });
    expect(tierFor(GOYA, 13000)).toEqual({ pct: 24, amount: 3120 });
  });
  it('montre l\'effet de seuil que le mode flat assume (5 500 → 5 600 €)', () => {
    expect(tierFor(GOYA, 5499).amount).toBe(384.93);
    expect(tierFor(GOYA, 5600).amount).toBe(616);
  });
  it('arrondit au centime', () => {
    expect(tierFor(GOYA, 3501.01).amount).toBe(245.07);
  });
  it('ignore l\'ordre de saisie des paliers', () => {
    const shuffled = { ...GOYA, tiers: [...GOYA.tiers].reverse() };
    expect(tierFor(shuffled, 8200)).toEqual({ pct: 15, amount: 1230 });
  });
  it('rend 0 sans barème', () => {
    expect(tierFor(null, 8200)).toEqual({ pct: 0, amount: 0 });
    expect(tierFor({ mode: 'tiered_total', tiers: [] }, 8200)).toEqual({ pct: 0, amount: 0 });
  });
  it('traite un total négatif ou NaN comme 0', () => {
    expect(tierFor(GOYA, -50)).toEqual({ pct: 0, amount: 0 });
    expect(tierFor(GOYA, Number.NaN)).toEqual({ pct: 0, amount: 0 });
  });
});

describe('tierFor — barème « marginal » (chaque tranche à son taux)', () => {
  const MARGINAL: CollabRemuneration = { ...GOYA, tiers_mode: 'marginal' };
  it('ne paie rien sur la première tranche à 0 %', () => {
    expect(tierFor(MARGINAL, 3500)).toEqual({ pct: 0, amount: 0 });
  });
  it('cumule les tranches : 8 200 € = 2 000 × 7 % + 2 000 × 11 % + 700 × 15 %', () => {
    const r = tierFor(MARGINAL, 8200);
    expect(r.amount).toBe(140 + 220 + 105);
    // Taux effectif = 465 / 8 200 = 5,67 %
    expect(r.pct).toBe(5.67);
  });
  it('n\'a pas d\'effet de seuil : 5 500 → 5 600 € n\'ajoute que 11 € (11 % de 100 €)', () => {
    expect(tierFor(MARGINAL, 5600).amount - tierFor(MARGINAL, 5500).amount).toBeCloseTo(11, 5);
  });
  it('la dernière tranche est ouverte', () => {
    // 2 000×7 + 2 000×11 + 2 500×15 + 2 500×20 + 7 500×24 = 140+220+375+500+1800
    expect(tierFor(MARGINAL, 20000).amount).toBe(3035);
  });
});

describe('readRemuneration / isTieredRules', () => {
  it('lit un barème valide et le trie', () => {
    const rem = readRemuneration({
      tickets: { organizer_pct: 0, venue_pct: 100 },
      remuneration: { mode: 'tiered_total', tiers: [{ from: 3500, pct: 7 }, { from: 0, pct: 0 }] },
    });
    expect(rem).toEqual({ mode: 'tiered_total', tiers_mode: 'flat', tiers: [{ from: 0, pct: 0 }, { from: 3500, pct: 7 }] });
  });
  it('refuse un autre mode, un barème vide, ou un contrat par pilier', () => {
    expect(readRemuneration({ remuneration: { mode: 'other', tiers: [{ from: 0, pct: 5 }] } })).toBeNull();
    expect(readRemuneration({ remuneration: { mode: 'tiered_total', tiers: [] } })).toBeNull();
    expect(isTieredRules({ tickets: { organizer_pct: 50, venue_pct: 50 } })).toBe(false);
    expect(isTieredRules(null)).toBe(false);
  });
  it('borne les valeurs illisibles ou négatives à 0', () => {
    const rem = readRemuneration({ remuneration: { mode: 'tiered_total', tiers: [{ from: -10, pct: 'x' }] } });
    expect(rem?.tiers).toEqual([{ from: 0, pct: 0 }]);
  });
  it('ne garde marginal que si demandé explicitement', () => {
    expect(readRemuneration({ remuneration: { mode: 'tiered_total', tiers: [{ from: 0, pct: 1 }], tiers_mode: 'marginal' } })?.tiers_mode).toBe('marginal');
    expect(readRemuneration({ remuneration: { mode: 'tiered_total', tiers: [{ from: 0, pct: 1 }], tiers_mode: 'weird' } })?.tiers_mode).toBe('flat');
  });
});

describe('normalizeSplitRules conserve le barème', () => {
  it('garde remuneration à côté des blocs pilier canoniques', () => {
    const norm = normalizeSplitRules({
      tickets: { organizer_pct: 0, venue_pct: 100 },
      tables: { organizer_pct: 0, venue_pct: 100 },
      drinks: { organizer_pct: 0, venue_pct: 100 },
      remuneration: GOYA,
    });
    expect(norm?.remuneration).toEqual(GOYA);
    expect(norm?.tickets).toEqual({ organizer_pct: 0, venue_pct: 100 });
  });
  it('n\'ajoute pas de clé remuneration à un contrat par pilier', () => {
    const norm = normalizeSplitRules({ tickets: { organizer_pct: 50, venue_pct: 50 } });
    expect(norm).not.toBeNull();
    expect('remuneration' in (norm as object)).toBe(false);
  });
  it('accepte un contrat qui ne porte QUE le barème (blocs pilier déduits à 100 % club)', () => {
    const norm = normalizeSplitRules({ remuneration: GOYA });
    expect(norm?.tables).toEqual({ organizer_pct: 0, venue_pct: 100 });
    expect(norm?.remuneration?.tiers).toHaveLength(6);
  });
});

describe('tieredPillarBlocks / validateTiers', () => {
  it('met tout au club et préserve un pilier sorti du deal', () => {
    const blocks = tieredPillarBlocks({
      tickets: { organizer_pct: 40, venue_pct: 60 },
      tables: { organizer_pct: 0, venue_pct: 100, enabled: false },
      drinks: { organizer_pct: 0, venue_pct: 100 },
    });
    expect(blocks.tickets).toEqual({ organizer_pct: 0, venue_pct: 100 });
    expect(blocks.tables).toEqual({ organizer_pct: 0, venue_pct: 100, enabled: false });
  });
  it('valide les termes Goya et refuse les barèmes incohérents', () => {
    expect(validateTiers(GOYA.tiers)).toBeNull();
    expect(validateTiers([])).toBe('empty');
    expect(validateTiers([{ from: 100, pct: 5 }])).toBe('first_from_not_zero');
    expect(validateTiers([{ from: 0, pct: 0 }, { from: 500, pct: 5 }, { from: 500, pct: 8 }])).toBe('from_not_increasing');
    expect(validateTiers([{ from: 0, pct: 120 }])).toBe('bad_pct');
    expect(validateTiers([{ from: 0, pct: 0 }, { from: 1000, pct: 0 }])).toBe('all_zero');
  });
});
