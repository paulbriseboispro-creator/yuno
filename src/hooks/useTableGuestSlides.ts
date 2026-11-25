import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import type { QRSlide } from '@/components/orders/TemporalOrders';
import { tableGuestName, tableGuestTicketCount } from '@/lib/tableGuests';
import { fetchTableReceipt, fillTemplate } from '@/lib/tableReceipt';
import { shareTableGuestQr, openWhatsAppShare, guestQrPublicUrl } from '@/lib/tableGuestShare';

const QR_OPTS = { width: 240, margin: 2, color: { dark: '#000000', light: '#ffffff' } };

/**
 * Les tickets d'une table en slides de QR (titulaire, puis Invité 1, 2…), pour
 * l'écran QR de « Mes commandes ». `null` = pas de tickets par personne (table
 * d'une personne, ou lecture impossible) : l'écran garde le QR de la réservation.
 */
export function useTableGuestSlides(
  reservationId: string | null | undefined,
  guestCount: number | null | undefined,
  holderName: string | null | undefined,
  /** QR de la réservation : preuve pour relire les invités d'un acheteur sans compte. */
  reservationQr?: string | null,
  /** Titre de la soirée, pour la phrase de partage. */
  eventTitle?: string | null,
): QRSlide[] | null {
  const { t } = useLanguage();
  const [slides, setSlides] = useState<QRSlide[] | null>(null);
  const wanted = !!reservationId && tableGuestTicketCount(guestCount) > 0;

  useEffect(() => {
    if (!wanted || !reservationId) { setSlides(null); return; }
    let cancelled = false;
    (async () => {
      const direct = await supabase
        .from('table_reservation_guests')
        .select('guest_number, full_name, qr_code, entry_scanned')
        .eq('reservation_id', reservationId)
        .order('guest_number', { ascending: true });
      let data: Array<{ guest_number: number; full_name: string | null; qr_code: string; entry_scanned: boolean | null }> | null = direct.data;
      if ((direct.error || !data || data.length === 0) && reservationQr) {
        // Pas de compte (ou RLS) : le QR de la réservation prouve qu'elle est à moi, la base rend ses invités.
        const receipt = await fetchTableReceipt(supabase as unknown as Parameters<typeof fetchTableReceipt>[0], reservationId, reservationQr);
        data = receipt?.guests ?? null;
      }
      if (cancelled) return;
      if (!data || data.length === 0) { setSlides(null); return; }
      const guestWord = (k: number) => t('tableGuest.label').replace('{n}', String(k));
      const next: QRSlide[] = [];
      for (const g of data) {
        const text = fillTemplate(t('tblc.share.text'), { event: eventTitle || '', holder: (holderName || '').trim() });
        next.push({
          qrImage: await QRCode.toDataURL(g.qr_code, QR_OPTS).catch(() => undefined),
          caption: tableGuestName(g, holderName, guestWord),
          scanned: !!g.entry_scanned,
          // Le titulaire envoie le QR de chaque invité ; le sien reste le sien.
          share: g.guest_number > 0 ? {
            label: t('tblc.share.button'),
            onShare: () => { void shareTableGuestQr({ qr: g.qr_code, text, title: eventTitle || 'Yuno' }); },
            whatsappLabel: 'WhatsApp',
            onWhatsApp: () => openWhatsAppShare(text, guestQrPublicUrl(g.qr_code)),
          } : undefined,
        });
      }
      if (!cancelled) setSlides(next);
    })();
    return () => { cancelled = true; };
  }, [wanted, reservationId, holderName, reservationQr, eventTitle, t]);

  return slides;
}
