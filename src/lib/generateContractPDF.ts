import jsPDF from 'jspdf';
import { getCollabTerms, pickL, clauseBody, type Lang, type L } from './collabContractTerms';

/**
 * Digital club ↔ organizer collaboration contract. Self-contained multi-page A4 PDF
 * snapshot of the legal parties, the agreed revenue split, the fee/refund/cancellation
 * terms, and both electronic signatures (name, timestamp, IP).
 *
 * The legal article TEXT lives in collabContractTerms.ts (single source of truth, shared
 * with the pre-signature review dialog). The version frozen at signature
 * (event_collab_contracts.terms_snapshot.terms_version) is passed in `termsVersion` so a
 * re-download renders the terms AS SIGNED, not the latest template.
 *
 * Electronic signature = "signature électronique simple" (eIDAS): the click + the stored
 * timestamp/IP/user-agent are the legal evidence; the PDF is the artifact.
 *
 * The fee / chargeback / seller-of-record wording mirrors the payment engine
 * (supabase/functions/_shared/payment-split.ts + src/utils/fees.ts) — keep them in sync.
 */

interface SplitPct { organizer_pct: number; venue_pct: number }

/** Legal identity of a contracting party, as stored on venues / organizer_profiles. */
export interface PartyLegal {
  /** Registered company name (legal_name). */
  legalName?: string | null;
  /** Registered legal address (legal_address). */
  legalAddress?: string | null;
  /** Company registration number — SIRET (FR) / NIF·CIF (ES) (siret). */
  registrationNumber?: string | null;
  /** VAT / intra-community number (vat_number). */
  vatNumber?: string | null;
}

export interface CollabContractPDFData {
  contractId: string;
  venueName: string;
  organizerName: string;
  eventTitle?: string;
  eventDate?: Date | null;
  splitRules: { tickets: SplitPct; tables: SplitPct; drinks: SplitPct };
  cancellationPolicy: 'pro_rata_refund' | 'no_refund_after_event';
  /** Legal identity of the club (rendered when filled, omitted line-by-line otherwise). */
  venueLegal?: PartyLegal;
  /** Legal identity of the organizer (rendered when filled, omitted line-by-line otherwise). */
  organizerLegal?: PartyLegal;
  venueSignedAt?: Date | null;
  venueSignedName?: string;
  venueSignedIp?: string | null;
  orgSignedAt?: Date | null;
  orgSignedName?: string;
  orgSignedIp?: string | null;
  language?: Lang;
  /** Frozen terms version (from terms_snapshot.terms_version). Falls back to latest. */
  termsVersion?: string | null;
  /**
   * Recurring framework contract (contrat-cadre) — adds the "Engagement récurrent"
   * article. True for a series contract AND for occurrence contracts derived from one
   * (terms_snapshot.via_series). Default false → unchanged per-event contract.
   */
  recurring?: boolean;
}

const fmtDate = (d?: Date | null) =>
  d ? d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : '—';
