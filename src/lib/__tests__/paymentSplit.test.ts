import { describe, expect, it } from 'vitest';
import {
  collabSettlement, resolvePaymentSplit, type SplitInput,
} from '../../../supabase/functions/_shared/payment-split.ts';
import { accountsUsedBySplit, checkPayoutReadiness } from '../../../supabase/functions/_shared/payout-readiness.ts';

// Le résolveur de split des checkouts (edge) : chaque mode de contrat collab
// doit envoyer l'argent sur le BON compte, et n'exiger que les comptes utilisés.

const clubLed = (rules: Record<string, unknown> | null): SplitInput['event'] => ({
  id: 'ev', venue_id: 'club', organizer_user_id: null, partner_venue_id: null,
  partner_organizer_id: 'org', event_mode: 'co_event', revenue_split_rules: rules,
});
const orgLed = (rules: Record<string, unknown> | null): SplitInput['event'] => ({
  id: 'ev', venue_id: null, organizer_user_id: 'org', partner_venue_id: 'club',
  partner_organizer_id: null, event_mode: 'co_event', revenue_split_rules: rules,
});
const PILLARS_30 = {
  tickets: { organizer_pct: 30, venue_pct: 70 },
  tables: { organizer_pct: 30, venue_pct: 70 },
  drinks: { organizer_pct: 0, venue_pct: 100 },
};

describe('collabSettlement', () => {
  it('absent ou inconnu = partage Stripe', () => {
    expect(collabSettlement(null)).toEqual({ mode: 'stripe' });
    expect(collabSettlement({ settlement: { mode: 'x' } })).toEqual({ mode: 'stripe' });
  });
  it('virement : encaisseur lu, club par défaut', () => {
    expect(collabSettlement({ settlement: { mode: 'transfer', collector: 'organizer' } })).toEqual({ mode: 'transfer', collector: 'organizer' });
    expect(collabSettlement({ settlement: { mode: 'transfer' } })).toEqual({ mode: 'transfer', collector: 'venue' });
  });
  it('barème ou tables au total dépensé : encaisseur forcé au club', () => {
    expect(collabSettlement({ remuneration: { mode: 'tiered_total', tiers: [{ from: 0, pct: 5 }] }, settlement: { mode: 'transfer', collector: 'organizer' } }))
      .toEqual({ mode: 'transfer', collector: 'venue' });
    expect(collabSettlement({ tables: { organizer_pct: 20, venue_pct: 80, basis: 'total_spend' }, settlement: { mode: 'transfer', collector: 'organizer' } }))
      .toEqual({ mode: 'transfer', collector: 'venue' });
  });
});

