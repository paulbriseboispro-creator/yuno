import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { Calendar, MapPin, Sparkles, ArrowRight, Heart } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface SuggestedEventsProps {
  userId: string;
  tasteProfile?: {
    music_style: string;
    drink_preference: string;
    vibe_preference: string;
    crowd_size: string;
    night_type: string;
  } | null;
  favoriteClubId?: string | null;
}

interface Event {
  id: string;
  title: string;
  start_at: string;
  poster_url: string | null;
  venue_id: string;
  venue_name: string;
  venue_logo: string | null;
  match_reason: string;
}

export function SuggestedEvents({ userId, tasteProfile, favoriteClubId }: SuggestedEventsProps) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSuggestedEvents();
  }, [userId, tasteProfile, favoriteClubId]);

  const fetchSuggestedEvents = async () => {
    try {
      // Get upcoming events
      const { data: eventsData } = await supabase
        .from('events')
        .select(`
          id,
          title,
          start_at,
          poster_url,
          venue_id,
          description,
          venues:venue_id (
            name,
            logo_url
          )
        `)
        .gt('start_at', new Date().toISOString())
        .order('start_at')
        .limit(10);

      if (!eventsData) {
        setEvents([]);
        return;
      }

      // Score and sort events based on user preferences
      const scoredEvents = eventsData.map((event) => {
        const venue = event.venues as unknown as { name: string; logo_url: string | null };
        let score = 0;
        let matchReason = 'suggestions.popular';

        // Match by favorite club
        if (favoriteClubId && event.venue_id === favoriteClubId) {
          score += 50;
          matchReason = 'suggestions.yourClub';
        }

        // Match by keywords in title/description if taste profile exists
        if (tasteProfile && event.description) {
          const genreMap: Record<string, string[]> = {
            electronic: ['techno', 'house', 'edm', 'electronic', 'trance', 'dj'],
            hiphop: ['hiphop', 'hip-hop', 'rap', 'rnb', 'r&b', 'urban'],
            latin: ['reggaeton', 'latin', 'salsa', 'bachata', 'latino'],
            pop: ['pop', 'top40', 'mainstream', 'charts'],
          };

          const userGenres = genreMap[tasteProfile.music_style] || [];
          const eventText = `${event.title} ${event.description}`.toLowerCase();
          
          if (userGenres.some(g => eventText.includes(g))) {
            score += 30;
            matchReason = 'suggestions.yourStyle';
          }
        }

        return {
          id: event.id,
          title: event.title,
          start_at: event.start_at,
          poster_url: event.poster_url,
          venue_id: event.venue_id,
          venue_name: venue?.name || 'Unknown Venue',
          venue_logo: venue?.logo_url || null,
          match_reason: matchReason,
          score,
        };
      });

      // Sort by score and take top 3
      const topEvents = scoredEvents
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

      setEvents(topEvents);
    } catch (error) {
      console.error('Error fetching suggested events:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Card className="border-border/50">
        <CardContent className="p-6">
          <div className="animate-pulse space-y-3">
            <div className="h-4 bg-muted rounded w-1/3" />
            <div className="h-20 bg-muted rounded" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (events.length === 0) return null;

  return (
    <Card className="border-border/50 overflow-hidden">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <span className="text-xl">🎯</span>
          {t('suggestions.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {events.map((event, index) => (
          <motion.div
            key={event.id}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.1 }}
            onClick={() => navigate(`/event/${event.id}`)}
            className="group relative flex gap-3 p-3 rounded-xl bg-card/50 border border-border/30 hover:border-primary/30 hover:bg-card cursor-pointer transition-all"
          >
            {/* Event Image */}
            <div className="relative h-16 w-16 rounded-lg overflow-hidden flex-shrink-0">
              {event.poster_url ? (
                <img
                  src={event.poster_url}
                  alt={event.title}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="h-full w-full bg-gradient-to-br from-primary/30 to-accent/30 flex items-center justify-center">
                  <Calendar className="h-6 w-6 text-primary/50" />
                </div>
              )}
              {/* Match badge */}
              <div className="absolute -top-1 -right-1 p-1 bg-primary rounded-full">
                <Sparkles className="h-3 w-3 text-primary-foreground" />
              </div>
            </div>

            {/* Event Info */}
            <div className="flex-1 min-w-0">
              <p className="text-xs text-primary font-medium flex items-center gap-1">
                <Sparkles className="h-3 w-3" />
                {t(event.match_reason)}
              </p>
              <h4 className="font-semibold text-foreground truncate group-hover:text-primary transition-colors">
                {event.title}
              </h4>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {format(new Date(event.start_at), 'MMM d')}
                </span>
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {event.venue_name}
                </span>
              </div>
            </div>

            {/* Arrow */}
            <div className="flex items-center">
              <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
            </div>
          </motion.div>
        ))}

        {/* See all button */}
        <Button
          variant="ghost"
          className="w-full text-primary hover:text-primary/80"
          onClick={() => navigate('/')}
        >
          {t('suggestions.seeAll')}
          <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </CardContent>
    </Card>
  );
}
