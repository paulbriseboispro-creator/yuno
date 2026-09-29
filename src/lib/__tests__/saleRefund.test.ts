import { describe, expect, it } from 'vitest';
import {
  alreadyRefundedCents, fullRefundPatch, planChargeRefund, planRefund, refundAllowed,
  refundCapCents, remainingRefundableCents, type RefundActor,
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

describe('refundAllowed — miroir de l\'écran', () => {
  const none: RefundActor = { isAdmin: false, ownsVenue: false, managesRefunds: false, isOrganizer: false, orgMemberCanRefund: false };
  it('personne : refusé partout', () => {
    for (const k of ['order', 'ticket', 'table_reservation'] as const) expect(refundAllowed(k, none)).toBe(false);
  });
  it('super admin, propriétaire, manager autorisé : tout ce qui se vend au club', () => {
    for (const who of ['isAdmin', 'ownsVenue', 'managesRefunds'] as const) {
      for (const k of ['order', 'ticket', 'table_reservation'] as const) {
        expect(refundAllowed(k, { ...none, [who]: true })).toBe(true);
      }
    }
  });
  it('organisateur et équipe autorisée : billets et tables, jamais le bar du club', () => {
    for (const who of ['isOrganizer', 'orgMemberCanRefund'] as const) {
      expect(refundAllowed('ticket', { ...none, [who]: true })).toBe(true);
      expect(refundAllowed('table_reservation', { ...none, [who]: true })).toBe(true);
      expect(refundAllowed('order', { ...none, [who]: true })).toBe(false);
    }
  });
});
