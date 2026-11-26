// Avoirs (D15, tables VIP vague C2) : modèle pur partagé par la page publique /avoir/:jeton, le téléchargement du client, la Compta de la
// Console (liste, totaux nets, export). La base fige tout (migration 20261227110000) ; ici on ne fait que mettre en forme.
//
// Les montants d'un avoir sont POSITIFS en base et dans ces types ; le document et les totaux nets les portent en négatif.

import {
  creditNoteLines, resolveVatRegime, sellerVat,
  type CreditNoteData, type DocLang,
} from '../../supabase/functions/_shared/pdf-documents';

/** Ce que rendent `get_credit_note_doc` et `get_credit_note_by_token`. */
export interface CreditNoteDoc {
  id: string;
  credit_number: string;
  created_at: string;
  kind: 'ticket' | 'table' | 'order';
  amount: number;
  total_ht: number;
  tva: number;
  base: number;
  fees: number;
  vat_rate: number;
  fee_vat_rate: number;
  reason?: string | null;
  invoice_number: string;
  invoice_date?: string | null;
  event_name?: string | null;
  event_date?: string | null;
  customer_name?: string | null;
  customer_email?: string | null;
  seller?: {
    name?: string | null;
    address?: string | null;
    siret?: string | null;
    rna?: string | null;
    vat_number?: string | null;
    logo_url?: string | null;
    vat_regime?: string | null;
    bde_verified?: boolean | null;
  } | null;
}

/** Une ligne de `get_accounting_credit_notes`. */
export interface AccountingCreditNote {
  id: string;
  credit_number: string;
  created_at: string;
  type: 'ticket' | 'table' | 'order';
  amount: number;
  total_ht: number;
  tva: number;
  event_id?: string;
  event_name?: string;
  customer_name?: string;
  customer_email?: string;
  invoice_id: string;
  invoice_number: string;
  reason?: string;
}

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Le document à dessiner, depuis la lecture de la base. `lang` : celle du lecteur. */
export function creditNoteToPdfData(doc: CreditNoteDoc, lang: DocLang = 'fr'): Omit<CreditNoteData, 'sellerLogo'> {
  const seller = doc.seller ?? {};
  // Mention légale : seulement quand l'avoir ne porte pas de TVA (le taux figé de la facture fait foi).
  const regime = resolveVatRegime({ vat_regime: seller.vat_regime, bde_verified: seller.bde_verified });
  const vatMention = num(doc.vat_rate) === 0 && regime !== 'subject' ? sellerVat(regime, lang).mention : undefined;
  return {
    lang,
    creditNumber: doc.credit_number,
    creditDate: new Date(doc.created_at),
    invoiceNumber: doc.invoice_number,
    invoiceDate: doc.invoice_date ? new Date(doc.invoice_date) : undefined,
    reason: doc.reason || undefined,
    sellerName: seller.name || '',
    sellerAddress: seller.address || undefined,
    sellerSiret: seller.siret || undefined,
    sellerRna: seller.rna || undefined,
    sellerVatNumber: seller.vat_number || undefined,
    vatMention,
    customerName: doc.customer_name || doc.customer_email || '',
    customerEmail: doc.customer_email || '',
    eventTitle: doc.event_name || undefined,
    eventDate: doc.event_date ? new Date(doc.event_date) : undefined,
    lines: creditNoteLines({
      lang, kind: doc.kind, base: num(doc.base), fees: num(doc.fees),
      vatRate: num(doc.vat_rate), feeVatRate: num(doc.fee_vat_rate), totalHt: num(doc.total_ht),
    }),
  };
}

export function creditNoteFilename(doc: Pick<CreditNoteDoc, 'credit_number'>): string {
  return `${doc.credit_number}.pdf`;
}

/** Une facture et les avoirs qui l'annulent : le net. */
export interface NetTotals {
  invoices: number;
  credits: number;
  net: number;
  invoicesHt: number;
  creditsHt: number;
  netHt: number;
}

/** Totaux nets d'une période : factures moins avoirs (TTC et HT), au centime. */
export function netTotals(
  invoices: { amount: number | string; total_ht?: number | string | null }[],
  credits: { amount: number | string; total_ht?: number | string | null }[],
): NetTotals {
  const sum = (rows: { amount: number | string; total_ht?: number | string | null }[], k: 'amount' | 'total_ht') =>
    round2(rows.reduce((s, r) => s + num(r[k]), 0));
  const inv = sum(invoices, 'amount');
  const cr = sum(credits, 'amount');
  const invHt = sum(invoices, 'total_ht');
  const crHt = sum(credits, 'total_ht');
  return { invoices: inv, credits: cr, net: round2(inv - cr), invoicesHt: invHt, creditsHt: crHt, netHt: round2(invHt - crHt) };
}

/** Avoiré d'une facture donnée (somme des avoirs qui la visent). */
export function creditedOn(invoiceId: string, credits: Pick<AccountingCreditNote, 'invoice_id' | 'amount'>[]): number {
  return round2(credits.filter((c) => c.invoice_id === invoiceId).reduce((s, c) => s + num(c.amount), 0));
}