describe('resolvePaymentSplit — contrat collab', () => {
  it('partage Stripe 30/70 : deux jambes, deux comptes exigés', () => {
    const r = resolvePaymentSplit({ itemType: 'ticket', grossAmount: 21, event: clubLed(PILLARS_30), venueStripeAccountId: 'acct_club', organizerStripeAccountId: 'acct_org' });
    expect(r.splitMode).toBe('separate');
    expect(r.secondary).not.toBeNull();
    expect(r.transferSplit).toBeUndefined();
    expect(() => resolvePaymentSplit({ itemType: 'ticket', grossAmount: 21, event: clubLed(PILLARS_30), venueStripeAccountId: 'acct_club', organizerStripeAccountId: null }))
      .toThrow(/Both parties/);
  });

  it('virement, club encaisseur : charge directe club, orga sans Stripe OK', () => {
    const rules = { ...PILLARS_30, settlement: { mode: 'transfer', collector: 'venue' } };
    const r = resolvePaymentSplit({ itemType: 'ticket', grossAmount: 21, event: orgLed(rules), venueStripeAccountId: 'acct_club', organizerStripeAccountId: null, venueDirectAmount: 5 });
    expect(r.splitMode).toBe('direct');
    expect(r.primary.accountId).toBe('acct_club');
    expect(r.secondary).toBeNull();
    expect(r.transferSplit).toEqual({ mode: 'transfer', collector: 'venue', organizer_pct: 30, venue_pct: 70, venue_direct: 5 });
  });

  it('virement, orga encaisseur : charge directe orga, club sans Stripe OK', () => {
    const rules = { ...PILLARS_30, settlement: { mode: 'transfer', collector: 'organizer' } };
    const r = resolvePaymentSplit({ itemType: 'table', grossAmount: 104, event: clubLed(rules), venueStripeAccountId: null, organizerStripeAccountId: 'acct_org' });
    expect(r.splitMode).toBe('direct');
    expect(r.primary.accountId).toBe('acct_org');
    expect(r.primary.kind).toBe('organizer');
    expect(r.transferSplit?.collector).toBe('organizer');
  });

  it("virement : l'encaisseur sans Stripe ne vend pas", () => {
    const rules = { ...PILLARS_30, settlement: { mode: 'transfer', collector: 'organizer' } };
    expect(() => resolvePaymentSplit({ itemType: 'ticket', grossAmount: 21, event: clubLed(rules), venueStripeAccountId: 'acct_club', organizerStripeAccountId: null }))
      .toThrow(/Organizer has no Stripe/);
  });

  it('virement : les boissons restent en charge directe club', () => {
    const rules = { ...PILLARS_30, settlement: { mode: 'transfer', collector: 'organizer' } };
    const r = resolvePaymentSplit({ itemType: 'drink', grossAmount: 10, event: clubLed(rules), venueStripeAccountId: 'acct_club', organizerStripeAccountId: 'acct_org' });
    expect(r.primary.accountId).toBe('acct_club');
    expect(r.transferSplit).toBeUndefined();
  });

  it('virement + barème : charge directe club, rien de retenu', () => {
    const rules = { tickets: { organizer_pct: 0, venue_pct: 100 }, tables: { organizer_pct: 0, venue_pct: 100 }, remuneration: { mode: 'tiered_total', tiers: [{ from: 0, pct: 5 }] }, settlement: { mode: 'transfer', collector: 'organizer' } };
    const r = resolvePaymentSplit({ itemType: 'ticket', grossAmount: 21, event: clubLed(rules), venueStripeAccountId: 'acct_club', organizerStripeAccountId: null });
    expect(r.splitMode).toBe('direct');
    expect(r.primary.accountId).toBe('acct_club');
    expect(r.hold).toBeUndefined();
    expect(r.transferSplit?.organizer_pct).toBe(0);
  });

  it('barème en mode Stripe : charge plateforme retenue (inchangé)', () => {
    const rules = { tickets: { organizer_pct: 0, venue_pct: 100 }, tables: { organizer_pct: 0, venue_pct: 100 }, remuneration: { mode: 'tiered_total', tiers: [{ from: 0, pct: 5 }] } };
    const r = resolvePaymentSplit({ itemType: 'ticket', grossAmount: 21, event: clubLed(rules), venueStripeAccountId: 'acct_club', organizerStripeAccountId: null });
    expect(r.splitMode).toBe('separate');
    expect(r.hold).toBe('night_closing');
  });

  it('solo organisateur : charge directe orga (inchangé)', () => {
    const r = resolvePaymentSplit({ itemType: 'ticket', grossAmount: 21, event: { id: 'e', venue_id: null, organizer_user_id: 'org', partner_venue_id: null, partner_organizer_id: null, event_mode: 'solo_organizer', revenue_split_rules: null }, organizerStripeAccountId: 'acct_org' });
    expect(r.splitMode).toBe('direct');
    expect(r.primary.accountId).toBe('acct_org');
  });
});

describe('checkPayoutReadiness — la porte vérifie les comptes réellement utilisés', () => {
  const acc = (v: string | null, vOk: boolean, o: string | null, oOk: boolean) => ({
    venueStripeAccountId: v, venueChargesEnabled: vOk, organizerStripeAccountId: o, organizerChargesEnabled: oOk,
  });
  const base = (rules: Record<string, unknown> | null, ev = orgLed) => ({ itemType: 'ticket' as const, event: ev(rules) });

  it('collab mené par l\'orga, virement encaissé par le club : orga sans Stripe = vente OUVERTE', () => {
    const r = checkPayoutReadiness(base({ ...PILLARS_30, settlement: { mode: 'transfer', collector: 'venue' } }), acc('acct_club', true, null, false));
    expect('split' in r).toBe(true);
  });
  it('partage Stripe : orga sans compte = bloqué sur l\'orga', () => {
    expect(checkPayoutReadiness(base(PILLARS_30), acc('acct_club', true, null, false))).toEqual({ missing: 'organizer' });
  });
  it('partage Stripe : club sans compte = bloqué sur le club', () => {
    expect(checkPayoutReadiness(base(PILLARS_30), acc(null, false, 'acct_org', true))).toEqual({ missing: 'venue' });
  });
  it('compte utilisé non activé = inactive, compte NON utilisé ignoré', () => {
    const rules = { ...PILLARS_30, settlement: { mode: 'transfer', collector: 'organizer' } };
    expect('split' in checkPayoutReadiness(base(rules, clubLed), acc('acct_club', false, 'acct_org', true))).toBe(true);
    expect(checkPayoutReadiness(base(rules, clubLed), acc('acct_club', true, 'acct_org', false))).toEqual({ inactive: 'organizer' });
  });
  it('comptes utilisés : dédoublonnés, sans null', () => {
    const r = checkPayoutReadiness(base(PILLARS_30, clubLed), acc('acct_club', true, 'acct_org', true));
    if (!('split' in r)) throw new Error('attendu split');
    expect(accountsUsedBySplit(r.split).sort()).toEqual(['acct_club', 'acct_org']);
  });
});

