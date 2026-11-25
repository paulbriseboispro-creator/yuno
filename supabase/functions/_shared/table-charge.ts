// Ce que la session Stripe d'une table prélève, en centimes : UNE seule source pour les `unit_amount` envoyés à Stripe,
// pour `table_reservations.charged_lines` / `charged_total` (lus par la facture d'acompte, l'e-mail « payé en ligne » et
// le repli d'annulation) et pour rien d'autre. PUR et SANS IMPORT : testé par src/lib/__tests__/tableCharge.test.ts.

export interface ChargedLine {
  kind: "deposit" | "fee";
  cents: number;
}

export interface TableCharge {
  lines: ChargedLine[];
  totalCents: number;
  /** Somme des lignes en euros, exacte au centime. */
  totalEuros: number;
}

/**
 * @param discountedDeposit acompte après remise (euros) ; 0 = pas de ligne d'acompte (frais seuls).
 * @param transactionFee ligne « Frais de service » de la session (euros) : les frais de gestion, ou — quand le club les
 *   absorbe — l'estimation des frais Stripe que le client prend à sa charge. Gardée même à 0 (la session la porte toujours).
 */
export function tableCharge(discountedDeposit: number, transactionFee: number): TableCharge {
  const depositCents = Math.max(0, Math.round((Number(discountedDeposit) || 0) * 100));
  const feeCents = Math.max(0, Math.round((Number(transactionFee) || 0) * 100));
  const lines: ChargedLine[] = [];
  if (depositCents > 0) lines.push({ kind: "deposit", cents: depositCents });
  lines.push({ kind: "fee", cents: feeCents });
  const totalCents = lines.reduce((s, l) => s + l.cents, 0);
  return { lines, totalCents, totalEuros: totalCents / 100 };
}

/** Montant (euros) d'une catégorie de lignes stockées, en centimes exacts ; 0 si absente ou illisible. */
export function chargedCents(lines: unknown, kind: ChargedLine["kind"]): number {
  if (!Array.isArray(lines)) return 0;
  let sum = 0;
  for (const l of lines) {
    const row = l as { kind?: unknown; cents?: unknown } | null;
    if (row && row.kind === kind && Number.isFinite(Number(row.cents))) sum += Math.round(Number(row.cents));
  }
  return sum;
}
