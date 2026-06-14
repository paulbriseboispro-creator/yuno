import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { useAuth } from '@/hooks/useAuth';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { EventLiveModule } from '@/components/owner/co-event/EventLiveModule';
import { LiveVisitorsPanel } from '@/components/live/LiveVisitorsPanel';
import { OrgPage, POS, T1, T3 } from '@/components/org-ui';

export default function OrgAppEventLive() {
  const { eventId } = useParams<{ eventId: string }>();
  const { language } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [event, setEvent] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const t = (fr: string, en: string, es?: string) => translate(language, fr, en, es);

  useEffect(() => {
    if (!eventId) return;
    supabase
      .from('events')
      .select('id, title, venue_id, partner_venue_id, organizer_user_id, partner_organizer_id')
      .eq('id', eventId)
      .maybeSingle()
      .then(({ data }) => {
        setEvent(data);
        setLoading(false);
      });
  }, [eventId]);

  if (loading || !event) {
    return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin" style={{ color: T3 }} /></div>;
  }

  const venueIdForLive = event.venue_id || event.partner_venue_id || null;

  return (
    <OrgPage className="mx-auto max-w-7xl">
      <div className="mb-4 flex items-center justify-between">
        <button onClick={() => navigate(`/organizer-app/events/${eventId}`)} className="inline-flex items-center gap-1 text-[13px]" style={{ color: T3 }}>
          <ArrowLeft className="h-4 w-4" /> {t('Retour', 'Back')}
        </button>
        <div className="flex items-center gap-2" style={{ color: T3, fontSize: 13 }}>
          <span className="h-2 w-2 animate-pulse rounded-full" style={{ background: POS }} />
          {t('En direct', 'Live')}
        </div>
      </div>

      <header className="mb-6">
        <h1 style={{ color: T1, fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em' }}>{event.title}</h1>
        <p className="mt-1" style={{ color: T3, fontSize: 13 }}>
          {t('Vue temps réel — données filtrées sur cette soirée', 'Real-time view — filtered to this event')}
        </p>
      </header>

      <div className="space-y-6">
        <EventLiveModule eventId={event.id} venueId={venueIdForLive} />
        <LiveVisitorsPanel organizerUserId={user?.id || event.organizer_user_id} eventId={event.id} hasAccess={true} />
      </div>
    </OrgPage>
  );
}
