// Remboursement d'une vente à jambes (co-soirée, charge plateforme) : ce que
// devient chaque jambe. Pur, testé (src/lib/__tests__/refundLegs.test.ts),
// appelé par stripe-webhook `charge.refunded`.
//
// Les jambes se paient sur la part VENDEURS (brut − frais Yuno) : un
// remboursement de club ne rend jamais les frais Yuno, donc « tout rembourser »
// = rembourser cette part. `refundedTotal` est le cumul Stripe
// (`amount_refunded`), `prevRefunded` ce qui a déjà été appliqué aux jambes.

export interface RefundLegInput {
  grossCents: number;
  yunoFeeCents: number;
  refundedTotal: number;
  prevRefunded: number;
}

export interface RefundContext {
  sellerBase: number;
  deltaCents: number;
  isFull: boolean;
}

export function refundContext(i: RefundLegInput): RefundContext {
  const sellerBase = Math.max(1, i.grossCents - Math.max(0, i.yunoFeeCents || 0));
  return {
    sellerBase,
    deltaCents: Math.max(0, i.refundedTotal - i.prevRefunded),
    isFull: i.refundedTotal >= sellerBase,
  };
}

/**
 * Jambe RETENUE (jamais partie) : montant qu'elle garde après ce remboursement.
 * `amountCents` = son montant actuel (déjà réduit par les remboursements passés).
 * 0 = la jambe est annulée.
 */
export function heldLegAfterRefund(amountCents: number, i: RefundLegInput): number {
  const c = refundContext(i);
  if (c.isFull) return 0;
  const remainingBefore = Math.max(0, c.sellerBase - Math.min(i.prevRefunded, c.sellerBase));
  if (remainingBefore <= 0) return 0;
  return Math.max(0, Math.round((amountCents * (c.sellerBase - i.refundedTotal)) / remainingBefore));
}

/**
 * Jambe VERSÉE : montant à reverser pour CE remboursement (le delta), et cumul
 * attendu une fois reversée. `amountCents` = montant transféré à l'origine.
 */
export function releasedLegReversal(amountCents: number, i: RefundLegInput): { reversal: number; expectedCumulative: number } {
  const c = refundContext(i);
  const already = Math.round((amountCents * Math.min(i.prevRefunded, c.sellerBase)) / c.sellerBase);
  const expectedCumulative = c.isFull ? amountCents : Math.min(amountCents, Math.round((amountCents * i.refundedTotal) / c.sellerBase));
  return { reversal: Math.max(0, Math.min(amountCents, expectedCumulative - already)), expectedCumulative };
}
