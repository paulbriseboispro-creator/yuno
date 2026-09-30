import { describe, expect, it } from 'vitest';
import {
  alreadyRefundedCents, fullRefundPatch, planChargeRefund, planRefund, refundAllowed,
  refundCapCents, remainingRefundableCents, saleCollector, saleParties, type CollectorRights,
} from '../../../supabase/functions/_shared/sale-refund.ts';

describe('refundCapCents — plafond côté club', () => {
  it('commande : total − frais de service', () => {
    expect(refundCapCents('order', { total: 24.5, service_fee: 1.5 })).toBe(2300);
  });
  it('commande à frais absorbés : tout ce que le client a payé', () => {
    expect(refundCapCents('order', { total: 24.5, service_fee: 1.5, fee_absorbed: true })).toBe(2450);
  });
  it('billet : total − frais − assurance (upsells compris dans le total)', () => {
    expect(refundCapCents('ticket', { total_price: '33.20', service_fee: '1.20', insurance_fee: '2.00' })).toBe(3000);
  });
  it('billet à frais absorbés : l\'assurance reste à Yuno', () => {
    expect(refundCapCents('ticket', { total_price: 32, service_fee: 1.2, insurance_fee: 2, fee_absorbed: true })).toBe(3000);
  });
  it('table : l\'acompte, jamais le budget complet', () => {
    expect(refundCapCents('table_reservation', { total_price: 500, deposit: 100, service_fee: 0, management_fee: 5 })).toBe(10000);
  });
  it('table historique sans acompte : total − frais − gestion', () => {
    expect(refundCapCents('table_reservation', { total_price: 105, service_fee: 0, management_fee: 5 })).toBe(10000);
    expect(refundCapCents('table_reservation', { total_price: 105, service_fee: 0, management_fee: 5, fee_absorbed: true })).toBe(10500);
  });
  it('valeurs manquantes ou illisibles : zéro, jamais NaN', () => {
    expect(refundCapCents('order', { total: null })).toBe(0);
    expect(refundCapCents('ticket', { total_price: 'abc' })).toBe(0);
    expect(refundCapCents('ticket', { total_price: 1, service_fee: 5 })).toBe(0);
  });
});

describe('déjà remboursé / reste', () => {
  it('lit refund_amount en centimes', () => {
    expect(alreadyRefundedCents({ refund_amount: '5.10' })).toBe(510);
    expect(alreadyRefundedCents({ refund_amount: null })).toBe(0);
  });
  it('reste = plafond − déjà rendu, jamais négatif', () => {
    expect(remainingRefundableCents('order', { total: 20, service_fee: 0, refund_amount: 5 })).toBe(1500);
    expect(remainingRefundableCents('order', { total: 20, service_fee: 0, refund_amount: 25 })).toBe(0);
  });
});

describe('planRefund — remboursement depuis Yuno', () => {
  it('partiel : la vente reste payée', () => {
    expect(planRefund(3000, 0, 1000)).toEqual({ amountCents: 1000, cumulativeCents: 1000, isFull: false });
  });
  it('les partiels se cumulent et le dernier la solde', () => {
    const first = planRefund(3000, 0, 1000)!;
    expect(planRefund(3000, first.cumulativeCents, 2000)).toEqual({ amountCents: 2000, cumulativeCents: 3000, isFull: true });
  });
  it('demande trop grande : ramenée à ce qui reste', () => {
    expect(planRefund(3000, 2500, 3000)).toEqual({ amountCents: 500, cumulativeCents: 3000, isFull: true });
  });
  it('plus rien à rendre, montant nul ou négatif : rien', () => {
    expect(planRefund(3000, 3000, 100)).toBeNull();
    expect(planRefund(3000, 0, 0)).toBeNull();
    expect(planRefund(3000, 0, -50)).toBeNull();
  });
  it('5,10 + 4,90 = 10,00 pile : pas de centime fantôme', () => {
    const a = planRefund(1000, 0, 510)!;
    const b = planRefund(1000, a.cumulativeCents, 490)!;
    expect(b.isFull).toBe(true);
  });
});

describe('planChargeRefund — remboursement constaté chez Stripe', () => {
  it('remboursement fait depuis le tableau de bord Stripe : tout est nouveau', () => {
    expect(planChargeRefund(3000, 0, 3120, 1000)).toEqual({ cumulativeCents: 1000, deltaCents: 1000, isFull: false });
  });
  it('déjà enregistré par Yuno (owner-refund l\'a posé avant Stripe) : delta nul', () => {
    expect(planChargeRefund(3000, 1000, 3120, 1000).deltaCents).toBe(0);
  });
  it('événement en retard (cumul plus petit que la base) : rien ne recule', () => {
    expect(planChargeRefund(3000, 2000, 3120, 1000).deltaCents).toBe(0);
  });
  it('total dès que le plafond côté club est rendu', () => {
    expect(planChargeRefund(3000, 0, 3120, 3000).isFull).toBe(true);
    expect(planChargeRefund(3000, 0, 3120, 2999).isFull).toBe(false);
  });
  it('total quand toute la charge est rendue (frais Yuno compris)', () => {
    expect(planChargeRefund(3000, 0, 3120, 3120)).toEqual({ cumulativeCents: 3120, deltaCents: 3120, isFull: true });
  });
  it('rejeu du même événement : delta nul, toujours total', () => {
    const p = planChargeRefund(3000, 3120, 3120, 3120);
    expect(p.deltaCents).toBe(0);
    expect(p.isFull).toBe(true);
  });
});

