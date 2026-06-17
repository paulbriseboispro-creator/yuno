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
  
  // QR Code
  qrCode: string;

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
  return amount.toFixed(2).replace('.', ',') + ' €';
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
    invoice: 'FACTURE', invoiceNo: 'N°', dateLabel: 'Date :', issuer: 'ÉMETTEUR', recipient: 'DESTINATAIRE',
    vat: 'TVA', event: 'ÉVÉNEMENT', orderDetails: 'DÉTAILS DE LA COMMANDE', description: 'Description', qty: 'Qté',
    unitPrice: 'Prix U.', total: 'Total', serviceFee: 'Frais de service', managementFee: 'Frais de gestion',
    cancellationInsurance: 'Assurance annulation', subtotal: 'Sous-total HT', vatLine: 'TVA (20%)', totalTTC: 'TOTAL TTC',
    coEventSplit: 'RÉPARTITION CO-ÉVÉNEMENT', amountCollected: 'Montant TTC encaissé', yunoServiceFee: 'Frais de service Yuno',
    netToSplit: 'Net à répartir', attendees: 'PARTICIPANTS', showAtEntry: "Présentez ce code à l'entrée", legalMentions: 'MENTIONS LÉGALES',
    legalVatApplicable: 'TVA applicable selon le régime en vigueur', legalVatNotApplicable: 'TVA non applicable - Art. 293 B du CGI',
    legalProofOfPayment: 'Cette facture tient lieu de justificatif de paiement',
  },
  en: {
    invoice: 'INVOICE', invoiceNo: 'No.', dateLabel: 'Date:', issuer: 'FROM', recipient: 'BILL TO',
    vat: 'VAT', event: 'EVENT', orderDetails: 'ORDER DETAILS', description: 'Description', qty: 'Qty',
    unitPrice: 'Unit price', total: 'Total', serviceFee: 'Service fee', managementFee: 'Management fee',
    cancellationInsurance: 'Cancellation insurance', subtotal: 'Subtotal (excl. tax)', vatLine: 'VAT (20%)', totalTTC: 'TOTAL (incl. tax)',
    coEventSplit: 'CO-EVENT SPLIT', amountCollected: 'Amount collected (incl. tax)', yunoServiceFee: 'Yuno service fee',
    netToSplit: 'Net to split', attendees: 'ATTENDEES', showAtEntry: 'Show this code at the door', legalMentions: 'LEGAL NOTICE',
    legalVatApplicable: 'VAT applicable under the current regime', legalVatNotApplicable: 'VAT not applicable - Art. 293 B French Tax Code',
    legalProofOfPayment: 'This invoice serves as proof of payment',
  },
  es: {
    invoice: 'FACTURA', invoiceNo: 'N.º', dateLabel: 'Fecha:', issuer: 'EMISOR', recipient: 'DESTINATARIO',
    vat: 'IVA', event: 'EVENTO', orderDetails: 'DETALLES DEL PEDIDO', description: 'Descripción', qty: 'Cant.',
    unitPrice: 'Precio U.', total: 'Total', serviceFee: 'Gastos de servicio', managementFee: 'Gastos de gestión',
    cancellationInsurance: 'Seguro de cancelación', subtotal: 'Subtotal (sin IVA)', vatLine: 'IVA (20%)', totalTTC: 'TOTAL (con IVA)',
    coEventSplit: 'REPARTO CO-EVENTO', amountCollected: 'Importe cobrado (con IVA)', yunoServiceFee: 'Gastos de servicio Yuno',
    netToSplit: 'Neto a repartir', attendees: 'ASISTENTES', showAtEntry: 'Presenta este código en la entrada', legalMentions: 'INFORMACIÓN LEGAL',
    legalVatApplicable: 'IVA aplicable según el régimen vigente', legalVatNotApplicable: 'IVA no aplicable - Art. 293 B del CGI (Francia)',
    legalProofOfPayment: 'Esta factura sirve como justificante de pago',
  },
};

