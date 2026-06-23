// ─────────────────────────────────────────────────────────────────────────────
// Yuno PDF documents — isomorphic draw core (browser + Deno).
//
// Two separate documents, like Shotgun:
//   • drawReceipt → "Reçu de transaction" : the FISCAL receipt. The club/organizer
//     is the sole seller (merchant of record in Yuno's Stripe Connect direct-charge
//     model — the customer's card statement shows the club's name, Yuno only takes
//     an application_fee). One issuer block. Ticket + service fee as itemized lines
//     with HT / VAT rate / VAT / TTC. NO QR (the QR lives on the billet).
//   • drawBillet → the "Billet" : poster, event, validity, address, entrance type,
//     ticket number, price, and the scannable QR. This is what you show at the door.
//
// Light & printable (Shotgun-style) with Yuno brand: red #E8192C accent, courier
// "mono" for codes/metadata, helvetica-bold display. Trilingual FR / EN / ES.
//
// PURE module: no imports, no browser/Deno globals. The caller injects a jsPDF
// `doc` instance and PRE-LOADED images (data URLs) + a PNG QR data URL. This lets
// the Vite frontend (src/lib/generateDocuments.ts) and the Deno edge function
// (send-ticket-confirmation) share ONE source of truth. Keep both wrappers thin.
// ─────────────────────────────────────────────────────────────────────────────

export type DocLang = 'fr' | 'en' | 'es';

/** Minimal jsPDF surface we use — keeps this module import-free + isomorphic. */
export interface PdfDoc {
  setFont(family: string, style?: string): void;
  setFontSize(size: number): void;
  setTextColor(r: number, g: number, b: number): void;
  setDrawColor(r: number, g: number, b: number): void;
  setFillColor(r: number, g: number, b: number): void;
  setLineWidth(w: number): void;
  text(text: string, x: number, y: number, opts?: { align?: 'left' | 'center' | 'right' }): void;
  line(x1: number, y1: number, x2: number, y2: number): void;
  rect(x: number, y: number, w: number, h: number, style?: string): void;
  roundedRect(x: number, y: number, w: number, h: number, rx: number, ry: number, style?: string): void;
  addImage(data: string, fmt: string, x: number, y: number, w: number, h: number): void;
  getTextWidth(text: string): number;
  splitTextToSize(text: string, maxWidth: number): string[];
  addPage(): void;
  internal: { pageSize: { getWidth(): number; getHeight(): number } };
}

type RGB = [number, number, number];

// ── Brand palette (light document) ───────────────────────────────────────────
const RED: RGB = [232, 25, 44];      // #E8192C — Yuno accent
const INK: RGB = [18, 18, 20];       // near-black body text
const SUB: RGB = [90, 90, 98];       // secondary text
const MUTED: RGB = [140, 140, 148];  // labels / hints
const LINE: RGB = [226, 226, 230];   // hairlines
const PANEL: RGB = [247, 247, 249];  // light panel fill
const WHITE: RGB = [255, 255, 255];

const DISPLAY = 'helvetica';  // titles / values (Space Grotesk unavailable in jsPDF core)
const MONO = 'courier';       // codes / metadata signature

const eur = (n: number) => `${(n || 0).toFixed(2).replace('.', ',')} €`;
const htOf = (ttc: number, rate: number) => ttc / (1 + rate / 100);

