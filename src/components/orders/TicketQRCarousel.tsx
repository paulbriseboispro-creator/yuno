import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Ticket, CheckCircle2, ChevronLeft, ChevronRight, User } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import QRCode from 'qrcode';

interface Attendee {
  id: string;
  full_name: string;
  qr_code: string;
  entry_scanned: boolean;
}

interface TicketQRCarouselProps {
  ticketId: string;
  ticketQrCode: string;
  quantity: number;
  roundName: string;
  eventTitle: string;
  venueName: string;
  entryScanned?: boolean;
  onClose: () => void;
  /** When true, renders inline without fullscreen overlay */
  embedded?: boolean;
}

export function TicketQRCarousel({
  ticketId,
  ticketQrCode,
  quantity,
  roundName,
  eventTitle,
  venueName,
  entryScanned,
  onClose,
  embedded = false,
}: TicketQRCarouselProps) {
  const { t } = useLanguage();
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [qrImages, setQrImages] = useState<Record<string, string>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const touchStartX = useRef(0);
  const touchEndX = useRef(0);

  useEffect(() => {
    fetchAttendees();
  }, [ticketId]);

  const fetchAttendees = async () => {
    try {
      const { data, error } = await supabase
        .from('ticket_attendees')
        .select('id, full_name, qr_code, entry_scanned')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: true });

      if (error) throw error;

      if (data && data.length > 0) {
        setAttendees(data);
        // Generate QR for each attendee
        for (const attendee of data) {
          if (attendee.qr_code) {
            const qrDataUrl = await QRCode.toDataURL(attendee.qr_code, {
              width: 220,
              margin: 2,
              color: { dark: '#000000', light: '#ffffff' },
            });
            setQrImages(prev => ({ ...prev, [attendee.id]: qrDataUrl }));
          }
        }
      } else {
        // Fallback: no attendees, use ticket-level QR
        const qrDataUrl = await QRCode.toDataURL(ticketQrCode, {
          width: 220,
          margin: 2,
          color: { dark: '#000000', light: '#ffffff' },
        });
        setQrImages({ fallback: qrDataUrl });
      }
    } catch (err) {
      console.error('Error fetching attendees:', err);
      // Fallback to ticket QR
      try {
        const qrDataUrl = await QRCode.toDataURL(ticketQrCode, {
          width: 220,
          margin: 2,
          color: { dark: '#000000', light: '#ffffff' },
        });
        setQrImages({ fallback: qrDataUrl });
      } catch {}
    } finally {
      setLoading(false);
    }
  };

  const totalSlides = attendees.length > 0 ? attendees.length : 1;

  const goNext = () => setCurrentIndex(prev => Math.min(prev + 1, totalSlides - 1));
  const goPrev = () => setCurrentIndex(prev => Math.max(prev - 1, 0));

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    touchEndX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = () => {
    const diff = touchStartX.current - touchEndX.current;
    const threshold = 50;
    if (diff > threshold) goNext();
    else if (diff < -threshold) goPrev();
  };

  const currentAttendee = attendees[currentIndex];
  const isScanned = currentAttendee?.entry_scanned || (attendees.length === 0 && entryScanned);

  const carouselContent = (
    <>
      {loading ? (
        <div className="flex items-center justify-center h-52">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : (
        <div
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {/* Attendee name */}
          {currentAttendee && (
            <div className="flex items-center justify-center gap-1.5 mb-3">
              <User className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">
                {currentAttendee.full_name}
              </span>
              {currentAttendee.entry_scanned && (
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              )}
            </div>
          )}

          {/* QR Code */}
          <AnimatePresence mode="wait">
            <motion.div
              key={currentIndex}
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -30 }}
              transition={{ duration: 0.2 }}
              className="bg-white p-4 rounded-xl border border-border inline-block mb-3"
            >
              {attendees.length > 0 && currentAttendee ? (
                qrImages[currentAttendee.id] ? (
                  <img src={qrImages[currentAttendee.id]} alt="QR Code" className="w-44 h-44 mx-auto" />
                ) : (
                  <div className="w-44 h-44 flex items-center justify-center">
                    <div className="h-6 w-6 animate-spin rounded-full border-3 border-primary border-t-transparent" />
                  </div>
                )
              ) : (
                qrImages.fallback && (
                  <img src={qrImages.fallback} alt="QR Code" className="w-44 h-44 mx-auto" />
                )
              )}
            </motion.div>
          </AnimatePresence>

          {/* Navigation dots & arrows */}
          {totalSlides > 1 && (
            <div className="flex items-center justify-center gap-3 mb-3">
              <button
                onClick={goPrev}
                disabled={currentIndex === 0}
                className="p-1.5 rounded-full hover:bg-muted disabled:opacity-30 transition-opacity"
              >
                <ChevronLeft className="h-5 w-5 text-muted-foreground" />
              </button>

              <div className="flex items-center gap-1.5">
                {attendees.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setCurrentIndex(i)}
                    className={`h-2 rounded-full transition-all ${
                      i === currentIndex
                        ? 'w-6 bg-primary'
                        : 'w-2 bg-muted-foreground/30'
                    }`}
                  />
                ))}
              </div>

              <button
                onClick={goNext}
                disabled={currentIndex === totalSlides - 1}
                className="p-1.5 rounded-full hover:bg-muted disabled:opacity-30 transition-opacity"
              >
                <ChevronRight className="h-5 w-5 text-muted-foreground" />
              </button>
            </div>
          )}

          {/* Counter */}
          {totalSlides > 1 && (
            <p className="text-xs text-muted-foreground mb-2">
              {t('tickets.ticketOf')} {currentIndex + 1}/{totalSlides}
            </p>
          )}
        </div>
      )}
    </>
  );

  // Embedded mode: render inline without overlay
  if (embedded) {
    return (
      <div className="flex flex-col items-center text-center">
        {isScanned && (
          <Badge className="bg-emerald-500/20 text-emerald-500 mb-3">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            {t('tickets.scanned')}
          </Badge>
        )}
        {carouselContent}
      </div>
    );
  }

  // Fullscreen overlay mode
  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-background rounded-2xl p-6 max-w-sm w-full text-center shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Badge */}
        <div className="flex items-center justify-center gap-2 mb-3">
          <Badge className="bg-primary text-primary-foreground">
            <Ticket className="h-3 w-3 mr-1" />
            {quantity}x {roundName}
          </Badge>
          {isScanned && (
            <Badge className="bg-emerald-500/20 text-emerald-500">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              {t('tickets.scanned')}
            </Badge>
          )}
        </div>

        <h3 className="font-bold text-lg mb-1">{eventTitle}</h3>
        <p className="text-sm text-muted-foreground mb-4">{venueName}</p>

        {carouselContent}

        <p className="text-xs text-muted-foreground mb-4">{t('tickets.showAtEntry')}</p>

        <Button
          variant="outline"
          className="w-full h-11 font-medium"
          onClick={onClose}
        >
          {t('common.close')}
        </Button>
      </motion.div>
    </div>
  );
}
