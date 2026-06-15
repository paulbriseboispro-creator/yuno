import { useState, useEffect } from 'react';
import { Calendar } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { uniqueChannel } from '@/lib/realtime';
import { Event } from '@/types';
import { formatInTimeZone } from 'date-fns-tz';
import { fr, es, enUS } from 'date-fns/locale';
import { PARIS_TIMEZONE, nowInParis, toParisTime } from '@/lib/timezone';
import { useLanguage } from '@/contexts/LanguageContext';

interface EventFilterProps {
  selectedEventId: string | null;
  onEventSelect: (eventId: string | null) => void;
  venueId: string;
}

export function EventFilter({ selectedEventId, onEventSelect, venueId }: EventFilterProps) {
  const { t, language } = useLanguage();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);

  const getLocale = () => {
    switch (language) {
      case 'fr': return fr;
      case 'es': return es;
      default: return enUS;
    }
  };

  useEffect(() => {
    const fetchEvents = async () => {
      try {
        const now = new Date().toISOString();
        
        // Only fetch events that haven't ended yet
        const { data, error } = await supabase
          .from('events')
          .select('*')
          .eq('venue_id', venueId)
          .gte('end_at', now)
          .order('start_at', { ascending: false });

        if (error) throw error;

        const mappedEvents: Event[] = (data || []).map((event) => ({
          id: event.id,
          venueId: event.venue_id,
          title: event.title,
          startAt: event.start_at,
          endAt: event.end_at,
          isActive: event.is_active,
          createdAt: event.created_at,
          updatedAt: event.updated_at,
        }));

        setEvents(mappedEvents);

        // Auto-select today's active event if none selected
        if (!selectedEventId) {
          const now = nowInParis();
          const todayEvent = mappedEvents.find(
            (e) => e.isActive && toParisTime(e.startAt) <= now && toParisTime(e.endAt) >= now
          );
          if (todayEvent) {
            onEventSelect(todayEvent.id);
          }
        }
      } catch (error) {
        console.error('Error fetching events:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchEvents();

    // Realtime subscription. Unique topic per mount (see uniqueChannel): the
    // Barman page renders EventFilter twice (desktop + mobile), and a shared
    // topic would crash both copies.
    const channel = supabase
      .channel(uniqueChannel(`events-filter-changes-${venueId || 'all'}`))
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'events',
          filter: `venue_id=eq.${venueId}`,
        },
        () => {
          fetchEvents();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [venueId, selectedEventId, onEventSelect]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Calendar className="h-4 w-4" />
        {t('eventFilter.loading')}
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Calendar className="h-4 w-4" />
        {t('eventFilter.noEvents')}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Calendar className="h-4 w-4 text-primary" />
      <Select value={selectedEventId || 'all'} onValueChange={(value) => onEventSelect(value === 'all' ? null : value)}>
        <SelectTrigger className="w-auto min-w-[200px]">
          <SelectValue placeholder={t('eventFilter.allEvents')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t('eventFilter.allEvents')}</SelectItem>
          {events.map((event) => (
            <SelectItem key={event.id} value={event.id}>
              <span className="font-medium">{event.title}</span>
              <span className="text-xs text-muted-foreground ml-2">
                {formatInTimeZone(new Date(event.startAt), PARIS_TIMEZONE, 'PP', { locale: getLocale() })}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
