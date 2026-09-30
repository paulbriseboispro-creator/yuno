// Politique de charge Stripe de Yuno : CHARGES DIRECTES seulement.
//
// Les comptes connectés naissent en « Managed Risk »
// (`defaults.responsibilities.losses_collector = stripe`,
// _shared/stripe-connect-accounts.ts) : Stripe couvre leurs soldes négatifs et,
// en échange, n'admet que des charges DIRECTES (docs.stripe.com/connect/
// risk-management/managed-risk, section « Availability »). C'est la seule forme
// que Stripe accepte aujourd'hui de la plateforme Yuno, qui n'a pas signé
// l'engagement de responsabilité des pertes (Platform profile).
//
// Une charge PLATEFORME partagée par virements (`splitMode: "separate"` :
// collab réparti par Stripe, barème retenu jusqu'au décompte, co-organisation
// répartie par Stripe) sort de ce cadre. Le code reste en place mais s'éteint
// tant que `STRIPE_INDIRECT_CHARGES_ENABLED` ne vaut pas `true`. Ne l'allumer
// qu'après l'engagement de pertes signé chez Stripe ET des comptes créés avec
// `losses_collector = application` : les deux ensemble, jamais l'un sans l'autre.
//
// Décision du 2026-09-29, avant la première collab réelle (WOH) : une collab
// club × orga se règle par virement (une partie encaisse en charge directe,
// Yuno suit la part de l'autre), ou « réglée entre vous ».

import type { SplitResult } from "./payment-split.ts";
import type { RpcClient } from "./rpc-client.ts";

export function indirectChargesEnabled(): boolean {
  return Deno.env.get("STRIPE_INDIRECT_CHARGES_ENABLED") === "true";
}

/** Vrai si ce partage exige une charge plateforme alors que la politique l'interdit. */
export function isBlockedIndirectCharge(split: Pick<SplitResult, "splitMode">): boolean {
  return split.splitMode === "separate" && !indirectChargesEnabled();
}

/**
 * Une vente vient d'être refusée parce que le contrat de la soirée demande un
 * partage Stripe. L'acheteur voit un message neutre ; le super admin, lui, doit
 * savoir qu'une soirée ne peut pas vendre (une alerte par soirée et par jour).
 * Ne lève jamais : l'alerte ne doit pas masquer le refus.
 */
export async function alertIndirectChargeRefused(
  admin: RpcClient,
  ctx: { eventId: string; itemType: "ticket" | "table" | "drink" },
): Promise<void> {
  try {
    await admin.rpc("emit_admin_notification", {
      p_type: "admin_indirect_charge_refused",
      p_title: "Vente refusée : contrat en partage Stripe",
      p_message: `Une vente (${ctx.itemType}) a été refusée : le contrat de cette soirée partage chaque vente via Stripe, ce que les comptes Managed Risk n'admettent pas. Passer le contrat en règlement par virement (avenant) pour rouvrir la vente.`,
      p_priority: "high",
      p_reference_type: "event",
      p_reference_id: ctx.eventId,
      p_metadata: { item_type: ctx.itemType },
      p_dedup_key: `indirect_charge_refused:${ctx.eventId}:${new Date().toISOString().slice(0, 10)}`,
      p_event_id: ctx.eventId,
    });
  } catch {
    // Observabilité seulement.
  }
}
