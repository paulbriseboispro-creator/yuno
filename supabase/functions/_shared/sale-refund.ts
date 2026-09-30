// Remboursement d'une vente (commande de boissons, billet, table VIP) : ce qui
// peut être rendu, ce que devient la vente, et qui a le droit de le faire.
//
// PUR et SANS IMPORT : le front l'importe tel quel (Remboursements, service VIP)
// pour afficher exactement le plafond que le serveur appliquera, et les tests
// vitest le couvrent (src/lib/__tests__/saleRefund.test.ts). Appelé par
// owner-refund, cancel-ticket et stripe-webhook `charge.refunded`.
//
// Tous les montants sont calculés en CENTIMES : `refund_amount` est cumulatif,
// et des additions de flottants successives (5,10 + 4,90 …) finissaient par
// laisser un reste d'un centime qui empêchait la vente de passer « remboursée ».

export type SaleKind = "order" | "ticket" | "table_reservation";

export const SALE_TABLE: Record<SaleKind, "orders" | "tickets" | "table_reservations"> = {
  order: "orders",
  ticket: "tickets",
  table_reservation: "table_reservations",
};

export function isSaleKind(v: unknown): v is SaleKind {
  return v === "order" || v === "ticket" || v === "table_reservation";
}

type Num = number | string | null | undefined;

/** Colonnes de la vente lues pour le plafond (noms de la base). */
export interface SaleAmounts {
  /** orders.total */
  total?: Num;
  /** tickets.total_price / table_reservations.total_price */
  total_price?: Num;
  service_fee?: Num;
  insurance_fee?: Num;
  management_fee?: Num;
  deposit?: Num;
  fee_absorbed?: boolean | null;
  refund_amount?: Num;
}

export function toCents(v: Num): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function fromCents(c: number): number {
  return Math.round(c) / 100;
}

/**
 * Plafond remboursable CÔTÉ CLUB, en centimes : ce que le client a payé moins
 * les frais Yuno qu'il a payés lui-même. Yuno ne rend jamais ses frais ; s'ils
 * ont été absorbés par le club (`fee_absorbed`), le client ne les a pas payés à
 * part et tout ce qu'il a versé est remboursable.
 *
 * - commande : total − frais de service ;
 * - billet : total − frais de service − assurance annulation (l'assurance est
 *   consommée, et elle revient à Yuno : le club n'a pas à la rendre) ;
 * - table : l'ACOMPTE seul — `total_price` porte le budget complet de la table,
 *   jamais débité au checkout. Repli historique sans acompte : total − frais.
 */
export function refundCapCents(kind: SaleKind, s: SaleAmounts): number {
  const absorbed = s.fee_absorbed === true;
  if (kind === "order") {
    return Math.max(0, toCents(s.total) - (absorbed ? 0 : toCents(s.service_fee)));
  }
  if (kind === "ticket") {
    return Math.max(0, toCents(s.total_price) - (absorbed ? 0 : toCents(s.service_fee)) - toCents(s.insurance_fee));
  }
  const deposit = toCents(s.deposit);
  if (deposit > 0) return deposit;
  return Math.max(0, toCents(s.total_price) - toCents(s.service_fee) - (absorbed ? 0 : toCents(s.management_fee)));
}

/** Déjà rendu au client (cumul), en centimes. */
export function alreadyRefundedCents(s: SaleAmounts): number {
  return Math.max(0, toCents(s.refund_amount));
}

/** Ce qu'il reste à rendre, en centimes. */
export function remainingRefundableCents(kind: SaleKind, s: SaleAmounts): number {
  return Math.max(0, refundCapCents(kind, s) - alreadyRefundedCents(s));
}

export interface RefundPlan {
  /** Montant de CE remboursement. */
  amountCents: number;
  /** `refund_amount` une fois ce remboursement fait. */
  cumulativeCents: number;
  /** La vente est entièrement rendue : elle passe « remboursée ». */
  isFull: boolean;
}

/**
 * Remboursement demandé depuis Yuno (Console, super admin, assurance). Le montant
 * demandé est ramené à ce qui reste ; `null` = plus rien à rendre ou montant nul.
 */
export function planRefund(capCents: number, alreadyCents: number, requestedCents: number): RefundPlan | null {
  const remaining = Math.max(0, capCents - Math.max(0, alreadyCents));
  const amount = Math.min(Math.max(0, Math.round(requestedCents)), remaining);
  if (amount <= 0) return null;
  const cumulative = Math.max(0, alreadyCents) + amount;
  return { amountCents: amount, cumulativeCents: cumulative, isFull: cumulative >= capCents };
}

export interface ChargeRefundPlan {
  /** `refund_amount` à écrire : le cumul Stripe (`charge.amount_refunded`). */
  cumulativeCents: number;
  /** Ce que Yuno ne connaissait pas encore. 0 = déjà enregistré (rejeu, ou remboursement fait depuis Yuno). */
  deltaCents: number;
  isFull: boolean;
}

