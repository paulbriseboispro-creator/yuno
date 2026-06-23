import jsPDF from 'jspdf';
import QRCode from 'qrcode';
import type { Language } from '@/contexts/LanguageContext';

export interface InvoiceItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface InvoiceData {
  // Invoice info
  invoiceNumber: string;
  invoiceDate: Date;
  paymentDate: Date;

  // Venue (seller) info
  venueName: string;
  venueLegalName?: string;
  venueAddress?: string;
  venueSiret?: string;
  venueVatNumber?: string;
  venueLogoUrl?: string;

  // Customer info
  customerName: string;
  customerEmail: string;
  customerPhone?: string;

  // Event info
  eventTitle?: string;
  eventDate?: Date;
  eventPosterUrl?: string;

  // Order details
  type: 'ticket' | 'table' | 'order';
  items: InvoiceItem[];
  serviceFee?: number;
  managementFee?: number;
  insuranceFee?: number;
  totalHT: number;
  tva: number;
  totalTTC: number;

  // QR Code — the long scannable value encoded in the QR image (door check-in).
  qrCode: string;

  // Short human reference (TK-XXXXXX / VP-XXXXXX) shown as the ticket number.
  // This is the code a guest types at /claim to add the ticket to their Yuno
  // account. Falls back to qrCode when absent (legacy tickets without one).
  referenceCode?: string;

  // Document language (defaults to French for backwards compatibility)
  language?: Language;

  // Attendees (for nominative tickets)
  attendees?: Array<{ firstName: string; lastName: string; qrCode?: string }>;

  // ========= Co-event (collaboration) extension =========
  // When provided, the PDF appends a "Répartition co-événement" section
  // showing the share that goes to the side viewing the invoice.
  coEvent?: {
    /** Whose perspective is rendering this invoice */
    viewerSide: 'venue' | 'organizer';
    /** Display names for the contract parties */
    venuePartyName: string;
    organizerPartyName: string;
    /** Effective split percentages applied for this item type */
    venuePct: number;
    organizerPct: number;
    /** Yuno service fee on this transaction (€) — informational */
    yunoFee: number;
    /** Net amount AFTER Yuno fees (€) — base for split calculations */
    netAmount: number;
    /** Final share that goes to the viewer (€) */
    viewerShare: number;
    /** Final share that goes to the partner (€) */
    partnerShare: number;
    /** Mode label: 'co_event', 'venue_rental', 'org_hosted' */
    mode?: string;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Yuno B2C bill — light, editorial, "carré".
//
// A paid customer receipt (justificatif de paiement), NOT a payment request:
// no balance-due / due-date / bank-info. The club / organizer is the merchant of
// record (Stripe Connect direct charge), so it is the sole issuer.
//
// Style: derived from DESIGN_SYSTEM_PUBLIC.md, adapted to a printable light page.
//   • Red #E8192C as the only accent.
//   • helvetica-bold for display (Space Grotesk unavailable in jsPDF core).
//   • courier for the mono metadata signature (codes, dates, labels).
//   • Vertical brand spine + light header panel + thin red rule beside the lines,
//     borrowed from the reference invoice layout but re-cast as a B2C bill.
// ─────────────────────────────────────────────────────────────────────────────

type RGB = [number, number, number];

const RED: RGB = [232, 25, 44];      // #E8192C — Yuno accent
const INK: RGB = [20, 20, 22];       // near-black body
const SUB: RGB = [92, 92, 100];      // secondary text
const MUTED: RGB = [140, 140, 148];  // labels / hints
const HAIR: RGB = [228, 228, 232];   // hairlines
const PANEL: RGB = [246, 246, 248];  // light header / table fill
const REDTINT: RGB = [253, 240, 241];// red wash (chip, co-event panel)
const WHITE: RGB = [255, 255, 255];

const DISPLAY = 'helvetica';
const MONO = 'courier';

const formatDate = (date: Date, locale = 'fr-FR'): string => {
  return date.toLocaleDateString(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
};

const formatDateTime = (date: Date, locale = 'fr-FR'): string => {
  return date.toLocaleDateString(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatPrice = (amount: number): string => {
  return (amount || 0).toFixed(2).replace('.', ',') + ' €';
};

const loadImage = async (url: string): Promise<string | null> => {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
};

// Helper to get image dimensions
const getImageDimensions = (dataUrl: string): Promise<{ width: number; height: number }> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.width, height: img.height });
    img.onerror = () => resolve({ width: 1, height: 1 });
    img.src = dataUrl;
  });
};

