import jsPDF from 'jspdf';
import type { Language } from '@/contexts/LanguageContext';

/**
 * Compact per-event accounting report PDF (FR/EN/ES).
 * Renders the same "Financial report per event — your co-production share"
 * card the owner/organizer Compta page shows on screen: a line-item table
 * (rate, qty, HT share, TTC share) plus HT / VAT / balance totals.
 *
 * Distinct from lib/generateInvoicePDF.ts (a single legal customer invoice).
 */

export interface AccountingPdfLine {
  label: string;
  qty: number;
  htShare: number;
  ttcShare: number;
}

export interface AccountingPdfData {
  venueName: string;
  eventTitle: string;
  eventDate?: Date;
  creatorSharePct: number;
  vatRate: number;
  lines: AccountingPdfLine[];
  totalHt: number;
  totalVat: number;
  totalBalance: number;
}

const LABELS: Record<Language, Record<string, string>> = {
  fr: {
    title: 'RAPPORT FINANCIER', subtitle: 'Montants à votre part de co-production',
    creatorShare: 'Part créateur', vat: 'TVA',
    colRate: 'Billet / Tarif', colQty: 'Qté', colHt: 'Total HT (part)', colTtc: 'Total TTC (part)',
    totalHt: 'Total HT (votre part)', totalVat: 'TVA', totalBalance: 'SOLDE TOTAL (votre part)',
    note: 'Montants nets des frais de service Yuno. Document indicatif, non contractuel.',
    generated: 'Généré le',
  },
  en: {
    title: 'FINANCIAL REPORT', subtitle: 'Amounts based on your co-production share',
    creatorShare: 'Creator share', vat: 'VAT',
    colRate: 'Ticket / Rate', colQty: 'Qty', colHt: 'Total excl. tax (share)', colTtc: 'Total incl. tax (share)',
    totalHt: 'Total excl. tax (your share)', totalVat: 'VAT', totalBalance: 'TOTAL BALANCE (your share)',
    note: 'Amounts net of Yuno service fees. Indicative document, not contractual.',
    generated: 'Generated on',
  },
  es: {
    title: 'INFORME FINANCIERO', subtitle: 'Importes según su parte de coproducción',
    creatorShare: 'Parte creador', vat: 'IVA',
    colRate: 'Entrada / Tarifa', colQty: 'Cant.', colHt: 'Total sin imp. (parte)', colTtc: 'Total con imp. (parte)',
    totalHt: 'Total sin impuestos (su parte)', totalVat: 'IVA', totalBalance: 'BALANCE TOTAL (su parte)',
    note: 'Importes netos de comisiones de servicio Yuno. Documento indicativo, no contractual.',
    generated: 'Generado el',
  },
};

const LOCALE: Record<Language, string> = { fr: 'fr-FR', en: 'en-GB', es: 'es-ES' };
const eur = (n: number) => `${(n || 0).toFixed(2).replace('.', ',')} €`;

export function generateAccountingPDF(data: AccountingPdfData, language: Language = 'fr'): jsPDF {
  const L = LABELS[language] ?? LABELS.fr;
  const loc = LOCALE[language] ?? 'fr-FR';
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210;
  const M = 16;
  let y = 20;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(20, 20, 20);
  doc.text(L.title, M, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  doc.text(L.subtitle, M, y);
  y += 10;

  // Event header block
  doc.setTextColor(20, 20, 20);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(data.eventTitle || '—', M, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(110, 110, 110);
  const meta: string[] = [];
  if (data.eventDate) meta.push(data.eventDate.toLocaleDateString(loc, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
  meta.push(`${data.venueName}`);
  meta.push(`${L.creatorShare}: ${data.creatorSharePct.toFixed(2)}%`);
  meta.push(`${L.vat}: ${data.vatRate}%`);
  doc.text(meta.join('  ·  '), M, y);
  y += 10;

  // Table header
  const xQty = 118, xHt = 138, xTtc = W - M;
  doc.setDrawColor(225, 225, 225);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(90, 90, 90);
  doc.text(L.colRate, M, y);
  doc.text(L.colQty, xQty, y, { align: 'right' });
  doc.text(L.colHt, xHt + 18, y, { align: 'right' });
  doc.text(L.colTtc, xTtc, y, { align: 'right' });
  y += 2;
  doc.line(M, y, W - M, y);
  y += 5;

  // Rows
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(40, 40, 40);
  for (const line of data.lines) {
    if (y > 270) { doc.addPage(); y = 20; }
    const label = doc.splitTextToSize(line.label || '—', 95)[0];
    doc.text(String(label), M, y);
    doc.text(String(line.qty), xQty, y, { align: 'right' });
    doc.text(eur(line.htShare), xHt + 18, y, { align: 'right' });
    doc.text(eur(line.ttcShare), xTtc, y, { align: 'right' });
    y += 6;
  }

  y += 2;
  doc.setDrawColor(210, 210, 210);
  doc.line(M, y, W - M, y);
  y += 7;

  // Totals
  const totalRow = (label: string, value: string, bold = false, size = 10) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(bold ? 20 : 70, bold ? 20 : 70, bold ? 20 : 70);
    doc.text(label, xHt - 6, y, { align: 'right' });
    doc.text(value, xTtc, y, { align: 'right' });
    y += bold ? 8 : 6.5;
  };
  totalRow(L.totalHt, eur(data.totalHt));
  totalRow(L.totalVat, eur(data.totalVat));
  y += 1;
  totalRow(L.totalBalance, eur(data.totalBalance), true, 12);

  // Footer note
  y = Math.max(y + 6, 280);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7.5);
  doc.setTextColor(150, 150, 150);
  doc.text(L.note, M, y);
  doc.text(`${L.generated} ${new Date().toLocaleDateString(loc)}`, W - M, y, { align: 'right' });

  return doc;
}

export function downloadAccountingPDF(data: AccountingPdfData, filename: string, language: Language = 'fr'): void {
  const doc = generateAccountingPDF(data, language);
  doc.save(filename);
}
