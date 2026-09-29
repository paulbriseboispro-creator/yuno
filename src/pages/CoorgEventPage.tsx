import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { format } from 'date-fns';
import { fr, enUS, es } from 'date-fns/locale';
import { ArrowLeft, Handshake } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { OwnerHeader } from '@/components/OwnerHeader';
import { PRO_PAGE } from '@/lib/proLayout';
import { OrgPage, RED, T1, T3 } from '@/components/org-ui';
import { useVenueContext } from '@/hooks/useVenueContext';
import { useDashboardMode } from '@/contexts/DashboardModeContext';
import { CoorgEventPanel } from '@/components/coorg/CoorgEventPanel';
import { useCoorgT } from '@/components/coorg/coorgUi';

/**
 * /owner/coorg/:eventId et /organizer-app/coorg/:eventId — la co-organisation
 * d'une soirée. Une seule page pour toutes les parties : c'est la RPC qui
 * décide ce que l'appelant voit et peut faire.
 */
export default function CoorgEventPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const { t, language } = useCoorgT();
  const { scope } = useVenueContext();
  const { basePath } = useDashboardMode();
  const [event, setEvent] = useState<{ title: string; start_at: string; poster_url: string | null } | null>(null);
  const isOrg = scope === 'organizer';

  useEffect(() => {
    if (!eventId) return;
    supabase.from('events').select('title, start_at, poster_url').eq('id', eventId).maybeSingle()
      .then(({ data }) => setEvent(data as typeof event));
  }, [eventId]);

  const back = `${basePath}/collaborations?tab=nights`;
  const title = t('Co-organisation', 'Co-organization', 'Coorganización');

  return (
    <>
      {!isOrg && <OwnerHeader title={title} backTo={back} />}
      <OrgPage className={`${PRO_PAGE} pt-4`}>
        {isOrg && (
          <Link to={back} className="mb-3 inline-flex items-center gap-1.5" style={{ color: T3, fontSize: 12.5 }}>
            <ArrowLeft className="h-3.5 w-3.5" /> {t('Collaborations', 'Collaborations', 'Colaboraciones')}
          </Link>
        )}
        <div className="mb-4 flex items-center gap-3">
          {event?.poster_url
            ? <img src={event.poster_url} alt="" className="h-16 w-12 flex-none rounded-lg object-cover" />
            : <Handshake className="h-6 w-6" style={{ color: RED }} />}
          <div className="min-w-0">
            <p style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}>{title}</p>
            <h1 className="truncate" style={{ color: T1, fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>{event?.title ?? '…'}</h1>
            {event && (
              <p style={{ color: T3, fontSize: 12.5 }}>
                {format(new Date(event.start_at), 'EEEE d MMMM yyyy · HH:mm', { locale: language === 'fr' ? fr : language === 'es' ? es : enUS })}
              </p>
            )}
          </div>
        </div>
        {eventId && <CoorgEventPanel eventId={eventId} />}
      </OrgPage>
    </>
  );
}