const INVOICE_LOCALE: Record<Language, string> = { fr: 'fr-FR', en: 'en-GB', es: 'es-ES' };

const INVOICE_LABELS: Record<Language, Record<string, string>> = {
  fr: {
    invoice: 'FACTURE', invoiceNo: 'N°', dateLabel: 'Date', issuer: 'ÉMETTEUR', recipient: 'DESTINATAIRE',
    vat: 'TVA', event: 'ÉVÉNEMENT', orderDetails: 'DÉTAIL DE LA COMMANDE', description: 'Description', qty: 'Qté',
    unitPrice: 'Prix U.', total: 'Total', serviceFee: 'Frais de service', managementFee: 'Frais de gestion',
    cancellationInsurance: 'Assurance annulation', subtotal: 'Sous-total HT', vatLine: 'TVA (20%)', totalTTC: 'TOTAL TTC',
    paid: 'PAYÉE', entryPass: "BILLET D'ENTRÉE", claimHint: 'Ajoute-le à ton compte sur yunoapp.eu/claim',
    modeCoEvent: 'Co-événement', modeVenueRental: 'Location de salle', modeOrgHosted: "Soirée hébergée par l'organisateur",
    coEventSplit: 'RÉPARTITION CO-ÉVÉNEMENT', amountCollected: 'Montant TTC encaissé', yunoServiceFee: 'Frais de service Yuno',
    netToSplit: 'Net à répartir', attendees: 'PARTICIPANTS', showAtEntry: "À présenter à l'entrée", legalMentions: 'MENTIONS LÉGALES',
    legalVatApplicable: 'TVA applicable selon le régime en vigueur', legalVatNotApplicable: 'TVA non applicable - Art. 293 B du CGI',
    legalProofOfPayment: 'Cette facture tient lieu de justificatif de paiement',
    generatedVia: 'Édité via Yuno · yunoapp.eu',
  },
  en: {
    invoice: 'INVOICE', invoiceNo: 'No.', dateLabel: 'Date', issuer: 'FROM', recipient: 'BILL TO',
    vat: 'VAT', event: 'EVENT', orderDetails: 'ORDER DETAILS', description: 'Description', qty: 'Qty',
    unitPrice: 'Unit price', total: 'Total', serviceFee: 'Service fee', managementFee: 'Management fee',
    cancellationInsurance: 'Cancellation insurance', subtotal: 'Subtotal (excl. tax)', vatLine: 'VAT (20%)', totalTTC: 'TOTAL',
    paid: 'PAID', entryPass: 'ENTRY PASS', claimHint: 'Add it to your account at yunoapp.eu/claim',
    modeCoEvent: 'Co-event', modeVenueRental: 'Venue rental', modeOrgHosted: 'Hosted by organizer',
    coEventSplit: 'CO-EVENT SPLIT', amountCollected: 'Amount collected (incl. tax)', yunoServiceFee: 'Yuno service fee',
    netToSplit: 'Net to split', attendees: 'ATTENDEES', showAtEntry: 'Show at the door', legalMentions: 'LEGAL NOTICE',
    legalVatApplicable: 'VAT applicable under the current regime', legalVatNotApplicable: 'VAT not applicable - Art. 293 B French Tax Code',
    legalProofOfPayment: 'This invoice serves as proof of payment',
    generatedVia: 'Issued via Yuno · yunoapp.eu',
  },
  es: {
    invoice: 'FACTURA', invoiceNo: 'N.º', dateLabel: 'Fecha', issuer: 'EMISOR', recipient: 'DESTINATARIO',
    vat: 'IVA', event: 'EVENTO', orderDetails: 'DETALLE DEL PEDIDO', description: 'Descripción', qty: 'Cant.',
    unitPrice: 'Precio U.', total: 'Total', serviceFee: 'Gastos de servicio', managementFee: 'Gastos de gestión',
    cancellationInsurance: 'Seguro de cancelación', subtotal: 'Subtotal (sin IVA)', vatLine: 'IVA (20%)', totalTTC: 'TOTAL',
    paid: 'PAGADA', entryPass: 'ENTRADA', claimHint: 'Añádela a tu cuenta en yunoapp.eu/claim',
    modeCoEvent: 'Co-evento', modeVenueRental: 'Alquiler de sala', modeOrgHosted: 'Organizado por el organizador',
    coEventSplit: 'REPARTO CO-EVENTO', amountCollected: 'Importe cobrado (con IVA)', yunoServiceFee: 'Gastos de servicio Yuno',
    netToSplit: 'Neto a repartir', attendees: 'ASISTENTES', showAtEntry: 'Mostrar en la entrada', legalMentions: 'INFORMACIÓN LEGAL',
    legalVatApplicable: 'IVA aplicable según el régimen vigente', legalVatNotApplicable: 'IVA no aplicable - Art. 293 B del CGI (Francia)',
    legalProofOfPayment: 'Esta factura sirve como justificante de pago',
    generatedVia: 'Emitido vía Yuno · yunoapp.eu',
  },
};

