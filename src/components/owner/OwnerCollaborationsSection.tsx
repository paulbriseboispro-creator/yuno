import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, Clock, Handshake, ExternalLink, Eye, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatInTimeZone } from 'date-fns-tz';
import { fr } from 'date-fns/locale';
import { PARIS_TIMEZONE, toParisTime, nowInParis } from '@/lib/timezone';
import { PurchaseSourceBreakdown } from '@/components/analytics/PurchaseSourceBreakdown';
import { useLanguage } from '@/contexts/LanguageContext';

interface CollabEvent {
  id: string;
  title: string;
  description: string | null;
  poster_url: string | null;
  start_at: string;
  end_at: string;
  is_active: boolean;
  organizer_user_id: string;
  organizer: {
    display_name: string | null;
    avatar_url: string | null;
    slug: string | null;
  } | null;
}

interface Props {
  venueId: string;
}

/**
 * Read-only list of events this venue is hosting as the partner_venue
 * for an organizer. Editing remains the organizer's responsibility.
 */
export function OwnerCollaborationsSection({ venueId }: Props) {
  const { t } = useLanguage();
  const [events, setEvents] = useState<CollabEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPast, setShowPast] = useState(false);

  useEffect(() => {
    if (!venueId) return;

    const fetchCollabs = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('events')
        .select('id, title, description, poster_url, start_at, end_at, is_active, organizer_user_id')
        .eq('partner_venue_id', venueId)
        .not('organizer_user_id', 'is', null)
        .order('start_at', { ascending: false });

      if (error) {
        console.error('Error loading collab events:', error);
        setLoading(false);
        return;
      }

      const organizerIds = Array.from(
        new Set((data || []).map((e) => e.organizer_user_id).filter(Boolean) as string[])
      );

      let organizerMap = new Map<
        string,
        { display_name: string | null; avatar_url: string | null; slug: string | null }
      >();

      if (organizerIds.length > 0) {
        const { data: orgProfiles } = await supabase
          .from('organizer_profiles' as any)
          .select('user_id, display_name, avatar_url, slug')
          .in('user_id', organizerIds);

        (orgProfiles || []).forEach((p: any) => {
          organizerMap.set(p.user_id, {
            display_name: p.display_name,
            avatar_url: p.avatar_url,
            slug: p.slug,
          });
        });
      }

      const mapped: CollabEvent[] = (data || []).map((e) => ({
        id: e.id,
        title: e.title,
        description: e.description,
        poster_url: e.poster_url,
        start_at: e.start_at,
        end_at: e.end_at,
        is_active: e.is_active,
        organizer_user_id: e.organizer_user_id as string,
        organizer: organizerMap.get(e.organizer_user_id as string) ?? null,
      }));

      setEvents(mapped);
      setLoading(false);
    };

    fetchCollabs();

    const channel = supabase
      .channel(`collab-events-${venueId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'events',
          filter: `partner_venue_id=eq.${venueId}`,
        },
        () => fetchCollabs()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [venueId]);

  const upcoming = events.filter((e) => toParisTime(e.end_at) >= nowInParis());
  const past = events.filter((e) => toParisTime(e.end_at) < nowInParis());

  if (loading) {
    return (
      <div className="mt-8 space-y-3">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-28 w-full rounded-xl" />
      </div>
    );
  }

  if (events.length === 0) return null;

  const renderCard = (event: CollabEvent, dim = false) => (
    <Card key={event.id} className={`owner-card border-0 ${dim ? 'opacity-60' : ''}`}>
      <CardHeader className="p-4 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <Badge variant="outline" className="gap-1 border-primary/30 text-primary">
                <Handshake className="h-3 w-3" />
                {t('collab.section.badge')}
              </Badge>
              {event.is_active && (
                <Badge variant="success">{t('collab.section.active')}</Badge>
              )}
            </div>
            <CardTitle className="text-base sm:text-lg truncate">{event.title}</CardTitle>
            {event.organizer && (
              <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                {t('collab.section.organizedBy')}{' '}
                {event.organizer.slug ? (
                  <Link
                    to={`/o/${event.organizer.slug}`}
                    className="text-primary hover:underline inline-flex items-center gap-1"
                  >
                    {event.organizer.display_name || t('collab.organizer')}
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                ) : (
                  <span className="text-foreground">{event.organizer.display_name || t('collab.organizer')}</span>
                )}
              </p>
            )}
            <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 text-xs sm:text-sm text-muted-foreground mt-2">
              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" />
                <span className="truncate">
                  {formatInTimeZone(new Date(event.start_at), PARIS_TIMEZONE, 'dd MMM yyyy', { locale: fr })}
                </span>
              </div>
              <span className="whitespace-nowrap">
                {formatInTimeZone(new Date(event.start_at), PARIS_TIMEZONE, 'HH:mm')} -{' '}
                {formatInTimeZone(new Date(event.end_at), PARIS_TIMEZONE, 'HH:mm')}
              </span>
            </div>
          </div>
          {event.poster_url && (
            <img
              src={event.poster_url}
              alt={event.title}
              className="w-16 h-20 sm:w-20 sm:h-28 rounded-lg object-cover flex-shrink-0"
            />
          )}
        </div>
      </CardHeader>
      <CardContent className="p-4 sm:p-6 pt-0 sm:pt-0">
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm" className="text-xs sm:text-sm">
            <Link to={`/event/${event.id}`}>
              <Eye className="h-3 w-3 sm:h-4 sm:w-4 sm:mr-2" />
              <span className="hidden sm:inline">{t('collab.section.viewEvent')}</span>
            </Link>
          </Button>
          <p className="text-[11px] text-muted-foreground self-center ml-auto italic">
            {t('collab.section.readOnly')}
          </p>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="mt-8 sm:mt-10">
      <div className="flex items-center gap-2 mb-3 sm:mb-4">
        <Handshake className="h-5 w-5 text-primary" />
        <h2 className="text-xl sm:text-2xl font-bold">{t('collab.section.title')}</h2>
        <Badge variant="secondary">{events.length}</Badge>
      </div>
      <p className="text-xs sm:text-sm text-muted-foreground mb-4">
        {t('collab.section.desc')}
      </p>

      {upcoming.length > 0 && (
        <div className="grid gap-3 sm:gap-4 mb-6">
          {upcoming.map((e) => (
            <div key={e.id} className="space-y-3">
              {renderCard(e)}
              <PurchaseSourceBreakdown eventId={e.id} />
            </div>
          ))}
        </div>
      )}

      {past.length > 0 && (
        <div>
          <Button
            variant="ghost"
            className="w-full flex items-center justify-between p-3 h-auto mb-3"
            onClick={() => setShowPast(!showPast)}
          >
            <div className="flex items-center gap-2">
              <h3 className="text-base sm:text-lg font-semibold">{t('collab.section.pastTitle')}</h3>
              <Badge variant="secondary">{past.length}</Badge>
            </div>
            {showPast ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
          </Button>
          {showPast && <div className="grid gap-3 sm:gap-4">{past.map((e) => renderCard(e, true))}</div>}
        </div>
      )}
    </div>
  );
}
