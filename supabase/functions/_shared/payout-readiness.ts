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

/**
 * Même porte, mais un compte « pas encore actif » EN BASE est revérifié chez
 * Stripe avant de refuser l'acheteur. `charges_enabled` n'est qu'un miroir,
 * rafraîchi par la Console ou le webhook Connect : Stripe active souvent
 * l'encaissement quelques minutes après la fin du formulaire, pendant que
 * personne n'a la Console ouverte. `heal` redemande à Stripe (et répare la
 * base) ; il rend `true` si le compte encaisse bien. Au plus deux parties.
 */
export async function checkPayoutReadinessHealing(
  input: Omit<SplitInput, "grossAmount" | "venueStripeAccountId" | "organizerStripeAccountId">,
  acc: PayoutAccounts,
  heal: (party: NotReadyParty, accountId: string) => Promise<boolean>,
): Promise<{ split: SplitResult } | { missing: NotReadyParty } | { inactive: NotReadyParty }> {
  let accounts = acc;
  let result = checkPayoutReadiness(input, accounts);
  for (let i = 0; i < 2 && "inactive" in result; i++) {
    const party = result.inactive;
    const accountId = party === "venue" ? accounts.venueStripeAccountId : accounts.organizerStripeAccountId;
    if (!accountId || !(await heal(party, accountId))) break;
    accounts = party === "venue"
      ? { ...accounts, venueChargesEnabled: true }
      : { ...accounts, organizerChargesEnabled: true };
    result = checkPayoutReadiness(input, accounts);
  }
  return result;
}
