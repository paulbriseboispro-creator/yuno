import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import QRCode from 'qrcode';
import { OrderQROverlay, type QRSlide } from './TemporalOrders';

interface TicketQROverlayProps {
  ticketId: string;
  ticketQrCode: string;
  quantity: number;
  roundName: string;
  eventTitle: string;
  venueName: string;
  entryScanned?: boolean;
  labels: { scanThisQR: string; shareThisQR: string; valid: string; scanned: string };
  onClose: () => void;
  onShare?: () => void;
}

const QR_OPTS = { width: 240, margin: 2, color: { dark: '#000000', light: '#ffffff' } };

/**
 * Fullscreen ticket QR using the shared premium OrderQROverlay design.
 * Fetches per-attendee QR codes and renders them as a swipeable carousel,
 * falling back to the ticket-level QR when no attendees exist.
 */
export function TicketQROverlay({
  ticketId, ticketQrCode, quantity, roundName, eventTitle, venueName,
  entryScanned, labels, onClose, onShare,
}: TicketQROverlayProps) {
  const [slides, setSlides] = useState<QRSlide[]>([]);

  useEffect(() => {
    let cancelled = false;

    const fallbackSlide = async (): Promise<QRSlide[]> => {
      if (!ticketQrCode) return [{ scanned: entryScanned }];
      try {
        return [{ qrImage: await QRCode.toDataURL(ticketQrCode, QR_OPTS), scanned: entryScanned }];
      } catch {
        return [{ scanned: entryScanned }];
      }
    };

    (async () => {
      let next: QRSlide[];
      try {
        const { data, error } = await supabase
          .from('ticket_attendees')
          .select('id, full_name, qr_code, entry_scanned')
          .eq('ticket_id', ticketId)
          .order('created_at', { ascending: true });

        if (error) throw error;

        if (data && data.length > 0) {
          next = [];
          for (const a of data) {
            const qrImage = a.qr_code ? await QRCode.toDataURL(a.qr_code, QR_OPTS) : undefined;
            next.push({ qrImage, caption: a.full_name, scanned: a.entry_scanned });
          }
        } else {
          next = await fallbackSlide();
        }
      } catch (err) {
        console.error('Error fetching ticket attendees:', err);
        next = await fallbackSlide();
      }
      if (!cancelled) setSlides(next);
    })();

    return () => { cancelled = true; };
  }, [ticketId, ticketQrCode, entryScanned]);

  return (
    <OrderQROverlay
      kind="ticket"
      title={eventTitle}
      venueName={venueName}
      idLabel={`${quantity}× ${roundName}`}
      slides={slides}
      scanned={entryScanned}
      labels={labels}
      onClose={onClose}
      onShare={onShare}
    />
  );
}