describe('fullRefundPatch', () => {
  it('une commande remboursée ne se sert plus', () => {
    expect(fullRefundPatch('order')).toEqual({ status: 'refunded', archived: true, token_used: true });
  });
  it('billet et table : le statut seul (le reste est porté par la base)', () => {
    expect(fullRefundPatch('ticket')).toEqual({ status: 'refunded' });
    expect(fullRefundPatch('table_reservation')).toEqual({ status: 'refunded' });
  });
});

const accounts = {
  venues: { womber: 'acct_club' },
  organizers: { org1: 'acct_org', org2: 'acct_org2' },
};

describe('saleParties — la partie principale d\'abord', () => {
  it('soirée du club : le club, puis l\'organisateur partenaire', () => {
    expect(saleParties({ venue_id: 'womber', partner_organizer_id: 'org1' }, accounts).map((p) => p.id)).toEqual(['womber', 'org1']);
  });
  it('soirée de l\'organisateur chez un club : l\'organisateur, puis le club partenaire', () => {
    const parties = saleParties({ venue_id: null, organizer_user_id: 'org1', partner_venue_id: 'womber' }, accounts);
    expect(parties).toEqual([
      { party: 'organizer', id: 'org1', accountId: 'acct_org' },
      { party: 'venue', id: 'womber', accountId: 'acct_club' },
    ]);
  });
  it('une partie sans compte Stripe garde accountId null', () => {
    expect(saleParties({ organizer_user_id: 'org9' }, accounts)[0].accountId).toBeNull();
  });
});

describe('saleCollector — qui a encaissé rembourse', () => {
  const orgLed = saleParties({ organizer_user_id: 'org1', partner_venue_id: 'womber' }, accounts);
  const clubLed = saleParties({ venue_id: 'womber', partner_organizer_id: 'org1' }, accounts);
  it('le compte de la vente désigne la partie, même partenaire', () => {
    expect(saleCollector('ticket', 'acct_club', orgLed)).toEqual({ party: 'venue', id: 'womber' });
    expect(saleCollector('table_reservation', 'acct_org', clubLed)).toEqual({ party: 'organizer', id: 'org1' });
  });
  it('sans compte ou compte inconnu : la partie principale', () => {
    expect(saleCollector('ticket', null, orgLed)).toEqual({ party: 'organizer', id: 'org1' });
    expect(saleCollector('ticket', 'acct_ancien', clubLed)).toEqual({ party: 'venue', id: 'womber' });
  });
  it('une commande de boissons revient au club du bar', () => {
    expect(saleCollector('order', 'acct_org', orgLed)).toEqual({ party: 'venue', id: 'womber' });
    expect(saleCollector('order', null, saleParties({ organizer_user_id: 'org1' }, accounts))).toBeNull();
  });
  it('soirée sans aucune partie : personne', () => {
    expect(saleCollector('ticket', null, [])).toBeNull();
  });
});

describe('refundAllowed — seul l\'encaisseur rembourse', () => {
  const none: CollectorRights = { isAdmin: false, clubRefunder: false, orgRefunder: false };
  const club = { party: 'venue' as const, id: 'womber' };
  const org = { party: 'organizer' as const, id: 'org1' };
  it('personne : refusé', () => {
    expect(refundAllowed(club, none)).toBe(false);
    expect(refundAllowed(org, none)).toBe(false);
  });
  it('le club rembourse ce que le club a encaissé, pas ce que l\'organisateur a encaissé', () => {
    expect(refundAllowed(club, { ...none, clubRefunder: true })).toBe(true);
    expect(refundAllowed(org, { ...none, clubRefunder: true })).toBe(false);
  });
  it('l\'organisateur rembourse ce qu\'il a encaissé, jamais la vente du club partenaire', () => {
    expect(refundAllowed(org, { ...none, orgRefunder: true })).toBe(true);
    expect(refundAllowed(club, { ...none, orgRefunder: true })).toBe(false);
  });
  it('super admin : toujours ; encaisseur inconnu : personne d\'autre', () => {
    expect(refundAllowed(null, { ...none, isAdmin: true })).toBe(true);
    expect(refundAllowed(null, { isAdmin: false, clubRefunder: true, orgRefunder: true })).toBe(false);
  });
});
