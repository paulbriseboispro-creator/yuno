// Modèle d'une facture à dessiner en PDF, lu depuis la ligne `invoices`.
//
// Une facture de TABLE écrite depuis la vague « tables A bis » (migration 20261225220000) porte TOUTES ses lignes
// dans `items` — l'acompte (kind « deposit » ou « table ») et la ligne « Frais de service » (kind « fee ») —, ses colonnes
// service_fee / management_fee valent 0, et `total_ht` / `tva` sont déjà calculés au taux du vendeur. Le PDF ne
// redessine donc aucune ligne de frais à côté et ne recalcule pas la TVA : la somme des lignes est le total TTC.
// Une facture plus ancienne (billet, commande, table d'avant, démo) garde le calcul d'avant.

export interface StoredInvoiceItem {
  kind?: string;
  description?: string;
  quantity?: number;
  unitPrice?: number;
  total?: number;
}

export interface StoredInvoiceRow {
  type: 'ticket' | 'table' | 'order';
  amount: number;
  items?: StoredInvoiceItem[] | null;
  service_fee?: number | string | null;
  management_fee?: number | string | null;
  insurance_fee?: number | string | null;
  total_ht?: number | string | null;
  tva?: number | string | null;
  invoice_kind?: string | null;
  remaining_on_site?: number | string | null;
}

export interface PdfInvoiceItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface InvoicePdfModel {
  items: PdfInvoiceItem[];
  serviceFee: number;
  managementFee: number;
  insuranceFee: number;
  totalHT: number;
  tva: number;
  totalTTC: number;
  /** « deposit » = facture d'acompte : le solde est réglé au club, hors total. */
  invoiceKind: 'deposit' | null;
  /** Reste à régler sur place (information, jamais ajouté au total). */
  remainingOnSite: number;
}

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Vrai quand les lignes de la facture de table sont toutes dans `items` (écriture « A bis »). */
export function isSelfContainedTableInvoice(row: Pick<StoredInvoiceRow, 'type' | 'items'>): boolean {
  return row.type === 'table'
    && Array.isArray(row.items)
    && row.items.length > 0
    && row.items.some((it) => it && typeof it.kind === 'string' && it.kind !== '');
}

/**
 * @param fallbackTax calcul d'avant (articles au taux du vendeur, frais à 20 %), utilisé tant que la facture ne
 *   porte pas sa propre TVA. Reçoit le total des frais lus en colonnes.
 */
export function buildInvoicePdfModel(
  row: StoredInvoiceRow,
  fallbackTax: (amount: number, feesTotal: number) => { totalHT: number; tva: number },
  fallbackItems: () => PdfInvoiceItem[],
): InvoicePdfModel {
  const amount = num(row.amount);
  const stored = Array.isArray(row.items) && row.items.length > 0
    ? row.items.map((it) => ({
      description: it.description || 'Item',
      quantity: it.quantity || 1,
      unitPrice: num(it.unitPrice),
      total: num(it.total),
    }))
    : fallbackItems();

  if (isSelfContainedTableInvoice(row)) {
    const totalHT = row.total_ht != null ? num(row.total_ht) : amount / 1.2;
    const tva = row.tva != null ? num(row.tva) : amount - totalHT;
    return {
      items: stored,
      // Les frais sont des lignes de `items` : jamais redessinés à côté.
      serviceFee: 0,
      managementFee: 0,
      insuranceFee: 0,
      totalHT,
      tva,
      totalTTC: amount,
      invoiceKind: row.invoice_kind === 'deposit' ? 'deposit' : null,
      remainingOnSite: row.invoice_kind === 'deposit' ? Math.max(0, num(row.remaining_on_site)) : 0,
    };
  }

  const serviceFee = num(row.service_fee);
  const managementFee = num(row.management_fee);
  const insuranceFee = num(row.insurance_fee);
  const tax = fallbackTax(amount, serviceFee + managementFee + insuranceFee);
  return {
    items: stored,
    serviceFee,
    managementFee,
    insuranceFee,
    totalHT: tax.totalHT,
    tva: tax.tva,
    totalTTC: amount,
    invoiceKind: row.invoice_kind === 'deposit' ? 'deposit' : null,
    remainingOnSite: row.invoice_kind === 'deposit' ? Math.max(0, num(row.remaining_on_site)) : 0,
  };
}

/** Somme de toutes les lignes dessinées (articles + frais en colonnes), au centime. */
export function drawnLinesTotal(model: InvoicePdfModel): number {
  return round2(
    model.items.reduce((s, it) => s + it.total, 0) + model.serviceFee + model.managementFee + model.insuranceFee,
  );
}
