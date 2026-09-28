// Porte « paiements prêts » des checkouts, calée sur le split RÉEL.
//
// Avant : le checkout billets ne regardait que `event.venue_id ? club : orga`.
// Sur un collab mené par l'orga il contrôlait le compte de l'orga seul — tous
// les billets étaient refusés si l'orga n'avait pas Stripe, même quand le
// contrat faisait encaisser le club — et ne vérifiait jamais le club utilisé
// en `on_behalf_of`. On résout donc le split d'abord (montant sonde), puis on
// vérifie EXACTEMENT les comptes que la charge utilisera.

import { resolvePaymentSplit, type SplitInput, type SplitResult } from "./payment-split.ts";

export type NotReadyParty = "venue" | "organizer";

export interface PayoutAccounts {
  venueStripeAccountId: string | null;
  venueChargesEnabled: boolean;
  organizerStripeAccountId: string | null;
  organizerChargesEnabled: boolean;
}

/** Comptes Stripe réellement utilisés par une charge (destination, jambes, vendeur de record). */
export function accountsUsedBySplit(split: SplitResult): string[] {
  const ids = [split.primary.accountId, split.secondary?.accountId, split.onBehalfOf];
  return [...new Set(ids.filter((x): x is string => !!x))];
}

/**
 * Résout le split avec un montant sonde et dit quelle partie bloque la vente :
 * `{ missing }` si un compte manque, `{ inactive }` si un compte utilisé n'a pas
 * les paiements activés, `{ split }` sinon.
 */
export function checkPayoutReadiness(
  input: Omit<SplitInput, "grossAmount" | "venueStripeAccountId" | "organizerStripeAccountId">,
  acc: PayoutAccounts,
): { split: SplitResult } | { missing: NotReadyParty } | { inactive: NotReadyParty } {
  let split: SplitResult;
  try {
    split = resolvePaymentSplit({
      ...input,
      grossAmount: 100,
      venueStripeAccountId: acc.venueStripeAccountId,
      organizerStripeAccountId: acc.organizerStripeAccountId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/Organizer has no Stripe/i.test(msg)) return { missing: "organizer" };
    if (/Both parties/i.test(msg)) return { missing: acc.venueStripeAccountId ? "organizer" : "venue" };
    return { missing: "venue" };
  }
  for (const id of accountsUsedBySplit(split)) {
    if (id === acc.venueStripeAccountId && !acc.venueChargesEnabled) return { inactive: "venue" };
    if (id === acc.organizerStripeAccountId && !acc.organizerChargesEnabled) return { inactive: "organizer" };
  }
  return { split };
}
