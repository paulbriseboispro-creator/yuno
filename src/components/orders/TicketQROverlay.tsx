import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import QRCode from 'qrcode';
import { haptics } from '@/lib/haptics';
import { OrderQROverlay, type QRSlide, type QRAction } from './TemporalOrders';

interface TicketQROverlayProps {
  ticketId: string;
  ticketQrCode: string;
  quantity: number;
  roundName: string;
  eventTitle: string;
  venueName: string;
  entryScanned?: boolean;
  labels: { scanThisQR: string; shareThisQR?: string; valid: string; scanned: string };
  onClose: () => void;
  /** quick actions (directions, event page, calendar…) */
  actions?: QRAction[];
  /** date + time line, e.g. "SAT 14 JUN · 23:00" */
  whenLabel?: string;
  /** skip the fade-in mount animation (used when restored from history) */
  instant?: boolean;
  /** event poster used as a blurred full-screen colour backdrop */
  posterUrl?: string;
  /** event poster shown as a 1:1 thumbnail in the info card */
  posterThumb?: string;
  /** localized kind label ("Billet") for the header chip */
  kindLabel?: string;
}

const QR_OPTS = { width: 240, margin: 2, color: { dark: '#000000', light: '#ffffff' } };

/**
 * Fullscreen ticket QR using the shared premium OrderQROverlay design.
 * Fetches per-attendee QR codes and renders them as a swipeable carousel,
 * falling back to the ticket-level QR when no attendees exist.
 */
export function TicketQROverlay({
  ticketId, ticketQrCode, quantity, roundName, eventTitle, venueName,
  entryScanned, labels, onClose, actions, whenLabel, instant, posterUrl, posterThumb, kindLabel,
}: TicketQROverlayProps) {
  const [slides, setSlides] = useState<QRSlide[]>([]);
  // Ids des participants alignés sur `slides` (vide = slide fallback billet).
  const attendeeIds = useRef<string[]>([]);

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
          attendeeIds.current = data.map((a) => a.id);
          for (const a of data) {
            const qrImage = a.qr_code ? await QRCode.toDataURL(a.qr_code, QR_OPTS) : undefined;
            next.push({ qrImage, caption: a.full_name, scanned: a.entry_scanned });
          }
        } else {
          attendeeIds.current = [];
          next = await fallbackSlide();
        }
      } catch (err) {
        console.error('Error fetching ticket attendees:', err);
        attendeeIds.current = [];
        next = await fallbackSlide();
      }
      if (!cancelled) setSlides(next);
    })();

    return () => { cancelled = true; };
  }, [ticketId, ticketQrCode, entryScanned]);

  // Realtime pendant que le QR est à l'écran : le scan du videur fait vibrer
  // le téléphone du client et bascule le badge « Valide » → « Scanné » en direct.
  useEffect(() => {
    const markScanned = (matchIndex: (i: number) => boolean) => {
      setSlides((prev) => {
        let flipped = false;
        const next = prev.map((s, i) => {
          if (matchIndex(i) && !s.scanned) { flipped = true; return { ...s, scanned: true }; }
          return s;
        });
        if (flipped) haptics.success();
        return flipped ? next : prev;
      });
    };

    const channel = supabase
      .channel(`ticket-scan-${ticketId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'ticket_attendees', filter: `ticket_id=eq.${ticketId}` },
        (payload) => {
          const row = payload.new as { id?: string; entry_scanned?: boolean };
          if (!row?.id || !row.entry_scanned) return;
          const idx = attendeeIds.current.indexOf(row.id);
          if (idx >= 0) markScanned((i) => i === idx);
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'tickets', filter: `id=eq.${ticketId}` },
        (payload) => {
          const row = payload.new as { entry_scanned?: boolean };
          // Slide fallback (billet sans participants nominatifs)
          if (row?.entry_scanned && attendeeIds.current.length === 0) markScanned(() => true);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [ticketId]);

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
      actions={actions}
      whenLabel={whenLabel}
      instant={instant}
      posterUrl={posterUrl}
      posterThumb={posterThumb}
      kindLabel={kindLabel}
    />
  );
}
