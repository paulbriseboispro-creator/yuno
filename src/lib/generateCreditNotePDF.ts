// Avoir en PDF (navigateur) : le dessin vit dans supabase/functions/_shared/pdf-documents.ts (drawCreditNote), partagé avec le reste des
// documents ; ici seulement jsPDF, le logo du vendeur et la livraison (téléchargement web, feuille de partage native).

import jsPDF from 'jspdf';
import { drawCreditNote, type DocLang, type PdfDoc } from '../../supabase/functions/_shared/pdf-documents';
import { creditNoteFilename, creditNoteToPdfData, type CreditNoteDoc } from './creditNote';
import { deliverDocument, type DeliverOutcome } from './generateDocuments';

async function loadImage(url?: string | null): Promise<string | undefined> {
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

export async function generateCreditNotePDF(doc: CreditNoteDoc, lang: DocLang = 'fr'): Promise<Blob> {
  const sellerLogo = await loadImage(doc.seller?.logo_url);
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  drawCreditNote(pdf as unknown as PdfDoc, { ...creditNoteToPdfData(doc, lang), sellerLogo });
  return pdf.output('blob');
}

/** Génère puis livre l'avoir (téléchargement ou feuille de partage native). */
export async function deliverCreditNote(doc: CreditNoteDoc, lang: DocLang = 'fr'): Promise<DeliverOutcome> {
  const blob = await generateCreditNotePDF(doc, lang);
  return deliverDocument(blob, creditNoteFilename(doc), doc.credit_number);
}
