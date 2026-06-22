import jsPDF from 'jspdf';

/**
 * Digital DJ booking contract (secured payment). Generates a self-contained A4 PDF
 * snapshot of the agreed terms + both electronic signatures (name, timestamp, IP).
 * Electronic signature = "signature électronique simple" (eIDAS): the click + the
 * stored timestamp/IP/user-agent are the legal evidence; the PDF is the artifact.
 * Mirrors the jsPDF approach in generateInvoicePDF.ts.
 */

export interface DJContractPDFData {
  contractId: string;
  clubName: string;
  djName: string;
  eventTitle?: string;
  eventDate?: Date;
  setStart?: Date;
  setEnd?: Date;
  cachetEur: number;
  acompteEur: number;
  cancellationPolicy: 'acompte_to_dj' | 'full_refund';
  clubSignedAt?: Date | null;
  clubSignedName?: string;
  clubSignedIp?: string | null;
  djSignedAt?: Date | null;
  djSignedName?: string;
  djSignedIp?: string | null;
  language?: 'fr' | 'en' | 'es';
}

type L = { fr: string; en: string; es: string };
const pick = (lang: string, l: L) => (lang === 'en' ? l.en : lang === 'es' ? l.es : l.fr);
const fmtDate = (d?: Date | null) =>
  d ? d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : '—';
