import { useState, useEffect } from 'react';
import { Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { Event } from '@/types';
import { format } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { fr } from 'date-fns/locale';
import { PARIS_TIMEZONE, nowInParis } from '@/lib/timezone';

interface EventSelectorProps {
  selectedEventId: string | null;
  onEventSelect: (eventId: string) => void;
  venueId: string;
}

export function EventSelector({ selectedEventId, onEventSelect, venueId }: EventSelectorProps) {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchEvents = async () => {
      try {
        const now = nowInParis().toISOString();
        const { data, error } = await supabase
          .from('events')
          .select('*')
          .eq('venue_id', venueId)
          .eq('is_active', true)
          .gte('end_at', now)
          .order('start_at', { ascending: true });

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
      } catch (error) {
        console.error('Error fetching events:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchEvents();

    // Realtime subscription
    const channel = supabase
      .channel('events-changes')
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
  }, [venueId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Calendar className="h-4 w-4" />
        Chargement des événements...
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Calendar className="h-4 w-4" />
        Aucun événement disponible
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Calendar className="h-4 w-4 text-primary" />
      <Select value={selectedEventId || ''} onValueChange={onEventSelect}>
        <SelectTrigger className="w-[280px]">
          <SelectValue placeholder="Choisir une soirée" />
        </SelectTrigger>
        <SelectContent>
          {events.map((event) => (
            <SelectItem key={event.id} value={event.id}>
              <div className="flex flex-col">
                <span className="font-medium">{event.title}</span>
                <span className="text-xs text-muted-foreground">
                  {formatInTimeZone(new Date(event.startAt), PARIS_TIMEZONE, 'PPp', { locale: fr })} -{' '}
                  {formatInTimeZone(new Date(event.endAt), PARIS_TIMEZONE, 'p', { locale: fr })}
                </span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