describe('co-organisation entre deux organisations — « Répartir via Stripe ? » Oui', () => {
  const soloOrg: SplitInput['event'] = {
    id: 'ev', venue_id: null, organizer_user_id: 'orgA', partner_venue_id: null,
    partner_organizer_id: null, event_mode: 'solo_organizer', revenue_split_rules: null,
  };
  const co = { partnerOrganizerId: 'orgB', partnerAccountId: 'acct_B', partnerPct: 40 };
  const input = (over: Partial<SplitInput> = {}): SplitInput => ({
    itemType: 'ticket', grossAmount: 52, event: soloOrg, organizerStripeAccountId: 'acct_A', coorgStripe: co, ...over,
  });

  it('charge plateforme au nom de l\'hôte, deux jambes organisateur', () => {
    const r = resolvePaymentSplit(input());
    expect(r.splitMode).toBe('separate');
    expect(r.onBehalfOf).toBe('acct_A');
    expect(r.coorg).toBe(true);
    expect(r.primary).toMatchObject({ accountId: 'acct_A', kind: 'organizer', organizerId: 'orgA', venueId: null });
    expect(r.secondary).toMatchObject({ accountId: 'acct_B', kind: 'organizer', organizerId: 'orgB', venueId: null });
  });

  it('Yuno garde exactement sa commission, les jambes absorbent les frais Stripe au prorata', () => {
    const r = resolvePaymentSplit(input());
    const legs = r.primary.amountCents + (r.secondary?.amountCents ?? 0);
    expect(legs + r.yunoFeeCents + r.stripeFeeEstimatedCents).toBe(r.grossAmountCents);
    const net = r.grossAmountCents - r.yunoFeeCents;
    // 40 % du net au partenaire, moins sa quote-part des frais Stripe
    const partnerBefore = Math.round(net * 0.4);
    const partnerFee = Math.round((r.stripeFeeEstimatedCents * partnerBefore) / net);
    expect(r.secondary?.amountCents).toBe(partnerBefore - partnerFee);
  });

  it('frais absorbés (commission imposée) : la même commission part en application', () => {
    const r = resolvePaymentSplit(input({ yunoFeeCentsOverride: 150 }));
    expect(r.yunoFeeCents).toBe(150);
    expect(r.primary.amountCents + (r.secondary?.amountCents ?? 0) + 150 + r.stripeFeeEstimatedCents).toBe(r.grossAmountCents);
  });

  it('tables : même partage', () => {
    const r = resolvePaymentSplit(input({ itemType: 'table', grossAmount: 200 }));
    expect(r.splitMode).toBe('separate');
    expect(r.secondary?.organizerId).toBe('orgB');
  });

  it('sans accord Stripe (ou compte partenaire indisponible) : charge directe chez l\'hôte', () => {
    for (const bad of [null, { ...co, partnerPct: 0 }, { ...co, partnerPct: 100 }, { ...co, partnerAccountId: '' }, { ...co, partnerAccountId: 'acct_A' }]) {
      const r = resolvePaymentSplit(input({ coorgStripe: bad }));
      expect(r.splitMode).toBe('direct');
      expect(r.primary.accountId).toBe('acct_A');
      expect(r.secondary).toBeNull();
    }
  });

  it('jamais sur une soirée avec club : le contrat collab garde la main', () => {
    const r = resolvePaymentSplit(input({
      event: { ...soloOrg, partner_venue_id: 'club', event_mode: 'co_event', revenue_split_rules: PILLARS_30 },
      venueStripeAccountId: 'acct_club',
    }));
    expect(r.coorg).toBeUndefined();
    expect([r.primary.kind, r.secondary?.kind].sort()).toEqual(['organizer', 'venue']);
  });

  it('la porte « paiements prêts » compte les deux comptes utilisés', () => {
    const r = checkPayoutReadiness({ itemType: 'ticket', event: soloOrg, coorgStripe: co }, {
      venueStripeAccountId: null, venueChargesEnabled: false, organizerStripeAccountId: 'acct_A', organizerChargesEnabled: true,
    });
    if (!('split' in r)) throw new Error('attendu split');
    expect(accountsUsedBySplit(r.split).sort()).toEqual(['acct_A', 'acct_B']);
  });
});
