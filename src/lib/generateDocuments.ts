// ─────────────────────────────────────────────────────────────────────────────
// Yuno documents — browser wrapper around the shared isomorphic PDF core.
//
// The drawing logic lives in supabase/functions/_shared/pdf-documents.ts (pure,
// import-free) so the OrderConfirmation page (here) and the send-ticket-confirmation
// edge function render byte-identical "Reçu de transaction" + "Billet" PDFs. This
// wrapper only does the browser-specific bits: loading images to data URLs and
// generating the QR PNG, then hands a jsPDF instance to the core.
// ─────────────────────────────────────────────────────────────────────────────

import jsPDF from 'jspdf';
import QRCode from 'qrcode';
import {
  drawReceipt, drawBillet,
  type ReceiptData, type BilletData, type PdfDoc,
} from '../../supabase/functions/_shared/pdf-documents';

export { receiptLineLabels } from '../../supabase/functions/_shared/pdf-documents';
export type { ReceiptLine, BilletData, ReceiptData, DocLang } from '../../supabase/functions/_shared/pdf-documents';

async function loadImage(url?: string): Promise<string | undefined> {
  if (!url) return undefined;
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise<string | undefined>((resolve) => {
      const r = new FileReader();
      r.onloadend = () => resolve(r.result as string);
      r.onerror = () => resolve(undefined);
      r.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}

export type ReceiptInput = Omit<ReceiptData, 'sellerLogo'> & { sellerLogoUrl?: string };
export type BilletInput = Omit<BilletData, 'poster' | 'qr'> & { posterUrl?: string; qrValue: string };

/** Fiscal "Reçu de transaction" — club is the sole seller. No QR. */
export async function generateReceiptPDF(input: ReceiptInput): Promise<Blob> {
  const sellerLogo = await loadImage(input.sellerLogoUrl);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  drawReceipt(doc as unknown as PdfDoc, { ...input, sellerLogo });
  return doc.output('blob');
}

/** Entry "Billet" — poster, event, QR. One page per attendee when `attendees` > 1. */
export async function generateBilletPDF(input: BilletInput): Promise<Blob> {
  const [poster, qr] = await Promise.all([
    loadImage(input.posterUrl),
    QRCode.toDataURL(input.qrValue, { width: 260, margin: 1 }),
  ]);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  drawBillet(doc as unknown as PdfDoc, { ...input, poster, qr });
  return doc.output('blob');
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