const paidByCardLine = (lang: Language, date: string): string =>
  lang === 'es' ? `Pagado con tarjeta el ${date}`
    : lang === 'en' ? `Paid by card on ${date}`
      : `Payé par carte le ${date}`;

export const generateInvoicePDF = async (data: InvoiceData, languageOverride?: Language): Promise<Blob> => {
  const lang: Language = data.language || languageOverride || 'fr';
  const L = INVOICE_LABELS[lang];
  const locale = INVOICE_LOCALE[lang];
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const W = doc.internal.pageSize.getWidth();   // 210
  const H = doc.internal.pageSize.getHeight();  // 297
  const LX = 24;          // content left edge (the spine lives to its left)
  const RX = W - 18;      // content right edge
  const CW = RX - LX;     // content width

  // ── Primitives ──────────────────────────────────────────────────────────────
  type TextOpts = { size?: number; font?: string; style?: 'normal' | 'bold' | 'italic'; color?: RGB; align?: 'left' | 'center' | 'right'; angle?: number };
  const T = (s: string, x: number, y: number, o: TextOpts = {}) => {
    doc.setFont(o.font || DISPLAY, o.style || 'normal');
    doc.setFontSize(o.size ?? 10);
    const c = o.color || INK;
    doc.setTextColor(c[0], c[1], c[2]);
    doc.text(s ?? '', x, y, { align: o.align || 'left', ...(o.angle ? { angle: o.angle } : {}) });
  };
  const wrap = (s: string, maxW: number, size: number, font = DISPLAY, style: 'normal' | 'bold' = 'normal'): string[] => {
    doc.setFont(font, style);
    doc.setFontSize(size);
    return doc.splitTextToSize(s || '', maxW) as string[];
  };
  const hr = (x1: number, yy: number, x2: number, color: RGB = HAIR, lw = 0.3) => {
    doc.setDrawColor(color[0], color[1], color[2]);
    doc.setLineWidth(lw);
    doc.line(x1, yy, x2, yy);
  };
  const fill = (c: RGB) => doc.setFillColor(c[0], c[1], c[2]);
  // Section opener: red tick in the gutter + mono uppercase label aligned with content.
  const section = (label: string, yy: number) => {
    doc.setDrawColor(RED[0], RED[1], RED[2]);
    doc.setLineWidth(1);
    doc.line(LX - 6, yy - 1.4, LX - 1.5, yy - 1.4);
    T(label, LX, yy, { size: 8, font: MONO, style: 'bold', color: MUTED });
  };
  let y = 0;
  const ensureSpace = (need: number) => {
    if (y + need > H - 34) { doc.addPage(); y = 22; }
  };

  // ── Pre-load images (logo + poster) ──────────────────────────────────────────
  let logoData: string | null = null;
  let logoW = 0, logoH = 0;
  if (data.venueLogoUrl) {
    logoData = await loadImage(data.venueLogoUrl);
    if (logoData) {
      const d = await getImageDimensions(logoData);
      const ar = d.width / d.height || 1;
      const maxH = 13, maxW = 38;
      if (ar > 1) { logoW = Math.min(maxW, maxH * ar); logoH = logoW / ar; }
      else { logoH = maxH; logoW = logoH * ar; }
    }
  }
  let posterData: string | null = null;
  if (data.eventPosterUrl) posterData = await loadImage(data.eventPosterUrl);

  // ── Header panel geometry (measured before fill so it sits behind text) ───────
  const issuerName = (data.venueLegalName || data.venueName) || '';
  const addrLines = data.venueAddress ? wrap(data.venueAddress, CW * 0.46, 8, MONO) : [];
  const recipName = data.customerName || '—';
  const recipNameLines = wrap(recipName, CW * 0.5, 14, DISPLAY, 'bold').slice(0, 2);

  const ISSUER_TOP = 16;
  const logoBlockH = logoData ? logoH + 6 : 0;
  // issuer: [logo] + label(+5) + name(+5) + addr(n*4) + siret(+4) + vat(+4)
  const issuerBottom = ISSUER_TOP + logoBlockH + 5 + 5
    + addrLines.length * 4
    + (data.venueSiret ? 4 : 0)
    + (data.venueVatNumber ? 4 : 0);
  const titleBottom = ISSUER_TOP + 22; // FACTURE(+7) → no(+8) → date(+5)
  const row1Bottom = Math.max(issuerBottom, titleBottom);

  const dividerY = row1Bottom + 6;
  const row2Top = dividerY + 10;
  const recipBottom = row2Top + 6 + recipNameLines.length * 6
    + 5 /* email */ + (data.customerPhone ? 4.5 : 0);
  const payBottom = row2Top + 5 + 5; // chip + paid line
  const row2Bottom = Math.max(recipBottom, payBottom);
  const panelH = row2Bottom + 8;

  // Panel fill (full-bleed, sharp).
  fill(PANEL);
  doc.rect(0, 0, W, panelH, 'F');

  // ── Vertical brand spine (issuer name, reading upward in red) ─────────────────
  {
    const spineTop = 14;
    const spineBottom = panelH - 6;
    const availH = spineBottom - spineTop;
    let str = issuerName.toUpperCase();
    let size = 22;
    doc.setFont(DISPLAY, 'bold');
    doc.setFontSize(size);
    while (doc.getTextWidth(str) > availH && size > 9) { size -= 1; doc.setFontSize(size); }
    while (str.length > 3 && doc.getTextWidth(str) > availH) str = str.slice(0, -1);
    if (str) T(str, 11, spineBottom, { size, style: 'bold', color: RED, angle: 90 });
  }

  // ── Row 1: issuer (left) + invoice title/meta (right) ─────────────────────────
  let iy = ISSUER_TOP;
  if (logoData) {
    try { doc.addImage(logoData, 'PNG', LX, iy - 4, logoW, logoH); } catch { /* skip */ }
    iy += logoBlockH;
  }
  T(L.issuer, LX, iy, { size: 7, font: MONO, style: 'bold', color: MUTED }); iy += 5;
  T(wrap(issuerName, CW * 0.46, 10.5, DISPLAY, 'bold')[0] || issuerName, LX, iy, { size: 10.5, style: 'bold' }); iy += 5;
  for (const ln of addrLines) { T(ln, LX, iy, { size: 8, font: MONO, color: SUB }); iy += 4; }
  if (data.venueSiret) { T(`SIRET : ${data.venueSiret}`, LX, iy, { size: 8, font: MONO, color: MUTED }); iy += 4; }
  if (data.venueVatNumber) { T(`${L.vat} : ${data.venueVatNumber}`, LX, iy, { size: 8, font: MONO, color: MUTED }); iy += 4; }

  T(L.invoice, RX, ISSUER_TOP + 4, { size: 21, style: 'bold', color: RED, align: 'right' });
  T(`${L.invoiceNo} ${data.invoiceNumber}`, RX, ISSUER_TOP + 12, { size: 9, font: MONO, color: SUB, align: 'right' });
  T(`${L.dateLabel} · ${formatDate(data.invoiceDate, locale)}`, RX, ISSUER_TOP + 17, { size: 8, font: MONO, color: MUTED, align: 'right' });

  // Divider inside the panel.
  hr(LX, dividerY, RX, [222, 222, 227], 0.3);

  // ── Row 2: recipient (left) + PAID status (right) ─────────────────────────────
  T(L.recipient, LX, row2Top, { size: 7, font: MONO, style: 'bold', color: MUTED });
  let ry = row2Top + 6;
  for (const ln of recipNameLines) { T(ln, LX, ry, { size: 14, style: 'bold' }); ry += 6; }
  if (data.customerEmail) { T(data.customerEmail, LX, ry, { size: 8.5, font: MONO, color: SUB }); ry += 4.5; }
  if (data.customerPhone) { T(data.customerPhone, LX, ry, { size: 8.5, font: MONO, color: SUB }); ry += 4.5; }

  // PAID chip (pill) + paid-by line.
  {
    doc.setFont(DISPLAY, 'bold');
    doc.setFontSize(8);
    const labelW = doc.getTextWidth(L.paid);
    const pillW = labelW + 13;
    const pillH = 6.5;
    const pillX = RX - pillW;
    const pillY = row2Top - 3.5;
    fill(REDTINT);
    doc.setDrawColor(RED[0], RED[1], RED[2]);
    doc.setLineWidth(0.3);
    doc.roundedRect(pillX, pillY, pillW, pillH, pillH / 2, pillH / 2, 'FD');
    fill(RED);
    doc.circle(pillX + 4.5, pillY + pillH / 2, 1, 'F');
    T(L.paid, pillX + 7.5, pillY + 4.4, { size: 8, style: 'bold', color: RED });
    T(paidByCardLine(lang, formatDate(data.paymentDate, locale)), RX, row2Top + 9, { size: 8, font: MONO, color: SUB, align: 'right' });
  }

  // ── Event ─────────────────────────────────────────────────────────────────────
  y = panelH + 14;
  if (data.eventTitle) {
    section(L.event, y); y += 8;
    let evX = LX;
    const posterSize = 20;
    const evTop = y;
    if (posterData) {
      try { doc.addImage(posterData, 'JPEG', LX, evTop - 4, posterSize, posterSize); evX = LX + posterSize + 7; }
      catch { evX = LX; }
    }
    const titleLines = wrap(data.eventTitle, RX - evX, 13, DISPLAY, 'bold').slice(0, 2);
    let ey = evTop + 1;
    for (const ln of titleLines) { T(ln, evX, ey, { size: 13, style: 'bold' }); ey += 6; }
    if (data.eventDate) { T(formatDateTime(data.eventDate, locale), evX, ey + 0.5, { size: 8.5, font: MONO, color: SUB }); ey += 5; }
    T(data.venueName, evX, ey + 0.5, { size: 8.5, font: MONO, color: MUTED }); ey += 5;
    y = Math.max(ey, posterData ? evTop - 4 + posterSize : ey) + 9;
  }

  // ── Order details table ───────────────────────────────────────────────────────
  section(L.orderDetails, y); y += 8;

  const cTotalR = RX;
  const cUnitR = RX - 26;
  const cQtyR = RX - 52;
  const descX = LX + 4;
  const descMaxW = cQtyR - 14 - descX;

  const tableBarTop = y - 4.5;
  fill(PANEL);
  doc.rect(LX, y - 4.5, CW, 8, 'F');
  const hOpt: TextOpts = { size: 7.5, font: MONO, style: 'bold', color: MUTED };
  T(L.description, descX, y + 0.8, hOpt);
  T(L.qty, cQtyR, y + 0.8, { ...hOpt, align: 'right' });
  T(L.unitPrice, cUnitR, y + 0.8, { ...hOpt, align: 'right' });
  T(L.total, cTotalR, y + 0.8, { ...hOpt, align: 'right' });
  y += 9;

  const drawRow = (desc: string, qty: string, unit: string, total: string, muted = false) => {
    const lines = wrap(desc, descMaxW, 9).slice(0, 2);
    const rowH = Math.max(6.5, lines.length * 4.4 + 2);
    ensureSpace(rowH);
    lines.forEach((ln, i) => T(ln, descX, y + i * 4.4, { size: 9, color: muted ? MUTED : INK }));
    T(qty, cQtyR, y, { size: 9, font: MONO, color: muted ? MUTED : SUB, align: 'right' });
    T(unit, cUnitR, y, { size: 9, font: MONO, color: muted ? MUTED : SUB, align: 'right' });
    T(total, cTotalR, y, { size: 9, font: MONO, style: muted ? 'normal' : 'bold', color: muted ? MUTED : INK, align: 'right' });
    y += rowH;
  };

  data.items.forEach((item) => {
    drawRow(item.description, String(item.quantity || 1), formatPrice(item.unitPrice), formatPrice(item.total));
  });
  if (data.serviceFee && data.serviceFee > 0) drawRow(L.serviceFee, '1', formatPrice(data.serviceFee), formatPrice(data.serviceFee), true);
  if (data.managementFee && data.managementFee > 0) drawRow(L.managementFee, '1', formatPrice(data.managementFee), formatPrice(data.managementFee), true);
  if (data.insuranceFee && data.insuranceFee > 0) drawRow(L.cancellationInsurance, '1', formatPrice(data.insuranceFee), formatPrice(data.insuranceFee), true);

  // Thin red accent rule beside the line items (gutter).
  fill(RED);
  doc.rect(LX - 4, tableBarTop, 1.1, Math.max(2, y - tableBarTop - 1), 'F');

  // ── Totals ──────────────────────────────────────────────────────────────────
  const totLabelX = RX - 78;
  y += 2;
  hr(totLabelX, y - 2, RX, HAIR, 0.3);
  y += 3;
  T(L.subtotal, totLabelX, y, { size: 9, color: SUB });
  T(formatPrice(data.totalHT), RX, y, { size: 9, font: MONO, style: 'bold', align: 'right' });
  y += 5.5;
  T(L.vatLine, totLabelX, y, { size: 9, color: MUTED });
  T(formatPrice(data.tva), RX, y, { size: 9, font: MONO, color: MUTED, align: 'right' });
  y += 7;
  fill(RED);
  doc.roundedRect(totLabelX - 5, y - 5, RX - (totLabelX - 5), 11, 1.5, 1.5, 'F');
  T(L.totalTTC, totLabelX, y + 2, { size: 10, style: 'bold', color: WHITE });
  T(formatPrice(data.totalTTC), RX - 3, y + 2, { size: 11, font: MONO, style: 'bold', color: WHITE, align: 'right' });
  y += 16;

  // ── Co-event revenue split (when applicable) ──────────────────────────────────
  if (data.coEvent) {
    const ce = data.coEvent;
    const viewerName = ce.viewerSide === 'venue' ? ce.venuePartyName : ce.organizerPartyName;
    const partnerName = ce.viewerSide === 'venue' ? ce.organizerPartyName : ce.venuePartyName;
    const viewerPct = ce.viewerSide === 'venue' ? ce.venuePct : ce.organizerPct;
    const partnerPct = ce.viewerSide === 'venue' ? ce.organizerPct : ce.venuePct;
    const modeLabel = ce.mode === 'venue_rental' ? L.modeVenueRental
      : ce.mode === 'org_hosted' ? L.modeOrgHosted
        : L.modeCoEvent;

    const panelH2 = 50;
    ensureSpace(panelH2 + 6);
    fill(REDTINT);
    doc.setDrawColor(RED[0], RED[1], RED[2]);
    doc.setLineWidth(0.3);
    doc.roundedRect(LX, y, CW, panelH2, 2, 2, 'FD');
    const px = LX + 6, pr = RX - 6;
    T(L.coEventSplit, px, y + 7, { size: 7.5, font: MONO, style: 'bold', color: RED });
    T(modeLabel, pr, y + 7, { size: 7.5, font: MONO, color: MUTED, align: 'right' });

    T(L.amountCollected, px, y + 15, { size: 9, color: SUB });
    T(formatPrice(data.totalTTC), pr, y + 15, { size: 9, font: MONO, align: 'right' });
    T(L.yunoServiceFee, px, y + 21, { size: 9, color: MUTED });
    T(`- ${formatPrice(ce.yunoFee)}`, pr, y + 21, { size: 9, font: MONO, color: MUTED, align: 'right' });
    hr(px, y + 24, pr, HAIR, 0.3);
    T(L.netToSplit, px, y + 29, { size: 9, style: 'bold' });
    T(formatPrice(ce.netAmount), pr, y + 29, { size: 9, font: MONO, style: 'bold', align: 'right' });

    T(`${viewerName} (${viewerPct.toFixed(0)}%)`, px, y + 37, { size: 10, style: 'bold', color: RED });
    T(formatPrice(ce.viewerShare), pr, y + 37, { size: 10, font: MONO, style: 'bold', color: RED, align: 'right' });
    T(`${partnerName} (${partnerPct.toFixed(0)}%)`, px, y + 44, { size: 9, color: MUTED });
    T(formatPrice(ce.partnerShare), pr, y + 44, { size: 9, font: MONO, color: MUTED, align: 'right' });
    y += panelH2 + 8;
  }

  // ── Attendees (nominative tickets) ────────────────────────────────────────────
  if (data.attendees && data.attendees.length > 0) {
    ensureSpace(12 + data.attendees.length * 5);
    section(L.attendees, y); y += 8;
    data.attendees.forEach((a, i) => {
      T(`${String(i + 1).padStart(2, '0')}`, descX, y, { size: 8.5, font: MONO, color: MUTED });
      T(`${a.firstName} ${a.lastName}`.trim(), descX + 9, y, { size: 9.5 });
      y += 5;
    });
    y += 4;
  }

  // ── Entry pass / QR card ──────────────────────────────────────────────────────
  {
    // The QR encodes the long scannable value (door check-in); the printed number
    // is the short reference (the code a guest types at /claim). Fall back to the
    // scannable value for legacy tickets that have no short reference.
    const refCode = (data.referenceCode || '').trim();
    const displayCode = refCode || data.qrCode;
    const showClaim = !!refCode;
    const cardH = showClaim ? 40 : 36;
    ensureSpace(cardH + 6);
    doc.setDrawColor(HAIR[0], HAIR[1], HAIR[2]);
    doc.setLineWidth(0.3);
    doc.roundedRect(LX, y, CW, cardH, 2, 2, 'S');
    const qrSize = showClaim ? 28 : 26;
    const qrX = LX + 5;
    const qrY = y + (cardH - qrSize) / 2;
    try {
      const qrUrl = await QRCode.toDataURL(data.qrCode, { width: 240, margin: 0 });
      doc.addImage(qrUrl, 'PNG', qrX, qrY, qrSize, qrSize);
    } catch { /* skip */ }
    const tx = qrX + qrSize + 9;
    const maxW = RX - 6 - tx;
    let ty = y + 11;
    T(L.entryPass, tx, ty, { size: 8, font: MONO, style: 'bold', color: RED }); ty += 7.5;
    // Short codes get a prominent single line; legacy long codes wrap smaller.
    const codeSize = displayCode.length <= 14 ? 12 : 9;
    const codeLines = wrap(displayCode, maxW, codeSize, MONO, 'bold').slice(0, 2);
    for (const ln of codeLines) { T(ln, tx, ty, { size: codeSize, font: MONO, style: 'bold' }); ty += codeSize >= 12 ? 5.6 : 4.6; }
    ty += 1.8;
    T(L.showAtEntry, tx, ty, { size: 8.5, color: SUB }); ty += 4.8;
    if (showClaim) T(L.claimHint, tx, ty, { size: 7.5, font: MONO, color: MUTED });
    y += cardH + 8;
  }

  // ── Legal footer (pinned) ─────────────────────────────────────────────────────
  let fy = H - 30;
  hr(LX, fy, RX, HAIR, 0.3); fy += 5;
  T(L.legalMentions, LX, fy, { size: 7, font: MONO, style: 'bold', color: MUTED }); fy += 4;
  const sellerLegal = data.venueLegalName || data.venueName;
  const legalMentions = [
    paidByCardLine(lang, formatDate(data.paymentDate, locale)) + '.',
    data.venueVatNumber ? L.legalVatApplicable : L.legalVatNotApplicable,
    L.legalProofOfPayment,
  ];
  for (const m of legalMentions) { T(`• ${m}`, LX, fy, { size: 7, font: MONO, color: MUTED }); fy += 3.5; }
  fy += 2;
  T(L.generatedVia, LX, fy, { size: 7, font: MONO, color: MUTED });
  T(sellerLegal, RX, fy, { size: 7, font: MONO, color: MUTED, align: 'right' });

  return doc.output('blob');
};

export const downloadInvoicePDF = async (data: InvoiceData, filename?: string, languageOverride?: Language): Promise<void> => {
  const blob = await generateInvoicePDF(data, languageOverride);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || `facture-${data.invoiceNumber}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
