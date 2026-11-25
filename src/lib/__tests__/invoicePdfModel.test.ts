import { describe, expect, it } from 'vitest';
import { buildInvoicePdfModel, drawnLinesTotal, isSelfContainedTableInvoice, type StoredInvoiceRow } from '../invoicePdfModel';

// Lignes telles que le trigger save_invoice_on_creation (migration 20261225220000) les écrit pour une table.
const fallbackTax20 = (amount: number) => ({ totalHT: amount / 1.2, tva: amount - amount / 1.2 });
const noItems = () => [];
const r2 = (n: number) => Math.round(n * 100) / 100;

function tableRow(over: Partial<StoredInvoiceRow>): StoredInvoiceRow {
  return { type: 'table', service_fee: 0, management_fee: 0, insurance_fee: 0, ...over } as StoredInvoiceRow;
}

describe('invoicePdfModel — facture de table', () => {
  it('acompte simple : titre d\'acompte, reste hors total, la somme des lignes est le TTC', () => {
    const row = tableRow({
      amount: 145.6,
      items: [
        { kind: 'deposit', description: 'Acompte table Gold Vip', quantity: 1, unitPrice: 140, total: 140 },
        { kind: 'fee', description: 'Frais de service', quantity: 1, unitPrice: 5.6, total: 5.6 },
      ],
      total_ht: 121.3333, tva: 24.2667, invoice_kind: 'deposit', remaining_on_site: 360,
    });
    const m = buildInvoicePdfModel(row, fallbackTax20, noItems);
    expect(isSelfContainedTableInvoice(row)).toBe(true);
    expect(m.invoiceKind).toBe('deposit');
    expect(m.remainingOnSite).toBe(360);
    expect(m.serviceFee).toBe(0);
    expect(m.managementFee).toBe(0);
    expect(drawnLinesTotal(m)).toBe(145.6);
    expect(drawnLinesTotal(m)).toBe(m.totalTTC);
    // TVA stockée reprise telle quelle (et non recalculée au front).
    expect(m.totalHT).toBeCloseTo(121.3333, 4);
    expect(m.tva).toBeCloseTo(24.2667, 4);
  });

  it('paiement intégral : facture normale, pas de reste, deux lignes', () => {
    const row = tableRow({
      amount: 312,
      items: [
        { kind: 'table', description: 'Table VIP Silver VIP', quantity: 1, unitPrice: 300, total: 300 },
        { kind: 'fee', description: 'Frais de service', quantity: 1, unitPrice: 12, total: 12 },
      ],
      total_ht: 260, tva: 52, invoice_kind: null, remaining_on_site: null,
    });
    const m = buildInvoicePdfModel(row, fallbackTax20, noItems);
    expect(m.invoiceKind).toBeNull();
    expect(m.remainingOnSite).toBe(0);
    expect(drawnLinesTotal(m)).toBe(m.totalTTC);
  });

  it('frais absorbés : la ligne est la prise en charge des frais Stripe, jamais les frais de gestion en plus', () => {
    // management_fee de la réservation (8 €) NON payé par le client : la colonne de la facture reste à 0.
    const row = tableRow({
      amount: 203.31,
      items: [
        { kind: 'deposit', description: 'Acompte table Gold Vip', quantity: 1, unitPrice: 200, total: 200 },
        { kind: 'fee', description: 'Frais de service', quantity: 1, unitPrice: 3.31, total: 3.31 },
      ],
      management_fee: 0, total_ht: 169.4417, tva: 33.8683, invoice_kind: 'deposit', remaining_on_site: 600,
    });
    const m = buildInvoicePdfModel(row, fallbackTax20, noItems);
    expect(m.managementFee).toBe(0);
    expect(drawnLinesTotal(m)).toBe(203.31);
    expect(m.items.map((i) => i.total)).toEqual([200, 3.31]);
  });

  it('franchise de TVA : la TVA stockée (frais seulement) est reprise, pas 20 % sur tout', () => {
    const row = tableRow({
      amount: 104,
      items: [
        { kind: 'deposit', description: 'Acompte table VIP', quantity: 1, unitPrice: 100, total: 100 },
        { kind: 'fee', description: 'Frais de service', quantity: 1, unitPrice: 4, total: 4 },
      ],
      total_ht: 103.3333, tva: 0.6667, invoice_kind: 'deposit', remaining_on_site: 300,
    });
    const m = buildInvoicePdfModel(row, fallbackTax20, noItems);
    expect(r2(m.tva)).toBe(0.67);
    expect(r2(m.totalHT + m.tva)).toBe(104);
    // Un recalcul « tout à 20 % » donnerait 17,33 € de TVA : faux pour ce vendeur.
    expect(r2(fallbackTax20(104).tva)).toBe(17.33);
  });
});

describe('invoicePdfModel — anciennes factures inchangées', () => {
  it('un billet garde le calcul d\'avant (frais en colonnes, TVA recalculée)', () => {
    const row: StoredInvoiceRow = {
      type: 'ticket', amount: 26, service_fee: 2, management_fee: 0, insurance_fee: 0,
      items: [{ description: 'Billet', quantity: 1, unitPrice: 24, total: 24 }],
    };
    const m = buildInvoicePdfModel(row, fallbackTax20, noItems);
    expect(m.serviceFee).toBe(2);
    expect(m.totalHT).toBeCloseTo(26 / 1.2, 6);
    expect(drawnLinesTotal(m)).toBe(26);
    expect(m.invoiceKind).toBeNull();
  });

  it('une facture de table d\'avant (sans kind dans les lignes) garde ses frais en colonnes', () => {
    const row: StoredInvoiceRow = {
      type: 'table', amount: 108, service_fee: 0, management_fee: 8, insurance_fee: 0,
      items: [{ description: 'Table VIP', quantity: 1, unitPrice: 100, total: 100 }],
    };
    expect(isSelfContainedTableInvoice(row)).toBe(false);
    const m = buildInvoicePdfModel(row, fallbackTax20, noItems);
    expect(m.managementFee).toBe(8);
    expect(drawnLinesTotal(m)).toBe(108);
  });
});
