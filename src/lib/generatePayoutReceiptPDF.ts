import jsPDF from 'jspdf';
import type { Language } from '@/contexts/LanguageContext';

/**
 * Reçu de règlement promoteur, contresigné.
 *
 * Ce document n'est pas une facture : Yuno n'encaisse rien et ne certifie aucun
 * mouvement bancaire. Il atteste d'un ACCORD entre deux parties, horodaté des
 * deux côtés — le club a déclaré avoir viré à telle heure, le promoteur a
 * accusé réception à telle autre. C'est ce que « contresigné » veut dire ici,
 * et c'est la seule chose que Yuno soit en position d'attester.
 *
 * La référence de virement est mise en avant : c'est la seule donnée présente
 * à la fois sur ce reçu et sur les deux relevés bancaires. En cas de désaccord,
 * c'est par elle qu'on retrouve l'opération.
 *
 * Distinct de lib/generateInvoicePDF.ts (facture client) et de
 * lib/generateAccountingPDF.ts (rapport de compta par événement).
 */

export interface PayoutReceiptLine {
  label: string;
  date?: string;
  commission: number;
}

export interface PayoutReceiptData {
  reference: string;
  amount: number;
  periodLabel?: string | null;
  /** Qui paie : le club ou l'organisateur. */
  payerName: string;
  /** Qui est payé. */
  promoterName: string;
  promoterIban?: string | null;
  preparedAt?: string | null;
  declaredAt?: string | null;
  confirmedAt?: string | null;
  lines?: PayoutReceiptLine[];
}

const LABELS: Record<Language, Record<string, string>> = {
  fr: {
    title: 'REÇU DE RÈGLEMENT',
    subtitle: 'Accusé de réception contresigné par les deux parties',
    reference: 'Référence de virement',
    payer: 'Versé par', payee: 'Versé à', iban: 'IBAN crédité',
    period: 'Période', amount: 'MONTANT VERSÉ',
    timeline: 'Horodatage', tPrepared: 'Règlement préparé par le club',
    tDeclared: 'Virement déclaré effectué par le club',
    tConfirmed: 'Réception confirmée par le promoteur',
    detail: 'Commissions couvertes par ce règlement',
    colLabel: 'Origine', colDate: 'Date', colAmount: 'Commission',
    total: 'TOTAL', countLine: 'commission(s) soldée(s)',
    note: "Yuno n'intervient pas dans le mouvement de fonds : le virement est exécuté par le club depuis son propre compte bancaire. Ce document atteste uniquement que les deux parties ont validé ce règlement dans Yuno, aux dates indiquées ci-dessus.",
    generated: 'Généré le',
  },
  en: {
    title: 'SETTLEMENT RECEIPT',
    subtitle: 'Countersigned acknowledgement from both parties',
    reference: 'Transfer reference',
    payer: 'Paid by', payee: 'Paid to', iban: 'Credited IBAN',
    period: 'Period', amount: 'AMOUNT PAID',
    timeline: 'Timestamps', tPrepared: 'Settlement prepared by the club',
    tDeclared: 'Transfer declared sent by the club',
    tConfirmed: 'Receipt confirmed by the promoter',
    detail: 'Commissions covered by this settlement',
    colLabel: 'Source', colDate: 'Date', colAmount: 'Commission',
    total: 'TOTAL', countLine: 'commission(s) settled',
    note: 'Yuno takes no part in the movement of funds: the transfer is executed by the club from its own bank account. This document only attests that both parties validated this settlement in Yuno, on the dates shown above.',
    generated: 'Generated on',
  },
  es: {
    title: 'RECIBO DE LIQUIDACIÓN',
    subtitle: 'Acuse de recibo refrendado por ambas partes',
    reference: 'Referencia de transferencia',
    payer: 'Pagado por', payee: 'Pagado a', iban: 'IBAN abonado',
    period: 'Periodo', amount: 'IMPORTE PAGADO',
    timeline: 'Marcas de tiempo', tPrepared: 'Liquidación preparada por el club',
    tDeclared: 'Transferencia declarada enviada por el club',
    tConfirmed: 'Recepción confirmada por el promotor',
    detail: 'Comisiones cubiertas por esta liquidación',
    colLabel: 'Origen', colDate: 'Fecha', colAmount: 'Comisión',
    total: 'TOTAL', countLine: 'comisión(es) saldada(s)',
    note: 'Yuno no interviene en el movimiento de fondos: la transferencia la ejecuta el club desde su propia cuenta bancaria. Este documento solo acredita que ambas partes validaron esta liquidación en Yuno, en las fechas indicadas arriba.',
    generated: 'Generado el',
  },
};

const LOCALE: Record<Language, string> = { fr: 'fr-FR', en: 'en-GB', es: 'es-ES' };
const eur = (n: number) => `${(n || 0).toFixed(2).replace('.', ',')} €`;

