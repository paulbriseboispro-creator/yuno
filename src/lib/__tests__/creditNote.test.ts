import { describe, expect, it } from 'vitest';
import { creditNoteLines } from '../../../supabase/functions/_shared/pdf-documents';
import { creditedOn, creditNoteFilename, creditNoteToPdfData, netTotals, type CreditNoteDoc } from '../creditNote';

const doc = (over: Partial<CreditNoteDoc> = {}): CreditNoteDoc => ({
  id: 'c1', credit_number: 'FAC-AV-2026-00001', created_at: '2026-11-27T10:00:00Z', kind: 'table',
  amount: 45.61, total_ht: 38.01, tva: 7.6, base: 40, fees: 5.61, vat_rate: 20, fee_vat_rate: 20,
  invoice_number: 'FAC-2026-00012', customer_email: 'a@b.c', customer_name: 'Ada',
  seller: { name: 'Club', vat_regime: 'subject' }, ...over,
});

describe('creditNoteLines', () => {
  it('la somme des lignes retombe exactement sur le HT et le TTC de l\'avoir', () => {
    const lines = creditNoteLines({ kind: 'table', base: 40, fees: 5.61, vatRate: 20, feeVatRate: 20, totalHt: 38.01 });
    expect(lines).toHaveLength(2);
    expect(lines.reduce((s, l) => s + l.ttc, 0)).toBeCloseTo(45.61, 2);
    expect(lines.reduce((s, l) => s + l.ht, 0)).toBeCloseTo(38.01, 2);
    expect(lines.reduce((s, l) => s + l.vat, 0)).toBeCloseTo(7.6, 2);
  });

  it('franchise : base à 0 %, frais Yuno à 20 %', () => {
    const totalHt = 100 + Math.round((4 / 1.2) * 100) / 100;
    const lines = creditNoteLines({ kind: 'table', base: 100, fees: 4, vatRate: 0, feeVatRate: 20, totalHt });
    expect(lines[0]).toMatchObject({ ttc: 100, ht: 100, vat: 0, vatRate: 0 });
    expect(lines[1].vatRate).toBe(20);
    expect(lines[1].ht).toBeCloseTo(3.33, 2);
  });

  it('D14 : frais absorbés par un vendeur en franchise, tout est à 0 %', () => {
    const lines = creditNoteLines({ kind: 'table', base: 200, fees: 3.31, vatRate: 0, feeVatRate: 0, totalHt: 203.31 });
    expect(lines.every((l) => l.vat === 0 && l.vatRate === 0)).toBe(true);
    expect(lines.reduce((s, l) => s + l.ht, 0)).toBeCloseTo(203.31, 2);
  });

  it('une seule ligne quand il n\'y a pas de frais', () => {
    const lines = creditNoteLines({ kind: 'ticket', base: 4, fees: 0, vatRate: 20, feeVatRate: 20, totalHt: 3.33 });
    expect(lines).toEqual([{ label: 'Billet', ttc: 4, ht: 3.33, vat: 0.67, vatRate: 20 }]);
  });
});

describe('creditNoteToPdfData', () => {
  it('assujetti : pas de mention de TVA', () => {
    expect(creditNoteToPdfData(doc()).vatMention).toBeUndefined();
  });
  it('franchise à 0 % : la mention légale suit la langue', () => {
    const d = doc({ vat_rate: 0, fee_vat_rate: 0, seller: { name: 'Orga', vat_regime: 'franchise' } });
    expect(creditNoteToPdfData(d, 'fr').vatMention).toContain('293 B');
    expect(creditNoteToPdfData(d, 'en').vatMention).toContain('293 B');
  });
  it('association exonérée sans régime saisi', () => {
    const d = doc({ vat_rate: 0, fee_vat_rate: 20, seller: { name: 'Asso', vat_regime: null, bde_verified: true } });
    expect(creditNoteToPdfData(d).vatMention).toContain('261-7-1');
  });
  it('un avoir d\'un assujetti à 20 % n\'affiche jamais de mention même si le client est une asso', () => {
    expect(creditNoteToPdfData(doc({ seller: { name: 'X', vat_regime: 'subject', bde_verified: true } })).vatMention).toBeUndefined();
  });
  it('reprend facture d\'origine, motif et client', () => {
    const d = creditNoteToPdfData(doc({ reason: 'soirée annulée' }));
    expect(d.invoiceNumber).toBe('FAC-2026-00012');
    expect(d.reason).toBe('soirée annulée');
    expect(d.customerName).toBe('Ada');
    expect(creditNoteFilename(doc())).toBe('FAC-AV-2026-00001.pdf');
  });
});

describe('totaux nets', () => {
  const invoices = [{ amount: 145.61, total_ht: 121.34 }, { amount: 20.99, total_ht: 17.49 }];
  const credits = [{ amount: 50, total_ht: 41.67 }, { amount: 4, total_ht: 3.33 }];
  it('factures moins avoirs, TTC et HT, au centime', () => {
    const n = netTotals(invoices, credits);
    expect(n).toEqual({ invoices: 166.6, credits: 54, net: 112.6, invoicesHt: 138.83, creditsHt: 45, netHt: 93.83 });
  });
  it('sans avoir, le net est le facturé', () => {
    expect(netTotals(invoices, []).net).toBe(166.6);
  });
  it('accepte des montants texte (numeric de la base)', () => {
    expect(netTotals([{ amount: '10.10' }], [{ amount: '0.10' }]).net).toBe(10);
  });
  it('avoiré d\'une facture', () => {
    const cs = [{ invoice_id: 'a', amount: 50 }, { invoice_id: 'a', amount: 4 }, { invoice_id: 'b', amount: 9 }];
    expect(creditedOn('a', cs)).toBe(54);
    expect(creditedOn('z', cs)).toBe(0);
  });
});