const fmtDateTime = (d?: Date | null) =>
  d ? `${d.toLocaleDateString('fr-FR')} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : '—';

export function generateDJContractPDF(data: DJContractPDFData): Blob {
  const lang = data.language ?? 'fr';
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const M = 20;
  let y = M;

  const balance = Math.max(0, data.cachetEur - data.acompteEur);

  // ── Header ──
  doc.setTextColor(232, 25, 44);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('YUNO', M, y);
  doc.setTextColor(120, 120, 120);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(pick(lang, { fr: 'Paiement sécurisé', en: 'Secured payment', es: 'Pago seguro' }), 200 - M, y, { align: 'right' });
  y += 12;

  doc.setTextColor(20, 20, 20);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(pick(lang, {
    fr: 'Contrat de prestation DJ',
    en: 'DJ booking contract',
    es: 'Contrato de actuación DJ',
  }), M, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(140, 140, 140);
  doc.text(`Réf. ${data.contractId}`, M, y);
  y += 10;

  // ── Parties ──
  const row = (label: string, value: string) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(90, 90, 90);
    doc.text(label, M, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(20, 20, 20);
    doc.setFontSize(10);
    doc.text(value || '—', M + 55, y);
    y += 7;
  };

  doc.setDrawColor(230, 230, 230);
  doc.line(M, y - 2, 200 - M, y - 2);
  y += 4;

  row(pick(lang, { fr: 'Organisateur (le Club)', en: 'Organizer (the Club)', es: 'Organizador (el Club)' }), data.clubName);
  row(pick(lang, { fr: 'Artiste (le DJ)', en: 'Artist (the DJ)', es: 'Artista (el DJ)' }), data.djName);
  if (data.eventTitle) row(pick(lang, { fr: 'Événement', en: 'Event', es: 'Evento' }), data.eventTitle);
  row(pick(lang, { fr: 'Date de l\'événement', en: 'Event date', es: 'Fecha del evento' }), fmtDate(data.eventDate));
  if (data.setStart) {
    row(pick(lang, { fr: 'Créneau', en: 'Set time', es: 'Horario' }),
      `${fmtDateTime(data.setStart)} → ${data.setEnd ? data.setEnd.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—'}`);
  }

  y += 4;
  doc.line(M, y - 2, 200 - M, y - 2);
  y += 6;

  // ── Financials ──
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(20, 20, 20);
  doc.text(pick(lang, { fr: 'Conditions financières', en: 'Financial terms', es: 'Condiciones financieras' }), M, y);
  y += 8;

  row(pick(lang, { fr: 'Cachet (net DJ)', en: 'Fee (DJ net)', es: 'Caché (neto DJ)' }), `${data.cachetEur.toFixed(2)} €`);
  row(pick(lang, { fr: 'Acompte (à la signature)', en: 'Deposit (on signature)', es: 'Anticipo (a la firma)' }), `${data.acompteEur.toFixed(2)} €`);
  row(pick(lang, { fr: 'Solde (après la prestation)', en: 'Balance (after the gig)', es: 'Saldo (tras la actuación)' }), `${balance.toFixed(2)} €`);

  y += 2;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(110, 110, 110);
  const escrowText = pick(lang, {
    fr: 'Le cachet est encaissé par le Club et séquestré par Yuno via Stripe. L\'acompte est versé au DJ dès l\'encaissement ; le solde est versé après la prestation (confirmation du Club ou libération automatique).',
    en: 'The fee is charged to the Club and held in escrow by Yuno via Stripe. The deposit is paid to the DJ on payment; the balance is released after the gig (Club confirmation or automatic release).',
    es: 'El caché lo paga el Club y Yuno lo retiene en depósito vía Stripe. El anticipo se paga al DJ al cobrar; el saldo se libera tras la actuación (confirmación del Club o liberación automática).',
  });
  doc.text(doc.splitTextToSize(escrowText, 200 - M * 2), M, y);
  y += 14;

  const cancelText = data.cancellationPolicy === 'acompte_to_dj'
    ? pick(lang, {
        fr: 'Annulation : en cas d\'annulation après encaissement, le DJ conserve l\'acompte et le solde est remboursé au Club.',
        en: 'Cancellation: if cancelled after payment, the DJ keeps the deposit and the balance is refunded to the Club.',
        es: 'Cancelación: si se cancela tras el cobro, el DJ conserva el anticipo y el saldo se reembolsa al Club.',
      })
    : pick(lang, {
        fr: 'Annulation : en cas d\'annulation, l\'intégralité du cachet est remboursée au Club.',
        en: 'Cancellation: if cancelled, the full fee is refunded to the Club.',
        es: 'Cancelación: si se cancela, el caché íntegro se reembolsa al Club.',
      });
  doc.setTextColor(110, 110, 110);
  doc.text(doc.splitTextToSize(cancelText, 200 - M * 2), M, y);
  y += 16;

  // ── Signatures ──
  doc.setDrawColor(230, 230, 230);
  doc.line(M, y - 2, 200 - M, y - 2);
  y += 6;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(20, 20, 20);
  doc.text(pick(lang, { fr: 'Signatures électroniques', en: 'Electronic signatures', es: 'Firmas electrónicas' }), M, y);
  y += 8;

  const sigBlock = (title: string, name?: string, at?: Date | null, ip?: string | null) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(60, 60, 60);
    doc.text(title, M, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(30, 30, 30);
    y += 6;
    doc.text(`${name || '—'}`, M, y);
    y += 5;
    doc.setTextColor(130, 130, 130);
    doc.setFontSize(8);
    doc.text(`${at ? pick(lang, { fr: 'Signé le', en: 'Signed on', es: 'Firmado el' }) + ' ' + fmtDateTime(at) : pick(lang, { fr: 'Non signé', en: 'Not signed', es: 'Sin firmar' })}${ip ? ` · IP ${ip}` : ''}`, M, y);
    y += 10;
  };

  sigBlock(pick(lang, { fr: 'Pour le Club', en: 'For the Club', es: 'Por el Club' }), data.clubSignedName, data.clubSignedAt, data.clubSignedIp);
  sigBlock(pick(lang, { fr: 'Pour le DJ', en: 'For the DJ', es: 'Por el DJ' }), data.djSignedName, data.djSignedAt, data.djSignedIp);

  // ── Footer ──
  doc.setFontSize(7.5);
  doc.setTextColor(160, 160, 160);
  doc.text(pick(lang, {
    fr: 'Document généré par Yuno. Signature électronique simple (eIDAS) — la preuve juridique est l\'horodatage et l\'adresse IP enregistrés.',
    en: 'Document generated by Yuno. Simple electronic signature (eIDAS) — the legal evidence is the recorded timestamp and IP address.',
    es: 'Documento generado por Yuno. Firma electrónica simple (eIDAS) — la prueba legal es la marca de tiempo y la IP registradas.',
  }), M, 285, { maxWidth: 200 - M * 2 });

  return doc.output('blob');
}

export function downloadDJContractPDF(data: DJContractPDFData) {
  const blob = generateDJContractPDF(data);
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `contrat-dj-${data.contractId.slice(0, 8)}.pdf`;
  link.click();
}
