import { useEffect, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { MapPin, Calendar, ChevronRight, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { format } from 'date-fns';
import { fr, enUS, es } from 'date-fns/locale';
import type { MapVenue } from './VenueMap';

interface UpcomingEvent {
  id: string;
  title: string;
  start_at: string;
  music_genres: string[] | null;
}

interface VenuePreviewCardProps {
  venue: MapVenue;
  onClose: () => void;
  onNavigate: (venueId: string) => void;
}

export default function VenuePreviewCard({ venue, onClose, onNavigate }: VenuePreviewCardProps) {
  const { t, language } = useLanguage();
  const reduceMotion = useReducedMotion();
  const [events, setEvents] = useState<UpcomingEvent[]>([]);
  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;

  useEffect(() => {
    const fetchEvents = async () => {
      const now = new Date().toISOString();
      // Include co-organized events where the venue is the partner host.
      const { data } = await supabase
        .from('events')
        .select('id, title, start_at, music_genres')
        .or(`venue_id.eq.${venue.id},partner_venue_id.eq.${venue.id}`)
        .eq('is_active', true)
        .gte('end_at', now)
        .order('start_at')
        .limit(3);
      setEvents(data || []);
    };
    fetchEvents();
  }, [venue.id]);

  return (
    <AnimatePresence>
      <motion.div
        initial={reduceMotion ? { opacity: 0 } : { y: 100, opacity: 0 }}
        animate={reduceMotion ? { opacity: 1 } : { y: 0, opacity: 1 }}
        exit={reduceMotion ? { opacity: 0 } : { y: 100, opacity: 0 }}
        transition={reduceMotion ? { duration: 0.2 } : { type: 'spring', damping: 25, stiffness: 300 }}
        className="fixed bottom-[calc(env(safe-area-inset-bottom,0px)+72px)] left-3 right-3 z-30"
      >
        <div className="bg-card border border-border rounded-2xl shadow-xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-3 p-4 pb-2">
            <div className="w-12 h-12 rounded-xl overflow-hidden bg-muted shrink-0 border border-border">
              {venue.logo_url ? (
                <img src={venue.logo_url} alt={venue.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-lg font-bold text-muted-foreground">
                  {venue.name.charAt(0)}
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-base truncate">{venue.name}</h3>
              {venue.city && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <MapPin className="w-3 h-3 shrink-0" />
                  {venue.city}
                </p>
              )}
            </div>
            <button onClick={onClose} className="p-1.5 rounded-full hover:bg-muted transition-colors">
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>

          {/* Events */}
          {events.length > 0 && (
            <div className="px-4 pb-2 space-y-1.5">
              <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                {t('map.upcomingEvents')}
              </p>
              {events.map((event) => (
                <button
                  key={event.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onNavigate(`${venue.id}/event/${event.id}`);
                  }}
                  className="w-full flex items-center gap-2 py-1.5 px-2 rounded-lg bg-muted/50 hover:bg-muted/80 transition-colors text-left"
                >
                  <Calendar className="w-3.5 h-3.5 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{event.title}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {format(new Date(event.start_at), 'EEE d MMM · HH:mm', { locale: dateLocale })}
                      {event.music_genres && event.music_genres.length > 0 ? ` · ${event.music_genres.join(', ')}` : ''}
                    </p>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                </button>
              ))}
            </div>
          )}

          {events.length === 0 && (
            <div className="px-4 pb-2">
              <p className="text-xs text-muted-foreground">{t('map.noUpcomingEvents')}</p>
            </div>
          )}

          {/* CTA */}
          <button
            onClick={() => onNavigate(venue.id)}
            className="w-full flex items-center justify-center gap-2 py-3 bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-colors"
          >
            {t('map.seeClub')}
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
