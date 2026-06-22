import jsPDF from 'jspdf';

/**
 * Digital club ↔ organizer collaboration contract. Self-contained A4 PDF snapshot of
 * the agreed revenue split + both electronic signatures (name, timestamp, IP).
 * Electronic signature = "signature électronique simple" (eIDAS): the click + the stored
 * timestamp/IP/user-agent are the legal evidence; the PDF is the artifact.
 * Mirrors generateDJContractPDF.ts (kept separate to avoid touching the deployed DJ PDF).
 */

interface SplitPct { organizer_pct: number; venue_pct: number }
export interface CollabContractPDFData {
  contractId: string;
  venueName: string;
  organizerName: string;
  eventTitle?: string;
  eventDate?: Date | null;
  splitRules: { tickets: SplitPct; tables: SplitPct; drinks: SplitPct };
  cancellationPolicy: 'pro_rata_refund' | 'no_refund_after_event';
  venueSignedAt?: Date | null;
  venueSignedName?: string;
  venueSignedIp?: string | null;
  orgSignedAt?: Date | null;
  orgSignedName?: string;
  orgSignedIp?: string | null;
  language?: 'fr' | 'en' | 'es';
}

type L = { fr: string; en: string; es: string };
const pick = (lang: string, l: L) => (lang === 'en' ? l.en : lang === 'es' ? l.es : l.fr);
const fmtDate = (d?: Date | null) =>
  d ? d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : '—';
const fmtDateTime = (d?: Date | null) =>
  d ? `${d.toLocaleDateString('fr-FR')} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : '—';

export function generateContractPDF(data: CollabContractPDFData): Blob {
  const lang = data.language ?? 'fr';
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const M = 20;
  let y = M;

  // ── Header ──
  doc.setTextColor(232, 25, 44);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('YUNO', M, y);
  doc.setTextColor(120, 120, 120);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(pick(lang, { fr: 'Collaboration', en: 'Collaboration', es: 'Colaboración' }), 200 - M, y, { align: 'right' });
  y += 12;

  doc.setTextColor(20, 20, 20);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(pick(lang, {
    fr: 'Contrat de collaboration de soirée',
    en: 'Event collaboration contract',
    es: 'Contrato de colaboración de evento',
  }), M, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(140, 140, 140);
  doc.text(`Réf. ${data.contractId}`, M, y);
  y += 10;

  const row = (label: string, value: string) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(90, 90, 90);
    doc.text(label, M, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(20, 20, 20);
    doc.setFontSize(10);
    doc.text(value || '—', M + 60, y);
    y += 7;
  };

  doc.setDrawColor(230, 230, 230);
  doc.line(M, y - 2, 200 - M, y - 2);
  y += 4;

  row(pick(lang, { fr: 'Club (lieu, vendeur)', en: 'Club (venue, seller)', es: 'Club (local, vendedor)' }), data.venueName);
  row(pick(lang, { fr: 'Organisateur', en: 'Organizer', es: 'Organizador' }), data.organizerName);
  if (data.eventTitle) row(pick(lang, { fr: 'Soirée', en: 'Event', es: 'Evento' }), data.eventTitle);
  row(pick(lang, { fr: 'Date', en: 'Date', es: 'Fecha' }), fmtDate(data.eventDate));

  y += 4;
  doc.line(M, y - 2, 200 - M, y - 2);
  y += 6;

  // ── Revenue split ──
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(20, 20, 20);
  doc.text(pick(lang, { fr: 'Répartition des revenus', en: 'Revenue split', es: 'Reparto de ingresos' }), M, y);
  y += 8;

  const splitRow = (label: string, s: SplitPct) =>
    row(label, `${pick(lang, { fr: 'Orga', en: 'Org', es: 'Org' })} ${s.organizer_pct}%  ·  Club ${s.venue_pct}%`);
  splitRow(pick(lang, { fr: 'Billets', en: 'Tickets', es: 'Entradas' }), data.splitRules.tickets);
  splitRow(pick(lang, { fr: 'Tables / VIP', en: 'Tables / VIP', es: 'Mesas / VIP' }), data.splitRules.tables);
  splitRow(pick(lang, { fr: 'Boissons', en: 'Drinks', es: 'Bebidas' }), data.splitRules.drinks);

  y += 2;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(110, 110, 110);
  doc.text(doc.splitTextToSize(pick(lang, {
    fr: "Les paiements sont encaissés au nom du Club (vendeur de record, alcool inclus). Yuno reverse automatiquement à chaque vente la part de l'organisateur selon les pourcentages ci-dessus. Les boissons reviennent toujours à 100% au Club.",
    en: "Payments are collected under the Club (seller of record, alcohol included). Yuno automatically pays out the organizer's share on each sale per the percentages above. Drinks are always 100% the Club's.",
    es: "Los pagos se cobran a nombre del Club (vendedor de registro, alcohol incluido). Yuno abona automáticamente la parte del organizador en cada venta según los porcentajes anteriores. Las bebidas son siempre 100% del Club.",
  }), 200 - M * 2), M, y);
  y += 16;

  const cancelText = data.cancellationPolicy === 'no_refund_after_event'
    ? pick(lang, {
        fr: 'Annulation : aucun remboursement après la tenue de la soirée.',
        en: 'Cancellation: no refund after the event has taken place.',
        es: 'Cancelación: sin reembolso tras la celebración del evento.',
      })
    : pick(lang, {
        fr: "Annulation / remboursement : chaque remboursement reprend proportionnellement la part de chaque partie.",
        en: 'Cancellation / refund: each refund proportionally reverses each party\'s share.',
        es: 'Cancelación / reembolso: cada reembolso revierte proporcionalmente la parte de cada parte.',
      });
  doc.setTextColor(110, 110, 110);
  doc.text(doc.splitTextToSize(cancelText, 200 - M * 2), M, y);
  y += 14;

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
    y += 6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(30, 30, 30);
    doc.text(`${name || '—'}`, M, y);
    y += 5;
    doc.setTextColor(130, 130, 130);
    doc.setFontSize(8);
    doc.text(`${at ? pick(lang, { fr: 'Signé le', en: 'Signed on', es: 'Firmado el' }) + ' ' + fmtDateTime(at) : pick(lang, { fr: 'Non signé', en: 'Not signed', es: 'Sin firmar' })}${ip ? ` · IP ${ip}` : ''}`, M, y);
    y += 10;
  };

  sigBlock(pick(lang, { fr: 'Pour le Club', en: 'For the Club', es: 'Por el Club' }), data.venueSignedName, data.venueSignedAt, data.venueSignedIp);
  sigBlock(pick(lang, { fr: "Pour l'Organisateur", en: 'For the Organizer', es: 'Por el Organizador' }), data.orgSignedName, data.orgSignedAt, data.orgSignedIp);

  // ── Footer ──
  doc.setFontSize(7.5);
  doc.setTextColor(160, 160, 160);
  doc.text(pick(lang, {
    fr: "Document généré par Yuno. Signature électronique simple (eIDAS) — la preuve juridique est l'horodatage et l'adresse IP enregistrés.",
    en: 'Document generated by Yuno. Simple electronic signature (eIDAS) — the legal evidence is the recorded timestamp and IP address.',
    es: 'Documento generado por Yuno. Firma electrónica simple (eIDAS) — la prueba legal es la marca de tiempo y la IP registradas.',
  }), M, 285, { maxWidth: 200 - M * 2 });

  return doc.output('blob');
}

export function downloadContractPDF(data: CollabContractPDFData) {
  const blob = generateContractPDF(data);
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `contrat-collab-${data.contractId.slice(0, 8)}.pdf`;
  link.click();
}
