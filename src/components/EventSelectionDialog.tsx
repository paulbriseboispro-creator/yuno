import { useState, useEffect } from 'react';
import { Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { Event } from '@/types';
import { formatInTimeZone } from 'date-fns-tz';
import { fr, es, enUS } from 'date-fns/locale';
import { motion } from 'framer-motion';
import { useLanguage } from '@/contexts/LanguageContext';
import { PARIS_TIMEZONE, nowInParis } from '@/lib/timezone';

interface EventSelectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEventSelect: (event: Event) => void;
  /** Venue hosting the drinks. Matches solo events (venue_id) AND collab events (partner_venue_id). */
  venueId?: string;
  /** Optional organizer scope. Lists events organised by this user whose host venue
   *  (venue_id OR partner_venue_id) has drinks sales enabled (menu_enabled = true). */
  organizerUserId?: string;
}

export function EventSelectionDialog({
  open,
  onOpenChange,
  onEventSelect,
  venueId,
  organizerUserId,
}: EventSelectionDialogProps) {
  const [events, setEvents] = useState<(Event & { posterUrl?: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const { t, language } = useLanguage();

  const getLocale = () => {
    switch (language) {
      case 'fr': return fr;
      case 'es': return es;
      default: return enUS;
    }
  };

  useEffect(() => {
    if (open) {
      fetchEvents();
    }
  }, [open, venueId, organizerUserId]);

  const fetchEvents = async () => {
    try {
      setLoading(true);
      const now = nowInParis().toISOString();

      let query = supabase
        .from('events')
        .select('*')
        .eq('is_active', true)
        .gte('end_at', now)
        .order('start_at', { ascending: true });

      if (organizerUserId) {
        // Organizer scope: any event organised by this user
        query = query.eq('organizer_user_id', organizerUserId);
      } else if (venueId) {
        // Venue scope: include solo events AND collab events hosted at this venue
        query = query.or(`venue_id.eq.${venueId},partner_venue_id.eq.${venueId}`);
      }

      const { data, error } = await query;
      if (error) throw error;

      let rows = data || [];

      if (organizerUserId) {
        // Keep only events whose host venue (venue_id OR partner_venue_id) has drinks sales enabled
        const hostVenueIds = [
          ...new Set(
            rows
              .map((e: any) => e.venue_id || e.partner_venue_id)
              .filter(Boolean) as string[],
          ),
        ];
        if (hostVenueIds.length > 0) {
          const { data: venues } = await supabase
            .from('venues')
            .select('id, menu_enabled')
            .in('id', hostVenueIds);
          const enabled = new Set(
            (venues ?? []).filter((v: any) => v.menu_enabled === true).map((v: any) => v.id),
          );
          rows = rows.filter((e: any) => {
            const host = e.venue_id || e.partner_venue_id;
            return host && enabled.has(host);
          });
        } else {
          rows = [];
        }
      }

      const mappedEvents: (Event & { posterUrl?: string })[] = rows.map((event: any) => ({
        id: event.id,
        venueId: event.venue_id,
        title: event.title,
        description: event.description || undefined,
        imageUrl: event.image_url || undefined,
        posterUrl: event.poster_url || undefined,
        startAt: event.start_at,
        endAt: event.end_at,
        isActive: event.is_active,
        createdAt: event.created_at,
        updatedAt: event.updated_at,
      }));

      setEvents(mappedEvents);
    } catch (error) {
      console.error('Error fetching events:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('event.selectTitle')}</DialogTitle>
          <DialogDescription>
            {t('event.selectDesc')}
          </DialogDescription>
        </DialogHeader>
        
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : events.length === 0 ? (
          <div className="text-center py-8">
            <Calendar className="mx-auto h-12 w-12 text-muted-foreground mb-2" />
            <p className="text-lg font-semibold mb-1">{t('event.noEvents')}</p>
            <p className="text-sm text-muted-foreground">{t('event.noEventsDesc')}</p>
          </div>
        ) : (
          <div className="space-y-3 max-h-[500px] overflow-y-auto">
            {events.map((event, index) => (
              <motion.button
                key={event.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                onClick={() => {
                  onEventSelect(event);
                  onOpenChange(false);
                }}
                className="w-full text-left rounded-lg border border-border hover:border-primary hover:bg-accent/50 transition-all p-3"
              >
                <div className="flex gap-3">
                  {/* Poster thumbnail — square 1:1 (poster_url is the 1080×1080 square; image_url is the 16:9 banner fallback) */}
                  {(event.posterUrl || event.imageUrl) && (
                    <div className="w-16 h-16 flex-shrink-0 rounded-md overflow-hidden bg-muted">
                      <img
                        src={event.posterUrl || event.imageUrl}
                        alt={event.title}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}
                  
                  {/* Event info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-2">
                      <Calendar className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-foreground text-sm">{event.title}</h3>
                        {event.description && (
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                            {event.description}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatInTimeZone(new Date(event.startAt), PARIS_TIMEZONE, 'EEE d MMM', { locale: getLocale() })}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatInTimeZone(new Date(event.startAt), PARIS_TIMEZONE, 'HH:mm', { locale: getLocale() })} - {formatInTimeZone(new Date(event.endAt), PARIS_TIMEZONE, 'HH:mm', { locale: getLocale() })}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.button>
            ))}
          </div>
        )}
        
        <Button
          variant="outline"
          onClick={() => onOpenChange(false)}
          className="w-full"
        >
          {t('event.cancel')}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