const fmtDateTime = (d?: Date | null) =>
  d ? `${d.toLocaleDateString('fr-FR')} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : '—';

export function generateContractPDF(data: CollabContractPDFData): Blob {
  const lang: Lang = data.language ?? 'fr';
  const terms = getCollabTerms(data.termsVersion, { recurring: data.recurring });
  const labels = terms.labels;
  const pick = (l: L) => pickL(lang, l);

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const M = 20;
  const PAGE_W = 210;
  const CONTENT_W = PAGE_W - M * 2; // 170mm
  const MAX_Y = 274; // content floor (footer lives below)
  let y = M;

  // Line height in mm for a given point size (jsPDF default lineHeightFactor 1.15).
  const LH = (s: number) => (s * 1.15) / 72 * 25.4;
  // Add a page break when the next block (height h) would cross the content floor.
  const ensure = (h: number) => { if (y + h > MAX_Y) { doc.addPage(); y = M; } };

  // ── Header (page 1) ──
  doc.setTextColor(232, 25, 44);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('YUNO', M, y);
  doc.setTextColor(120, 120, 120);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(pick(labels.collaboration), PAGE_W - M, y, { align: 'right' });
  y += 12;

  doc.setTextColor(20, 20, 20);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(pick(labels.docTitle), M, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(140, 140, 140);
  doc.text(`Réf. ${data.contractId}`, M, y);
  y += 9;

  // ── shared drawing helpers ──
  const heading = (num: number, title: L) => {
    ensure(11);
    y += 1;
    doc.setDrawColor(232, 232, 232);
    doc.line(M, y, PAGE_W - M, y);
    y += 5;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(20, 20, 20);
    doc.text(`${num}. ${pick(title)}`, M, y);
    y += 6;
  };

  // "Term — body" clause used for definitions and legal articles.
  const renderClause = (term: L, body: L) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    const bodyLines = doc.splitTextToSize(pick(body), CONTENT_W) as string[];
    ensure(4.5 + bodyLines.length * LH(8.5) + 4);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(55, 55, 55);
    doc.text(pick(term), M, y);
    y += 4.5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(100, 100, 100);
    doc.text(bodyLines, M, y);
    y += bodyLines.length * LH(8.5) + 4;
  };

  const para = (l: L, size = 8.5) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(size);
    doc.setTextColor(100, 100, 100);
    const lines = doc.splitTextToSize(pick(l), CONTENT_W) as string[];
    ensure(lines.length * LH(size) + 4);
    doc.text(lines, M, y);
    y += lines.length * LH(size) + 4;
  };

  // label : value, single line (event / date / split rows)
  const infoRow = (label: L, value: string) => {
    ensure(6.5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(120, 120, 120);
    doc.text(pick(label), M, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(20, 20, 20);
    doc.text(value || '—', M + 55, y);
    y += 6.5;
  };

  // Optional legal-detail line — only drawn when the value is present.
  const detailLine = (label: L, val?: string | null) => {
    if (!val) return;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(115, 115, 115);
    const lines = doc.splitTextToSize(`${pick(label)} : ${val}`, CONTENT_W) as string[];
    ensure(lines.length * 4 + 0.5);
    doc.text(lines, M, y);
    y += lines.length * 4;
  };

  const partyBlock = (role: L, name: string, legal?: PartyLegal) => {
    ensure(12);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(120, 120, 120);
    doc.text(pick(role), M, y);
    y += 4.5;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(20, 20, 20);
    doc.text(name || '—', M, y);
    y += 5;
    detailLine(labels.denom, legal?.legalName);
    detailLine(labels.address, legal?.legalAddress);
    detailLine(labels.reg, legal?.registrationNumber);
    detailLine(labels.vat, legal?.vatNumber);
    y += 3.5;
  };

  const splitRow = (label: L, s: SplitPct) =>
    infoRow(label, `${pick(labels.orgShort)} ${s.organizer_pct}%  ·  Club ${s.venue_pct}%`);

  // ── Articles (driven by the versioned terms structure) ──
  for (const article of terms.articles) {
    heading(article.num, article.title);
    if (article.kind === 'parties') {
      partyBlock(labels.clubRole, data.venueName, data.venueLegal);
      partyBlock(labels.orgRole, data.organizerName, data.organizerLegal);
      if (data.eventTitle) infoRow(labels.event, data.eventTitle);
      infoRow(labels.date, fmtDate(data.eventDate));
    } else if (article.kind === 'split') {
      splitRow(labels.ticketsRow, data.splitRules.tickets);
      splitRow(labels.tablesRow, data.splitRules.tables);
      splitRow(labels.drinksRow, data.splitRules.drinks);
      y += 1.5;
      para(article.note);
    } else {
      if (article.intro) para(article.intro);
      for (const c of article.clauses ?? []) renderClause(c.term, clauseBody(c, data.cancellationPolicy));
    }
  }

  // ── Electronic signatures ──
  ensure(48); // keep the signature block together on one page
  y += 1;
  doc.setDrawColor(232, 232, 232);
  doc.line(M, y, PAGE_W - M, y);
  y += 5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(20, 20, 20);
  doc.text(pick(labels.signaturesTitle), M, y);
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
    doc.text(`${at ? pick(labels.signedOn) + ' ' + fmtDateTime(at) : pick(labels.notSigned)}${ip ? ` · IP ${ip}` : ''}`, M, y);
    y += 10;
  };

  sigBlock(pick(labels.forClub), data.venueSignedName, data.venueSignedAt, data.venueSignedIp);
  sigBlock(pick(labels.forOrg), data.orgSignedName, data.orgSignedAt, data.orgSignedIp);

  // ── Footer on every page (eIDAS note + terms version + page number) ──
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(160, 160, 160);
    doc.text(doc.splitTextToSize(pick(labels.footer), CONTENT_W - 28) as string[], M, 284);
    doc.text(`v${terms.version} · ${p} / ${pages}`, PAGE_W - M, 284, { align: 'right' });
  }

  return doc.output('blob');
}

export function downloadContractPDF(data: CollabContractPDFData) {
  const blob = generateContractPDF(data);
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `contrat-collab-${data.contractId.slice(0, 8)}.pdf`;
  link.click();
}

/** Open the PDF in a new tab for pre-signature preview (no download). */
export function previewContractPDF(data: CollabContractPDFData) {
  const blob = generateContractPDF(data);
  window.open(URL.createObjectURL(blob), '_blank', 'noopener');
}