export function generatePayoutReceiptPDF(data: PayoutReceiptData, language: Language = 'fr'): jsPDF {
  const L = LABELS[language] ?? LABELS.fr;
  const loc = LOCALE[language] ?? 'fr-FR';
  const stamp = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleString(loc, { dateStyle: 'long', timeStyle: 'short' }) : '—';

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210;
  const M = 16;
  let y = 20;

  // ── En-tête ───────────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(20, 20, 20);
  doc.text(L.title, M, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  doc.text(L.subtitle, M, y);
  y += 11;

  // ── Référence de virement — l'information la plus importante du document ───
  doc.setFillColor(245, 245, 247);
  doc.roundedRect(M, y - 5, W - 2 * M, 17, 2, 2, 'F');
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.text(L.reference.toUpperCase(), M + 5, y);
  doc.setFont('courier', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(20, 20, 20);
  doc.text(data.reference || '—', M + 5, y + 8);
  y += 21;

  // ── Parties ───────────────────────────────────────────────────────────────
  const half = (W - 2 * M) / 2;
  const field = (label: string, value: string, x: number, yy: number) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(130, 130, 130);
    doc.text(label.toUpperCase(), x, yy);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(20, 20, 20);
    doc.text(value || '—', x, yy + 5);
  };

  field(L.payer, data.payerName, M, y);
  field(L.payee, data.promoterName, M + half, y);
  y += 13;

  if (data.promoterIban) {
    field(L.iban, data.promoterIban.replace(/(.{4})/g, '$1 ').trim(), M, y);
    y += 13;
  }
  if (data.periodLabel) {
    field(L.period, data.periodLabel, M, y);
    y += 13;
  }

  // ── Montant ───────────────────────────────────────────────────────────────
  doc.setDrawColor(225, 225, 228);
  doc.line(M, y - 2, W - M, y - 2);
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(130, 130, 130);
  doc.text(L.amount, M, y);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(20, 20, 20);
  doc.text(eur(data.amount), W - M, y + 2, { align: 'right' });
  y += 12;

  // ── Horodatage — le cœur de la valeur probante ─────────────────────────────
  doc.setDrawColor(225, 225, 228);
  doc.line(M, y - 2, W - M, y - 2);
  y += 6;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(20, 20, 20);
  doc.text(L.timeline.toUpperCase(), M, y);
  y += 6;

  const steps: [string, string | null | undefined][] = [
    [L.tPrepared, data.preparedAt],
    [L.tDeclared, data.declaredAt],
    [L.tConfirmed, data.confirmedAt],
  ];
  doc.setFontSize(9);
  steps.forEach(([label, iso]) => {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(90, 90, 90);
    doc.text(label, M + 2, y);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(20, 20, 20);
    doc.text(stamp(iso), W - M, y, { align: 'right' });
    y += 6;
  });
  y += 4;

  // ── Détail des commissions ────────────────────────────────────────────────
  const lines = data.lines ?? [];
  if (lines.length > 0) {
    doc.setDrawColor(225, 225, 228);
    doc.line(M, y - 2, W - M, y - 2);
    y += 6;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(20, 20, 20);
    doc.text(L.detail.toUpperCase(), M, y);
    y += 7;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(130, 130, 130);
    doc.text(L.colLabel, M, y);
    doc.text(L.colDate, M + 105, y);
    doc.text(L.colAmount, W - M, y, { align: 'right' });
    y += 4;
    doc.setDrawColor(235, 235, 238);
    doc.line(M, y, W - M, y);
    y += 5;

    doc.setFontSize(9);
    lines.forEach((line) => {
      // Saut de page : un règlement peut couvrir des centaines de conversions,
      // et une ligne écrite hors du cadre est une ligne perdue.
      if (y > 268) {
        doc.addPage();
        y = 20;
      }
      doc.setTextColor(40, 40, 40);
      doc.text(doc.splitTextToSize(line.label || '—', 100)[0], M, y);
      doc.setTextColor(120, 120, 120);
      doc.text(line.date ? new Date(line.date).toLocaleDateString(loc) : '—', M + 105, y);
      doc.setTextColor(40, 40, 40);
      doc.text(eur(line.commission), W - M, y, { align: 'right' });
      y += 5.5;
    });

    y += 2;
    doc.setDrawColor(225, 225, 228);
    doc.line(M, y, W - M, y);
    y += 6;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(20, 20, 20);
    doc.text(`${L.total} — ${lines.length} ${L.countLine}`, M, y);
    doc.text(eur(data.amount), W - M, y, { align: 'right' });
    y += 10;
  }

  // ── Mention légale ────────────────────────────────────────────────────────
  if (y > 250) {
    doc.addPage();
    y = 20;
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(140, 140, 140);
  doc.text(doc.splitTextToSize(L.note, W - 2 * M), M, y);
  y += 12;
  doc.setFontSize(7.5);
  doc.text(`${L.generated} ${new Date().toLocaleString(loc)} — Yuno`, M, Math.min(y, 287));

  return doc;
}

/** Nom de fichier stable : la référence est déjà unique et sans espace. */
export const payoutReceiptFilename = (reference: string) =>
  `recu-${(reference || 'reglement').toLowerCase()}.pdf`;
