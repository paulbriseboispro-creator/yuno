import { describe, expect, it } from 'vitest';
import { heldLegAfterRefund, refundContext, releasedLegReversal } from '../../../supabase/functions/_shared/refund-legs.ts';

// Vente de co-soirée : 4 billets à 20 € + 1 € de frais Yuno chacun = 84 € brut,
// 4 € de frais Yuno ; jambes 30/70 sur le reste (Stripe estimé déduit).
const GROSS = 8400, FEE = 400, ORG = 2350, CLUB = 5480;
const inp = (refundedTotal: number, prevRefunded = 0) => ({ grossCents: GROSS, yunoFeeCents: FEE, refundedTotal, prevRefunded });

describe('refundContext', () => {
  it('rembourser la part vendeurs (frais Yuno gardés) = remboursement total pour les jambes', () => {
    expect(refundContext(inp(8000)).isFull).toBe(true);
    expect(refundContext(inp(7999)).isFull).toBe(false);
  });
  it('delta = cumul − déjà appliqué, jamais négatif', () => {
    expect(refundContext(inp(4000, 2000)).deltaCents).toBe(2000);
    expect(refundContext(inp(2000, 2000)).deltaCents).toBe(0);
  });
});

describe('jambe RETENUE (jamais partie)', () => {
  it('1 billet sur 4 remboursé : la jambe garde les 3/4, pas zéro', () => {
    expect(heldLegAfterRefund(CLUB, inp(2000))).toBe(Math.round(CLUB * 6000 / 8000));
    expect(heldLegAfterRefund(ORG, inp(2000))).toBe(Math.round(ORG * 0.75));
  });
  it('second remboursement : réduit depuis le montant déjà réduit, même résultat que d\'un coup', () => {
    const after1 = heldLegAfterRefund(CLUB, inp(2000));
    const after2 = heldLegAfterRefund(after1, inp(4000, 2000));
    expect(Math.abs(after2 - Math.round(CLUB * 0.5))).toBeLessThanOrEqual(1);
  });
  it('total : jambe annulée', () => {
    expect(heldLegAfterRefund(CLUB, inp(8000))).toBe(0);
    expect(heldLegAfterRefund(CLUB, inp(8400))).toBe(0);
  });
  it('rejeu du même événement : rien ne bouge (delta nul)', () => {
    const after1 = heldLegAfterRefund(CLUB, inp(2000));
    expect(heldLegAfterRefund(after1, inp(2000, 2000))).toBe(after1);
  });
});

describe('jambe VERSÉE', () => {
  it('partiel puis second partiel : chacun reverse SON delta', () => {
    const r1 = releasedLegReversal(CLUB, inp(2000));
    expect(r1.reversal).toBe(Math.round(CLUB * 0.25));
    const r2 = releasedLegReversal(CLUB, inp(4000, 2000));
    expect(r1.reversal + r2.reversal).toBe(Math.round(CLUB * 0.5));
  });
  it('total après un partiel : reverse exactement le reste', () => {
    const r1 = releasedLegReversal(ORG, inp(2000));
    const r2 = releasedLegReversal(ORG, inp(8000, 2000));
    expect(r1.reversal + r2.reversal).toBe(ORG);
    expect(r2.expectedCumulative).toBe(ORG);
  });
  it('rejeu : rien à reverser', () => {
    expect(releasedLegReversal(CLUB, inp(2000, 2000)).reversal).toBe(0);
  });
  it('jamais plus que la jambe', () => {
    expect(releasedLegReversal(CLUB, inp(8400)).reversal).toBe(CLUB);
  });
});
