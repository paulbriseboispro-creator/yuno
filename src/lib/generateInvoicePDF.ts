import jsPDF from 'jspdf';
import QRCode from 'qrcode';

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

const formatDate = (date: Date): string => {
  return date.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
};

const formatDateTime = (date: Date): string => {
  return date.toLocaleDateString('fr-FR', {
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

export const generateInvoicePDF = async (data: InvoiceData): Promise<Blob> => {
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
  addText('FACTURE', pageWidth - margin, y + 5, { 
    fontSize: 20, 
    fontStyle: 'bold', 
    color: primaryColor,
    align: 'right' 
  });
  addText(`N° ${data.invoiceNumber}`, pageWidth - margin, y + 12, { 
    fontSize: 10, 
    align: 'right' 
  });
  addText(`Date : ${formatDate(data.invoiceDate)}`, pageWidth - margin, y + 18, { 
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
  addText('ÉMETTEUR', col1X, y, { fontSize: 8, fontStyle: 'bold', color: mutedColor });
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
    addText(`TVA : ${data.venueVatNumber}`, col1X, y, { fontSize: 9, color: mutedColor });
    y += 4;
  }

  // Customer info (reset y for right column)
  let customerY = y - (data.venueAddress ? 20 : 10);
  if (data.venueSiret) customerY -= 4;
  if (data.venueVatNumber) customerY -= 4;
  
  addText('DESTINATAIRE', col2X, customerY, { fontSize: 8, fontStyle: 'bold', color: mutedColor });
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
    
    addText('ÉVÉNEMENT', eventTextX, eventBoxY + 3, { fontSize: 8, fontStyle: 'bold', color: mutedColor });
    addText(data.eventTitle, eventTextX, eventBoxY + 10, { fontSize: 12, fontStyle: 'bold' });
    
    if (data.eventDate) {
      addText(formatDateTime(data.eventDate), eventTextX, eventBoxY + 17, { fontSize: 9, color: mutedColor });
    }
    
    addText(`${data.venueName}`, eventTextX, eventBoxY + 24, { fontSize: 9 });

    y += 42;
  }

  // ==================== ORDER DETAILS TABLE ====================
  addText('DÉTAILS DE LA COMMANDE', margin, y, { fontSize: 10, fontStyle: 'bold' });
  y += 8;

  // Table header
  doc.setFillColor(243, 244, 246);
  doc.rect(margin, y - 3, contentWidth, 8, 'F');
  
  const colDesc = margin + 3;
  const colQty = margin + 95;
  const colUnit = margin + 115;
  const colTotal = pageWidth - margin - 3;

  addText('Description', colDesc, y + 2, { fontSize: 8, fontStyle: 'bold', color: mutedColor });
  addText('Qté', colQty, y + 2, { fontSize: 8, fontStyle: 'bold', color: mutedColor });
  addText('Prix U.', colUnit, y + 2, { fontSize: 8, fontStyle: 'bold', color: mutedColor });
  addText('Total', colTotal, y + 2, { fontSize: 8, fontStyle: 'bold', color: mutedColor, align: 'right' });

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
    addText('Frais de service', colDesc, y, { fontSize: 9, color: mutedColor });
    addText('1', colQty, y, { fontSize: 9, color: mutedColor });
    addText(formatPrice(data.serviceFee), colUnit, y, { fontSize: 9, color: mutedColor });
    addText(formatPrice(data.serviceFee), colTotal, y, { fontSize: 9, color: mutedColor, align: 'right' });
    y += 6;
  }

  // Management fee
  if (data.managementFee && data.managementFee > 0) {
    addText('Frais de gestion', colDesc, y, { fontSize: 9, color: mutedColor });
    addText('1', colQty, y, { fontSize: 9, color: mutedColor });
    addText(formatPrice(data.managementFee), colUnit, y, { fontSize: 9, color: mutedColor });
    addText(formatPrice(data.managementFee), colTotal, y, { fontSize: 9, color: mutedColor, align: 'right' });
    y += 6;
  }

  // Insurance fee
  if (data.insuranceFee && data.insuranceFee > 0) {
    addText('Assurance annulation', colDesc, y, { fontSize: 9, color: mutedColor });
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
  addText('Sous-total HT', colUnit - 20, y, { fontSize: 9 });
  addText(formatPrice(data.totalHT), colTotal, y, { fontSize: 9, align: 'right' });
  y += 5;

  addText('TVA (20%)', colUnit - 20, y, { fontSize: 9, color: mutedColor });
  addText(formatPrice(data.tva), colTotal, y, { fontSize: 9, color: mutedColor, align: 'right' });
  y += 6;

  doc.setFillColor(...primaryColor);
  doc.roundedRect(colUnit - 25, y - 4, pageWidth - margin - colUnit + 28, 10, 2, 2, 'F');
  addText('TOTAL TTC', colUnit - 20, y + 2, { fontSize: 10, fontStyle: 'bold', color: [255, 255, 255] });
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

    addText('RÉPARTITION CO-ÉVÉNEMENT', margin + 5, y + 6, { fontSize: 8, fontStyle: 'bold', color: primaryColor });
    addText(modeLabel, pageWidth - margin - 5, y + 6, { fontSize: 8, color: mutedColor, align: 'right' });

    // Line 1: gross
    addText('Montant TTC encaissé', margin + 5, y + 14, { fontSize: 9 });
    addText(formatPrice(data.totalTTC), pageWidth - margin - 5, y + 14, { fontSize: 9, align: 'right' });

    // Line 2: yuno fee
    addText(`Frais de service Yuno`, margin + 5, y + 20, { fontSize: 9, color: mutedColor });
    addText(`- ${formatPrice(ce.yunoFee)}`, pageWidth - margin - 5, y + 20, { fontSize: 9, color: mutedColor, align: 'right' });

    // Line 3: net base
    doc.setDrawColor(229, 231, 235);
    doc.line(margin + 5, y + 23, pageWidth - margin - 5, y + 23);
    addText('Net à répartir', margin + 5, y + 28, { fontSize: 9, fontStyle: 'bold' });
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
    addText('PARTICIPANTS', margin, y, { fontSize: 10, fontStyle: 'bold' });
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
  addText('Présentez ce code à l\'entrée', pageWidth / 2, y, { fontSize: 8, color: mutedColor, align: 'center' });

  // ==================== LEGAL MENTIONS ====================
  y = doc.internal.pageSize.getHeight() - 35;
  
  doc.setDrawColor(229, 231, 235);
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageWidth - margin, y);
  y += 5;

  addText('MENTIONS LÉGALES', margin, y, { fontSize: 7, fontStyle: 'bold', color: mutedColor });
  y += 4;

  const legalMentions = [
    `Paiement effectué par carte bancaire le ${formatDate(data.paymentDate)}`,
    data.venueVatNumber ? 'TVA applicable selon le régime en vigueur' : 'TVA non applicable - Art. 293 B du CGI',
    'Cette facture tient lieu de justificatif de paiement',
    `Facture générée automatiquement - ${data.venueLegalName || data.venueName}`,
  ];

  legalMentions.forEach((mention) => {
    addText(`• ${mention}`, margin, y, { fontSize: 7, color: mutedColor });
    y += 3.5;
  });

  // Return as blob
  return doc.output('blob');
};

export const downloadInvoicePDF = async (data: InvoiceData, filename?: string): Promise<void> => {
  const blob = await generateInvoicePDF(data);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || `facture-${data.invoiceNumber}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