/**
 * Remboursement constaté chez Stripe (`charge.refunded`), fait depuis Yuno OU
 * depuis le tableau de bord Stripe du pro (charge directe). `amount_refunded`
 * est CUMULÉ : la base retient le plus grand cumul vu, jamais moins — un
 * événement en retard ou rejoué ne fait rien. Totale dès que le client a
 * récupéré le plafond côté club, ou que toute la charge est rendue.
 */
export function planChargeRefund(
  capCents: number,
  alreadyCents: number,
  chargeAmountCents: number,
  chargeRefundedCents: number,
): ChargeRefundPlan {
  const cumulative = Math.max(0, Math.round(chargeRefundedCents));
  return {
    cumulativeCents: cumulative,
    deltaCents: Math.max(0, cumulative - Math.max(0, alreadyCents)),
    isFull: cumulative > 0 && (cumulative >= capCents || cumulative >= chargeAmountCents),
  };
}

/**
 * Ce qu'on écrit sur la vente quand elle devient entièrement remboursée. Une
 * commande remboursée ne se sert plus : son jeton est consommé et elle sort de
 * l'écran du bar. Les effets d'un billet (places rendues à la jauge, consos
 * annulées) sont portés par le trigger `trg_release_refunded_ticket`.
 */
export function fullRefundPatch(kind: SaleKind): Record<string, unknown> {
  return kind === "order"
    ? { status: "refunded", archived: true, token_used: true }
    : { status: "refunded" };
}

/** Une partie de la soirée qui a pu ENCAISSER une vente. */
export interface SaleParty {
  party: "venue" | "organizer";
  id: string;
  /** Son compte Stripe Connect (`venues.stripe_account_id`, `profiles.stripe_connect_account_id`). */
  accountId: string | null;
}

export type SaleCollector = Pick<SaleParty, "party" | "id">;

/**
 * Les parties d'une soirée, la PRINCIPALE d'abord : le club qui la mène
 * (`venue_id`), sinon l'organisateur qui la mène (`organizer_user_id`), puis
 * les partenaires. C'est l'ordre du checkout (club effectif, puis
 * organisateur effectif).
 */
export function saleParties(
  ev: {
    venue_id?: string | null;
    partner_venue_id?: string | null;
    organizer_user_id?: string | null;
    partner_organizer_id?: string | null;
  },
  accounts: { venues: Record<string, string | null>; organizers: Record<string, string | null> },
): SaleParty[] {
  const out: SaleParty[] = [];
  const add = (party: SaleParty["party"], id: string | null | undefined) => {
    if (!id || out.some((p) => p.party === party && p.id === id)) return;
    out.push({ party, id, accountId: (party === "venue" ? accounts.venues[id] : accounts.organizers[id]) ?? null });
  };
  add("venue", ev.venue_id);
  add("organizer", ev.organizer_user_id);
  add("venue", ev.partner_venue_id);
  add("organizer", ev.partner_organizer_id);
  return out;
}

/**
 * Qui a ENCAISSÉ la vente — et donc qui la rembourse. En charge directe,
 * l'argent arrive sur le compte Stripe d'une partie et c'est de ce compte
 * qu'il repart : seule cette partie décide de le rendre (décision de Paul,
 * 30/09 : « c'est l'organisateur principal qui les gère, c'est sur son compte
 * que tout l'argent est viré »). Un partenaire de collab ou un co-hôte ne
 * rembourse jamais avec l'argent d'un autre.
 *
 * Le compte de la vente (`stripe_connected_account_id`) désigne la partie ;
 * sans compte (ancienne charge plateforme) ou sans correspondance, c'est la
 * partie PRINCIPALE. Une commande de boissons revient toujours au club du bar.
 */
export function saleCollector(
  kind: SaleKind,
  connectedAccountId: string | null | undefined,
  parties: SaleParty[],
): SaleCollector | null {
  const pick = (p: SaleParty | undefined): SaleCollector | null => (p ? { party: p.party, id: p.id } : null);
  if (kind === "order") return pick(parties.find((p) => p.party === "venue"));
  if (connectedAccountId) {
    const match = parties.find((p) => p.accountId && p.accountId === connectedAccountId);
    if (match) return pick(match);
  }
  return pick(parties[0]);
}

/** Les droits de l'appelant sur l'ENCAISSEUR de la vente, vérifiés côté serveur. */
export interface CollectorRights {
  /** Super admin (support plateforme). */
  isAdmin: boolean;
  /** Propriétaire du club encaisseur, ou manager avec le droit « Remboursements » (`can_manage_refunds`). */
  clubRefunder: boolean;
  /** L'organisateur encaisseur lui-même, ou un membre de son équipe autorisé à rembourser (admin, ou `can_refund`). */
  orgRefunder: boolean;
}

/**
 * Qui peut rembourser une vente : son encaisseur (et ceux à qui il a délégué ce
 * droit), et le super admin. Miroir exact de ce que la Console propose.
 */
export function refundAllowed(collector: SaleCollector | null, r: CollectorRights): boolean {
  if (r.isAdmin) return true;
  if (!collector) return false;
  return collector.party === "venue" ? r.clubRefunder : r.orgRefunder;
}