function fmtDate(d: Date, locale: string): string {
  try {
    return d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch { return ''; }
}
function fmtLongDate(d: Date, locale: string): string {
  try {
    return d.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

const LOCALES: Record<DocLang, string> = { fr: 'fr-FR', en: 'en-GB', es: 'es-ES' };

// ── Labels ───────────────────────────────────────────────────────────────────
const RECEIPT_L: Record<DocLang, Record<string, string>> = {
  fr: {
    receipt: 'REÇU DE TRANSACTION', order: 'Commande n°', date: 'Date', event: 'ÉVÉNEMENT',
    seller: 'VENDEUR', buyer: 'ACHETÉ PAR', detail: 'Détail', from: 'De',
    article: 'Article', qty: 'Qté', ht: 'HT', vatRate: 'Taux TVA', vat: 'TVA', ttc: 'TTC',
    serviceFee: 'Frais de service', managementFee: 'Frais de gestion', insurance: 'Assurance annulation',
    subtotal: 'Sous-total', totalPaid: 'Total payé',
    siret: 'SIRET', vatNo: 'TVA',
    paidByCard: 'Paiement par carte le', proofOfPayment: 'Ce reçu tient lieu de justificatif de paiement.',
    vatNote: 'Les calculs de TVA peuvent différer de quelques centimes en raison des arrondis.',
    generatedVia: 'Édité via Yuno · yunoapp.eu', generatedOn: 'Généré le',
  },
  en: {
    receipt: 'TRANSACTION RECEIPT', order: 'Order no.', date: 'Date', event: 'EVENT',
    seller: 'SELLER', buyer: 'PURCHASED BY', detail: 'Details', from: 'From',
    article: 'Item', qty: 'Qty', ht: 'Net', vatRate: 'VAT rate', vat: 'VAT', ttc: 'Gross',
    serviceFee: 'Service fee', managementFee: 'Management fee', insurance: 'Cancellation insurance',
    subtotal: 'Subtotal', totalPaid: 'Total paid',
    siret: 'Reg. no.', vatNo: 'VAT',
    paidByCard: 'Paid by card on', proofOfPayment: 'This receipt serves as proof of payment.',
    vatNote: 'VAT totals may differ by a few cents due to rounding.',
    generatedVia: 'Issued via Yuno · yunoapp.eu', generatedOn: 'Generated on',
  },
  es: {
    receipt: 'RECIBO DE TRANSACCIÓN', order: 'Pedido n.º', date: 'Fecha', event: 'EVENTO',
    seller: 'VENDEDOR', buyer: 'COMPRADO POR', detail: 'Detalle', from: 'De',
    article: 'Artículo', qty: 'Cant.', ht: 'Base', vatRate: 'Tipo IVA', vat: 'IVA', ttc: 'Total',
    serviceFee: 'Gastos de servicio', managementFee: 'Gastos de gestión', insurance: 'Seguro de cancelación',
    subtotal: 'Subtotal', totalPaid: 'Total pagado',
    siret: 'CIF/NIF', vatNo: 'IVA',
    paidByCard: 'Pagado con tarjeta el', proofOfPayment: 'Este recibo sirve como justificante de pago.',
    vatNote: 'Los importes de IVA pueden variar unos céntimos por redondeo.',
    generatedVia: 'Emitido vía Yuno · yunoapp.eu', generatedOn: 'Generado el',
  },
};

const BILLET_L: Record<DocLang, Record<string, string>> = {
  fr: {
    ticket: 'BILLET', by: 'Par', validity: 'VALIDITÉ DU BILLET', address: 'ADRESSE',
    ticketNo: 'Billet n°', price: 'Prix', order: 'Commande n°', client: 'Client', eventDate: 'Date de l\'événement',
    ticketOf: 'Billet', of: '/', showAtEntry: 'À présenter à l\'entrée', providedVia: 'Fourni via Yuno · yunoapp.eu',
    addressDeferred: 'Communiquée par l\'organisateur avant l\'événement.',
  },
  en: {
    ticket: 'TICKET', by: 'By', validity: 'TICKET VALIDITY', address: 'ADDRESS',
    ticketNo: 'Ticket no.', price: 'Price', order: 'Order no.', client: 'Holder', eventDate: 'Event date',
    ticketOf: 'Ticket', of: '/', showAtEntry: 'Show at the door', providedVia: 'Provided via Yuno · yunoapp.eu',
    addressDeferred: 'Shared by the host before the event.',
  },
  es: {
    ticket: 'ENTRADA', by: 'Por', validity: 'VALIDEZ DE LA ENTRADA', address: 'DIRECCIÓN',
    ticketNo: 'Entrada n.º', price: 'Precio', order: 'Pedido n.º', client: 'Titular', eventDate: 'Fecha del evento',
    ticketOf: 'Entrada', of: '/', showAtEntry: 'Mostrar en la entrada', providedVia: 'Proporcionado vía Yuno · yunoapp.eu',
    addressDeferred: 'Comunicada por el organizador antes del evento.',
  },
};

/** Localized labels for the receipt fee lines, so callers stay in sync. */
export function receiptLineLabels(lang: DocLang): { serviceFee: string; managementFee: string; insurance: string } {
  const L = RECEIPT_L[lang] || RECEIPT_L.fr;
  return { serviceFee: L.serviceFee, managementFee: L.managementFee, insurance: L.insurance };
}

// ── Data interfaces ──────────────────────────────────────────────────────────
export interface ReceiptLine {
  label: string;
  qty: number;
  /** Gross (TTC) total for the line, in euros. */
  ttc: number;
  /** VAT rate applied to this line, e.g. 20, 10, 5.5. */
  vatRate: number;
}

export interface ReceiptData {
  lang?: DocLang;
  orderNumber: string;
  receiptDate: Date;
  paymentDate: Date;
  // Seller (merchant of record = club / organizer)
  sellerName: string;
  sellerAddress?: string;
  sellerSiret?: string;
  sellerVatNumber?: string;
  sellerLogo?: string;   // data URL (PNG/JPEG), pre-loaded
  // Buyer
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  // Event
  eventTitle?: string;
  eventDate?: Date;
  eventCity?: string;
  // Lines (ticket + fees), each with its own VAT rate
  lines: ReceiptLine[];
}

export interface BilletData {
  lang?: DocLang;
  eventTitle: string;
  organizerName: string;
  eventStart?: Date;
  eventEnd?: Date;
  address?: string;        // resolved venue address, or empty when deferred
  addressDeferred?: boolean;
  entranceGroup?: string;  // e.g. "GENERAL ENTRANCE" (round group label)
  entranceName?: string;   // e.g. round name "Early bird"
  reference: string;       // short human ref (TK-XXXXXX)
  price: string;           // formatted "10,00 €"
  orderNumber: string;
  customerName?: string;
  poster?: string;         // data URL, pre-loaded (1:1)
  qr: string;              // data URL PNG of the QR, pre-loaded
  index?: number;          // 1-based for "Billet i/N"
  total?: number;          // N
}

// ── Small drawing helpers ────────────────────────────────────────────────────
function setText(doc: PdfDoc, c: RGB) { doc.setTextColor(c[0], c[1], c[2]); }
function text(doc: PdfDoc, s: string, x: number, y: number, o: { size?: number; font?: string; style?: string; color?: RGB; align?: 'left' | 'center' | 'right' } = {}) {
  doc.setFont(o.font || DISPLAY, o.style || 'normal');
  doc.setFontSize(o.size ?? 10);
  setText(doc, o.color || INK);
  doc.text(s, x, y, o.align ? { align: o.align } : undefined);
}
/**
 * Wrap text to maxWidth. splitTextToSize measures with the doc's CURRENT font, so
 * we MUST set the same font+size we'll render at before measuring — otherwise long
 * strings under-wrap and overflow the page edge.
 */
function wrap(doc: PdfDoc, s: string, maxWidth: number, size: number, font = DISPLAY, style = 'normal'): string[] {
  doc.setFont(font, style);
  doc.setFontSize(size);
  return doc.splitTextToSize(s || '', maxWidth);
}

// ── REÇU (fiscal receipt) ────────────────────────────────────────────────────
export function drawReceipt(doc: PdfDoc, data: ReceiptData): void {
  const lang: DocLang = data.lang || 'fr';
  const L = RECEIPT_L[lang];
  const loc = LOCALES[lang];
  const W = doc.internal.pageSize.getWidth();   // 210
  const H = doc.internal.pageSize.getHeight();   // 297
  const M = 16;
  const right = W - M;
  let y = 20;

  // Header: seller logo / name (left) + receipt meta (right)
  if (data.sellerLogo) {
    try { doc.addImage(data.sellerLogo, 'PNG', M, y - 4, 26, 26); } catch { /* skip */ }
  } else {
    text(doc, data.sellerName, M, y + 4, { size: 13, style: 'bold' });
  }
  text(doc, L.receipt, right, y, { size: 9, font: MONO, style: 'bold', color: RED, align: 'right' });
  text(doc, `${L.order} ${data.orderNumber}`, right, y + 6, { size: 9, font: MONO, color: SUB, align: 'right' });
  text(doc, `${L.date} ${fmtDate(data.receiptDate, loc)}`, right, y + 11, { size: 8.5, font: MONO, color: MUTED, align: 'right' });
  y += 28;

  // Event hero panel
  if (data.eventTitle) {
    const titleLines = wrap(doc, data.eventTitle, W - M * 2 - 14, 13, DISPLAY, 'bold').slice(0, 2);
    const panelH = 18 + titleLines.length * 6;
    doc.setFillColor(PANEL[0], PANEL[1], PANEL[2]);
    doc.roundedRect(M, y, W - M * 2, panelH, 2, 2, 'F');
    text(doc, L.event, M + 7, y + 8, { size: 7.5, font: MONO, style: 'bold', color: RED });
    let ey = y + 15;
    for (const ln of titleLines) { text(doc, ln, M + 7, ey, { size: 13, style: 'bold' }); ey += 6; }
    const meta = [data.eventDate ? fmtLongDate(data.eventDate, loc) : '', data.eventCity || ''].filter(Boolean).join('  ·  ');
    if (meta) text(doc, meta, M + 7, ey + 0.5, { size: 8.5, font: MONO, color: SUB });
    y += panelH + 10;
  }

  // Seller + buyer columns
  const col2 = W / 2 + 4;
  const topY = y;
  text(doc, L.seller, M, y, { size: 7.5, font: MONO, style: 'bold', color: MUTED });
  y += 6;
  text(doc, data.sellerName, M, y, { size: 10, style: 'bold' }); y += 5;
  if (data.sellerAddress) {
    for (const ln of wrap(doc, data.sellerAddress, W / 2 - M - 6, 8.5)) { text(doc, ln, M, y, { size: 8.5, color: SUB }); y += 4.2; }
  }
  if (data.sellerSiret) { text(doc, `${L.siret} : ${data.sellerSiret}`, M, y, { size: 8.5, color: MUTED }); y += 4.2; }
  if (data.sellerVatNumber) { text(doc, `${L.vatNo} : ${data.sellerVatNumber}`, M, y, { size: 8.5, color: MUTED }); y += 4.2; }
  const leftEnd = y;

  let cy = topY;
  text(doc, L.buyer, col2, cy, { size: 7.5, font: MONO, style: 'bold', color: MUTED }); cy += 6;
  text(doc, data.customerName || '—', col2, cy, { size: 10, style: 'bold' }); cy += 5;
  if (data.customerEmail) { text(doc, data.customerEmail, col2, cy, { size: 8.5, color: SUB }); cy += 4.2; }
  if (data.customerPhone) { text(doc, data.customerPhone, col2, cy, { size: 8.5, color: SUB }); cy += 4.2; }

  y = Math.max(leftEnd, cy) + 10;

  // Detail header + "De {seller}"
  text(doc, L.detail, M, y, { size: 10, style: 'bold' }); y += 6;
  text(doc, `${L.from} ${data.sellerName}`, M, y, { size: 8.5, font: MONO, color: MUTED }); y += 6;

  // Table columns
  const cArticle = M;
  const cQty = M + 92;
  const cHt = M + 112;
  const cRate = M + 134;
  const cVat = M + 156;
  const cTtc = right;

  doc.setFillColor(PANEL[0], PANEL[1], PANEL[2]);
  doc.rect(M, y - 4, W - M * 2, 8, 'F');
  const hOpt = { size: 7.5, font: MONO, style: 'bold', color: MUTED } as const;
  text(doc, L.article, cArticle + 2, y + 1, hOpt);
  text(doc, L.qty, cQty, y + 1, { ...hOpt, align: 'right' });
  text(doc, L.ht, cHt, y + 1, { ...hOpt, align: 'right' });
  text(doc, L.vatRate, cRate, y + 1, { ...hOpt, align: 'right' });
  text(doc, L.vat, cVat, y + 1, { ...hOpt, align: 'right' });
  text(doc, L.ttc, cTtc, y + 1, { ...hOpt, align: 'right' });
  y += 9;

  let sumHt = 0, sumVat = 0, sumTtc = 0;
  for (const ln of data.lines) {
    if (!ln || !ln.ttc) continue;
    const ht = htOf(ln.ttc, ln.vatRate);
    const vat = ln.ttc - ht;
    sumHt += ht; sumVat += vat; sumTtc += ln.ttc;
    const label = doc.splitTextToSize(ln.label || '—', 78)[0] || '—';
    text(doc, String(label), cArticle + 2, y, { size: 9 });
    text(doc, String(ln.qty || 1), cQty, y, { size: 9, color: SUB, align: 'right' });
    text(doc, eur(ht), cHt, y, { size: 9, color: SUB, align: 'right' });
    text(doc, `${ln.vatRate.toString().replace('.', ',')} %`, cRate, y, { size: 9, color: SUB, align: 'right' });
    text(doc, eur(vat), cVat, y, { size: 9, color: SUB, align: 'right' });
    text(doc, eur(ln.ttc), cTtc, y, { size: 9, style: 'bold', align: 'right' });
    y += 7;
  }

  // Subtotal row
  doc.setDrawColor(LINE[0], LINE[1], LINE[2]); doc.setLineWidth(0.3);
  doc.line(M, y - 1, right, y - 1); y += 4;
  text(doc, L.subtotal, cArticle + 2, y, { size: 9, font: MONO, color: MUTED });
  text(doc, eur(sumHt), cHt, y, { size: 9, style: 'bold', align: 'right' });
  text(doc, eur(sumVat), cVat, y, { size: 9, style: 'bold', align: 'right' });
  text(doc, eur(sumTtc), cTtc, y, { size: 9, style: 'bold', align: 'right' });
  y += 9;

  // Total paid (red band)
  doc.setFillColor(RED[0], RED[1], RED[2]);
  doc.roundedRect(cHt - 8, y - 5, right - cHt + 8, 11, 2, 2, 'F');
  text(doc, L.totalPaid, cHt - 4, y + 2, { size: 10, style: 'bold', color: WHITE });
  text(doc, eur(sumTtc), cTtc - 3, y + 2, { size: 11, style: 'bold', color: WHITE, align: 'right' });

  // Footer (legal + powered-by)
  let fy = H - 30;
  doc.setDrawColor(LINE[0], LINE[1], LINE[2]); doc.setLineWidth(0.3);
  doc.line(M, fy, right, fy); fy += 5;
  const legal = [
    `${L.paidByCard} ${fmtDate(data.paymentDate, loc)}.`,
    L.proofOfPayment,
    L.vatNote,
  ];
  for (const lnTxt of legal) { text(doc, lnTxt, M, fy, { size: 7, font: MONO, color: MUTED }); fy += 3.6; }
  fy += 2;
  text(doc, L.generatedVia, M, fy, { size: 7, font: MONO, color: MUTED });
  text(doc, `${L.generatedOn} ${fmtDate(data.receiptDate, loc)}`, right, fy, { size: 7, font: MONO, color: MUTED, align: 'right' });
}

// ── BILLET (entry ticket) ────────────────────────────────────────────────────
export function drawBillet(doc: PdfDoc, data: BilletData): void {
  const lang: DocLang = data.lang || 'fr';
  const L = BILLET_L[lang];
  const loc = LOCALES[lang];
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 16;
  const right = W - M;
  let y = 18;

  // Header: poster thumbnail (1:1) + event title / organizer
  const posterSize = 42;
  let titleX = M;
  if (data.poster) {
    try { doc.addImage(data.poster, 'JPEG', M, y, posterSize, posterSize); titleX = M + posterSize + 8; }
    catch { titleX = M; }
  }
  text(doc, L.ticket, titleX, y + 6, { size: 8, font: MONO, style: 'bold', color: RED });
  const titleLines = wrap(doc, (data.eventTitle || '').toUpperCase(), right - titleX, 17, DISPLAY, 'bold').slice(0, 3);
  let ty = y + 15;
  for (const ln of titleLines) { text(doc, ln, titleX, ty, { size: 17, style: 'bold' }); ty += 7.5; }
  if (data.organizerName) text(doc, `${L.by} ${data.organizerName}`, titleX, ty + 1, { size: 9, font: MONO, color: SUB });
  y += posterSize + 12;

  // Validity + address columns
  const col2 = W / 2 + 4;
  text(doc, L.validity, M, y, { size: 7.5, font: MONO, style: 'bold', color: MUTED });
  text(doc, L.address, col2, y, { size: 7.5, font: MONO, style: 'bold', color: MUTED });
  y += 6;
  const validity = data.eventStart
    ? data.eventEnd
      ? `${fmtLongDate(data.eventStart, loc)} – ${data.eventEnd.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' })}`
      : fmtLongDate(data.eventStart, loc)
    : '—';
  let ly = y;
  for (const ln of wrap(doc, validity, W / 2 - M - 6, 9)) { text(doc, ln, M, ly, { size: 9, color: INK }); ly += 4.6; }
  const addrText = data.addressDeferred ? L.addressDeferred : (data.address || '—');
  let ry = y;
  for (const ln of wrap(doc, addrText, W / 2 - M - 6, 9)) { text(doc, ln, col2, ry, { size: 9, color: INK }); ry += 4.6; }
  y = Math.max(ly, ry) + 8;

  // Entrance type (red mono label, like Shotgun's "GENERAL ENTRANCE")
  doc.setDrawColor(LINE[0], LINE[1], LINE[2]); doc.setLineWidth(0.3);
  doc.line(M, y, right, y); y += 8;
  if (data.entranceGroup) { text(doc, data.entranceGroup.toUpperCase(), M, y, { size: 10, font: MONO, style: 'bold', color: RED }); y += 7; }
  if (data.entranceName) { text(doc, data.entranceName, M, y, { size: 13, style: 'bold' }); y += 8; }

  // Ticket facts (left) + QR (right)
  const qrSize = 46;
  const qrX = right - qrSize;
  const qrY = y + 2;
  const factX = M;
  let fy = y + 4;
  const fact = (label: string, value: string) => {
    text(doc, `${label}`, factX, fy, { size: 8, font: MONO, color: MUTED }); fy += 4.4;
    text(doc, value, factX, fy, { size: 11, style: 'bold' }); fy += 8;
  };
  const num = data.total && data.total > 1 ? ` ${data.index || 1}${L.of}${data.total}` : '';
  fact(`${L.ticketNo}${num}`, data.reference);
  fact(L.price, data.price);
  if (data.customerName) fact(L.client, data.customerName);
  fact(L.order, data.orderNumber);

  if (data.qr) {
    try {
      doc.addImage(data.qr, 'PNG', qrX, qrY, qrSize, qrSize);
      text(doc, data.reference, qrX + qrSize / 2, qrY + qrSize + 5, { size: 9, font: MONO, style: 'bold', align: 'center' });
      text(doc, `${L.ticketOf} ${data.index || 1}${L.of}${data.total || 1}`, qrX + qrSize / 2, qrY + qrSize + 9.5, { size: 7.5, font: MONO, color: MUTED, align: 'center' });
    } catch { /* skip */ }
  }
  y = Math.max(fy, qrY + qrSize + 12) + 6;

  // Event date reminder
  if (data.eventStart) {
    text(doc, `${L.eventDate} : ${fmtLongDate(data.eventStart, loc)}`, M, y, { size: 8.5, font: MONO, color: SUB });
    y += 6;
  }
  text(doc, L.showAtEntry, M, y, { size: 9, style: 'bold', color: RED });

  // Footer
  const fyy = H - 16;
  doc.setDrawColor(LINE[0], LINE[1], LINE[2]); doc.setLineWidth(0.3);
  doc.line(M, fyy - 5, right, fyy - 5);
  text(doc, L.providedVia, M, fyy, { size: 7.5, font: MONO, color: MUTED });
}
