import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import type { QRSlide } from '@/components/orders/TemporalOrders';
import { tableGuestName, tableGuestTicketCount } from '@/lib/tableGuests';

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
): QRSlide[] | null {
  const { t } = useLanguage();
  const [slides, setSlides] = useState<QRSlide[] | null>(null);
  const wanted = !!reservationId && tableGuestTicketCount(guestCount) > 0;

  useEffect(() => {
    if (!wanted || !reservationId) { setSlides(null); return; }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('table_reservation_guests')
        .select('guest_number, full_name, qr_code, entry_scanned')
        .eq('reservation_id', reservationId)
        .order('guest_number', { ascending: true });
      if (cancelled) return;
      if (error || !data || data.length === 0) { setSlides(null); return; }
      const guestWord = (k: number) => t('tableGuest.label').replace('{n}', String(k));
      const next: QRSlide[] = [];
      for (const g of data) {
        next.push({
          qrImage: await QRCode.toDataURL(g.qr_code, QR_OPTS).catch(() => undefined),
          caption: tableGuestName(g, holderName, guestWord),
          scanned: g.entry_scanned,
        });
      }
      if (!cancelled) setSlides(next);
    })();
    return () => { cancelled = true; };
  }, [wanted, reservationId, holderName, t]);

  return slides;
}