export const generateInvoicePDF = async (data: InvoiceData, languageOverride?: Language): Promise<Blob> => {
  const lang: Language = data.language || languageOverride || 'fr';
  const L = INVOICE_LABELS[lang];
  const locale = INVOICE_LOCALE[lang];
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 15;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  // Colors - Yuno Red theme
  const primaryColor: [number, number, number] = [220, 38, 38]; // Red (hsl 0 85% 50% approx)
  const textColor: [number, number, number] = [31, 41, 55];
  const mutedColor: [number, number, number] = [107, 114, 128];

  // Helper function to add text
  const addText = (text: string, x: number, yPos: number, options?: { 
    fontSize?: number; 
    fontStyle?: 'normal' | 'bold' | 'italic';
    color?: [number, number, number];
    align?: 'left' | 'center' | 'right';
  }) => {
    doc.setFontSize(options?.fontSize || 10);
    doc.setFont('helvetica', options?.fontStyle || 'normal');
    doc.setTextColor(...(options?.color || textColor));
    
    if (options?.align === 'right') {
      const textWidth = doc.getTextWidth(text);
      doc.text(text, x - textWidth, yPos);
    } else if (options?.align === 'center') {
      const textWidth = doc.getTextWidth(text);
      doc.text(text, x - textWidth / 2, yPos);
    } else {
      doc.text(text, x, yPos);
    }
  };

  // ==================== HEADER ====================
  let logoHeight = 25;
  
  // Logo on the left (if available) - preserve aspect ratio
  if (data.venueLogoUrl) {
    const logoData = await loadImage(data.venueLogoUrl);
    if (logoData) {
      try {
        const dimensions = await getImageDimensions(logoData);
        const aspectRatio = dimensions.width / dimensions.height;
        const maxLogoHeight = 25;
        const maxLogoWidth = 40;
        
        let logoW: number;
        let logoH: number;
        
        if (aspectRatio > 1) {
          // Wider than tall
          logoW = Math.min(maxLogoWidth, maxLogoHeight * aspectRatio);
          logoH = logoW / aspectRatio;
        } else {
          // Taller than wide or square
          logoH = maxLogoHeight;
          logoW = logoH * aspectRatio;
        }
        
        logoHeight = logoH;
        doc.addImage(logoData, 'PNG', margin, y, logoW, logoH);
      } catch {
        // Logo load failed, continue without it
      }
    }
  }

  // Invoice title and number on the right
  addText(L.invoice, pageWidth - margin, y + 5, { 
    fontSize: 20, 
    fontStyle: 'bold', 
    color: primaryColor,
    align: 'right' 
  });
  addText(`${L.invoiceNo} ${data.invoiceNumber}`, pageWidth - margin, y + 12, { 
    fontSize: 10, 
    align: 'right' 
  });
  addText(`${L.dateLabel} ${formatDate(data.invoiceDate, locale)}`, pageWidth - margin, y + 18, { 
    fontSize: 9, 
    color: mutedColor,
    align: 'right' 
  });

  y += Math.max(logoHeight + 10, 35);

  // Separator line
  doc.setDrawColor(...primaryColor);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageWidth - margin, y);
  y += 10;

  // ==================== SELLER & CUSTOMER INFO ====================
  const col1X = margin;
  const col2X = pageWidth / 2 + 5;

  // Seller (Vendor) info
  addText(L.issuer, col1X, y, { fontSize: 8, fontStyle: 'bold', color: mutedColor });
  y += 5;
  addText(data.venueLegalName || data.venueName, col1X, y, { fontSize: 10, fontStyle: 'bold' });
  y += 5;
  if (data.venueAddress) {
    const addressLines = doc.splitTextToSize(data.venueAddress, contentWidth / 2 - 10);
    addressLines.forEach((line: string) => {
      addText(line, col1X, y, { fontSize: 9 });
      y += 4;
    });
  }
  if (data.venueSiret) {
    addText(`SIRET : ${data.venueSiret}`, col1X, y, { fontSize: 9, color: mutedColor });
    y += 4;
  }
  if (data.venueVatNumber) {
    addText(`${L.vat} : ${data.venueVatNumber}`, col1X, y, { fontSize: 9, color: mutedColor });
    y += 4;
  }

  // Customer info (reset y for right column)
  let customerY = y - (data.venueAddress ? 20 : 10);
  if (data.venueSiret) customerY -= 4;
  if (data.venueVatNumber) customerY -= 4;
  
  addText(L.recipient, col2X, customerY, { fontSize: 8, fontStyle: 'bold', color: mutedColor });
  customerY += 5;
  addText(data.customerName, col2X, customerY, { fontSize: 10, fontStyle: 'bold' });
  customerY += 5;
  addText(data.customerEmail, col2X, customerY, { fontSize: 9 });
  customerY += 4;
  if (data.customerPhone) {
    addText(data.customerPhone, col2X, customerY, { fontSize: 9 });
    customerY += 4;
  }

  y = Math.max(y, customerY) + 10;

  // ==================== EVENT INFO (with poster) ====================
  if (data.eventTitle) {
    // Background box for event
    doc.setFillColor(249, 250, 251);
    doc.roundedRect(margin, y, contentWidth, 35, 3, 3, 'F');

    const eventBoxY = y + 5;
    
    // Event poster on the left (if available)
    let posterWidth = 0;
    if (data.eventPosterUrl) {
      const posterData = await loadImage(data.eventPosterUrl);
      if (posterData) {
        try {
          posterWidth = 20;
          doc.addImage(posterData, 'JPEG', margin + 5, eventBoxY, posterWidth, 25);
        } catch {
          posterWidth = 0;
        }
      }
    }

    const eventTextX = margin + posterWidth + 10;
    
    addText(L.event, eventTextX, eventBoxY + 3, { fontSize: 8, fontStyle: 'bold', color: mutedColor });
    addText(data.eventTitle, eventTextX, eventBoxY + 10, { fontSize: 12, fontStyle: 'bold' });
    
    if (data.eventDate) {
      addText(formatDateTime(data.eventDate, locale), eventTextX, eventBoxY + 17, { fontSize: 9, color: mutedColor });
    }
    
    addText(`${data.venueName}`, eventTextX, eventBoxY + 24, { fontSize: 9 });

    y += 42;
  }

  // ==================== ORDER DETAILS TABLE ====================
  addText(L.orderDetails, margin, y, { fontSize: 10, fontStyle: 'bold' });
  y += 8;

  // Table header
  doc.setFillColor(243, 244, 246);
  doc.rect(margin, y - 3, contentWidth, 8, 'F');
  
  const colDesc = margin + 3;
  const colQty = margin + 95;
  const colUnit = margin + 115;
  const colTotal = pageWidth - margin - 3;

  addText(L.description, colDesc, y + 2, { fontSize: 8, fontStyle: 'bold', color: mutedColor });
  addText(L.qty, colQty, y + 2, { fontSize: 8, fontStyle: 'bold', color: mutedColor });
  addText(L.unitPrice, colUnit, y + 2, { fontSize: 8, fontStyle: 'bold', color: mutedColor });
  addText(L.total, colTotal, y + 2, { fontSize: 8, fontStyle: 'bold', color: mutedColor, align: 'right' });

  y += 10;

  // Table rows
  data.items.forEach((item) => {
    // Truncate long descriptions
    const maxDescLength = 45;
    const desc = item.description.length > maxDescLength 
      ? item.description.substring(0, maxDescLength) + '...' 
      : item.description;
    
    addText(desc, colDesc, y, { fontSize: 9 });
    addText(item.quantity.toString(), colQty, y, { fontSize: 9 });
    addText(formatPrice(item.unitPrice), colUnit, y, { fontSize: 9 });
    addText(formatPrice(item.total), colTotal, y, { fontSize: 9, align: 'right' });
    y += 6;
  });

  // Service fee
  if (data.serviceFee && data.serviceFee > 0) {
    addText(L.serviceFee, colDesc, y, { fontSize: 9, color: mutedColor });
    addText('1', colQty, y, { fontSize: 9, color: mutedColor });
    addText(formatPrice(data.serviceFee), colUnit, y, { fontSize: 9, color: mutedColor });
    addText(formatPrice(data.serviceFee), colTotal, y, { fontSize: 9, color: mutedColor, align: 'right' });
    y += 6;
  }

  // Management fee
  if (data.managementFee && data.managementFee > 0) {
    addText(L.managementFee, colDesc, y, { fontSize: 9, color: mutedColor });
    addText('1', colQty, y, { fontSize: 9, color: mutedColor });
    addText(formatPrice(data.managementFee), colUnit, y, { fontSize: 9, color: mutedColor });
    addText(formatPrice(data.managementFee), colTotal, y, { fontSize: 9, color: mutedColor, align: 'right' });
    y += 6;
  }

  // Insurance fee
  if (data.insuranceFee && data.insuranceFee > 0) {
    addText(L.cancellationInsurance, colDesc, y, { fontSize: 9, color: mutedColor });
    addText('1', colQty, y, { fontSize: 9, color: mutedColor });
    addText(formatPrice(data.insuranceFee), colUnit, y, { fontSize: 9, color: mutedColor });
    addText(formatPrice(data.insuranceFee), colTotal, y, { fontSize: 9, color: mutedColor, align: 'right' });
    y += 6;
  }

  // Separator line
  y += 2;
  doc.setDrawColor(229, 231, 235);
  doc.setLineWidth(0.3);
  doc.line(margin + 80, y, pageWidth - margin, y);
  y += 6;

  // Totals
  addText(L.subtotal, colUnit - 20, y, { fontSize: 9 });
  addText(formatPrice(data.totalHT), colTotal, y, { fontSize: 9, align: 'right' });
  y += 5;

  addText(L.vatLine, colUnit - 20, y, { fontSize: 9, color: mutedColor });
  addText(formatPrice(data.tva), colTotal, y, { fontSize: 9, color: mutedColor, align: 'right' });
  y += 6;

  doc.setFillColor(...primaryColor);
  doc.roundedRect(colUnit - 25, y - 4, pageWidth - margin - colUnit + 28, 10, 2, 2, 'F');
  addText(L.totalTTC, colUnit - 20, y + 2, { fontSize: 10, fontStyle: 'bold', color: [255, 255, 255] });
  addText(formatPrice(data.totalTTC), colTotal, y + 2, { fontSize: 10, fontStyle: 'bold', color: [255, 255, 255], align: 'right' });
  y += 15;

  // ==================== CO-EVENT REVENUE SPLIT (when applicable) ====================
  if (data.coEvent) {
    const ce = data.coEvent;
    const viewerName = ce.viewerSide === 'venue' ? ce.venuePartyName : ce.organizerPartyName;
    const partnerName = ce.viewerSide === 'venue' ? ce.organizerPartyName : ce.venuePartyName;
    const viewerPct = ce.viewerSide === 'venue' ? ce.venuePct : ce.organizerPct;
    const partnerPct = ce.viewerSide === 'venue' ? ce.organizerPct : ce.venuePct;
    const modeLabel = ce.mode === 'venue_rental' ? 'Location de salle'
      : ce.mode === 'org_hosted' ? 'Soirée hébergée par l\'organisateur'
      : 'Co-événement';

    // Background panel
    doc.setFillColor(254, 242, 242); // light red tint
    doc.setDrawColor(...primaryColor);
    doc.setLineWidth(0.3);
    doc.roundedRect(margin, y, contentWidth, 50, 3, 3, 'FD');

    addText(L.coEventSplit, margin + 5, y + 6, { fontSize: 8, fontStyle: 'bold', color: primaryColor });
    addText(modeLabel, pageWidth - margin - 5, y + 6, { fontSize: 8, color: mutedColor, align: 'right' });

    // Line 1: gross
    addText(L.amountCollected, margin + 5, y + 14, { fontSize: 9 });
    addText(formatPrice(data.totalTTC), pageWidth - margin - 5, y + 14, { fontSize: 9, align: 'right' });

    // Line 2: yuno fee
    addText(L.yunoServiceFee, margin + 5, y + 20, { fontSize: 9, color: mutedColor });
    addText(`- ${formatPrice(ce.yunoFee)}`, pageWidth - margin - 5, y + 20, { fontSize: 9, color: mutedColor, align: 'right' });

    // Line 3: net base
    doc.setDrawColor(229, 231, 235);
    doc.line(margin + 5, y + 23, pageWidth - margin - 5, y + 23);
    addText(L.netToSplit, margin + 5, y + 28, { fontSize: 9, fontStyle: 'bold' });
    addText(formatPrice(ce.netAmount), pageWidth - margin - 5, y + 28, { fontSize: 9, fontStyle: 'bold', align: 'right' });

    // Line 4: viewer share (highlighted)
    addText(`${viewerName} (${viewerPct.toFixed(0)}%)`, margin + 5, y + 36, { fontSize: 10, fontStyle: 'bold', color: primaryColor });
    addText(formatPrice(ce.viewerShare), pageWidth - margin - 5, y + 36, { fontSize: 10, fontStyle: 'bold', color: primaryColor, align: 'right' });

    // Line 5: partner share
    addText(`${partnerName} (${partnerPct.toFixed(0)}%)`, margin + 5, y + 43, { fontSize: 9, color: mutedColor });
    addText(formatPrice(ce.partnerShare), pageWidth - margin - 5, y + 43, { fontSize: 9, color: mutedColor, align: 'right' });

    y += 56;
  }

  // ==================== ATTENDEES (for nominative tickets) ====================
  if (data.attendees && data.attendees.length > 0) {
    y += 5;
    addText(L.attendees, margin, y, { fontSize: 10, fontStyle: 'bold' });
    y += 6;
    
    data.attendees.forEach((attendee, index) => {
      addText(`${index + 1}. ${attendee.firstName} ${attendee.lastName}`, margin + 5, y, { fontSize: 9 });
      y += 5;
    });
    y += 5;
  }

  // ==================== QR CODE ====================
  y += 5;
  const qrCodeDataUrl = await QRCode.toDataURL(data.qrCode, { width: 150, margin: 1 });
  
  // Center QR code
  const qrSize = 35;
  const qrX = (pageWidth - qrSize) / 2;
  
  doc.addImage(qrCodeDataUrl, 'PNG', qrX, y, qrSize, qrSize);
  y += qrSize + 3;
  
  addText(data.qrCode, pageWidth / 2, y, { fontSize: 9, fontStyle: 'bold', align: 'center' });
  y += 4;
  addText(L.showAtEntry, pageWidth / 2, y, { fontSize: 8, color: mutedColor, align: 'center' });

  // ==================== LEGAL MENTIONS ====================
  y = doc.internal.pageSize.getHeight() - 35;
  
  doc.setDrawColor(229, 231, 235);
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageWidth - margin, y);
  y += 5;

  addText(L.legalMentions, margin, y, { fontSize: 7, fontStyle: 'bold', color: mutedColor });
  y += 4;

  const paidByCard = lang === 'es'
    ? `Pago efectuado con tarjeta el ${formatDate(data.paymentDate, locale)}`
    : lang === 'en'
      ? `Paid by card on ${formatDate(data.paymentDate, locale)}`
      : `Paiement effectué par carte bancaire le ${formatDate(data.paymentDate, locale)}`;
  const autoGenerated = lang === 'es'
    ? `Factura generada automáticamente - ${data.venueLegalName || data.venueName}`
    : lang === 'en'
      ? `Invoice generated automatically - ${data.venueLegalName || data.venueName}`
      : `Facture générée automatiquement - ${data.venueLegalName || data.venueName}`;
  const legalMentions = [
    paidByCard,
    data.venueVatNumber ? L.legalVatApplicable : L.legalVatNotApplicable,
    L.legalProofOfPayment,
    autoGenerated,
  ];

  legalMentions.forEach((mention) => {
    addText(`• ${mention}`, margin, y, { fontSize: 7, color: mutedColor });
    y += 3.5;
  });

  // Return as blob
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
