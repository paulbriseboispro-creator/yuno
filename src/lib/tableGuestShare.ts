import { publicUrl } from '@/lib/native';
import { guestPassPath, whatsappShareHref } from '@/lib/tableReceipt';

/**
 * Envoie le QR d'UN invité de table : feuille de partage du téléphone quand elle existe, sinon WhatsApp.
 * Le lien ouvre `/t/<qr>` : ce QR seul, la soirée et l'heure — rien sur l'acheteur ni le prix.
 * Rend `true` si un partage a été lancé, `false` si la personne l'a annulé.
 */
export async function shareTableGuestQr(opts: { qr: string; text: string; title: string }): Promise<boolean> {
  const url = publicUrl(guestPassPath(opts.qr));
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  if (nav && typeof nav.share === 'function') {
    try {
      await nav.share({ title: opts.title, text: opts.text, url });
      return true;
    } catch (err) {
      // Annulé par la personne : rien à faire. Toute autre erreur retombe sur WhatsApp.
      if ((err as { name?: string })?.name === 'AbortError') return false;
    }
  }
  openWhatsAppShare(opts.text, url);
  return true;
}

/** WhatsApp en repli (ou en bouton à part). */
export function openWhatsAppShare(text: string, url: string): void {
  if (typeof window === 'undefined') return;
  window.open(whatsappShareHref(text, url), '_blank', 'noopener,noreferrer');
}

export function guestQrPublicUrl(qr: string): string {
  return publicUrl(guestPassPath(qr));
}
