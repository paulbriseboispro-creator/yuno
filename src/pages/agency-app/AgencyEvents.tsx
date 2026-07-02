import { useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAgency } from '@/hooks/useAgency';
import { useAgencyData, promoterName } from '@/hooks/useAgencyData';
import { useAgencyEvents, AgencyUpcomingEvent } from '@/hooks/useAgencyEvents';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { toast } from 'sonner';
import { Calendar, Users, X, Check } from 'lucide-react';
import {
  PromoCard, PromoButton, PromoEmpty, PromoAvatar, PromoPill, SectionLabel,
  T1, T2, T3, RED, INNER_BG, BORDER,
} from '@/components/promoter/promoter-ui';

const RANGE_OPTIONS = [
  { label: '7j', labelEn: '7d', days: 7 },
  { label: '30j', labelEn: '30d', days: 30 },
  { label: '90j', labelEn: '90d', days: 90 },
];

function formatDate(iso: string, lang: string) {
  return new Date(iso).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB', {
    weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

export default function AgencyEvents() {
  const { agency } = useAgency();
  const { promoters } = useAgencyData(agency?.id ?? null);
  const { language } = useLanguage();
  const tt = (fr: string, en: string) => translate(language, fr, en);
  const [daysAhead, setDaysAhead] = useState(30);
  const { events, loading, refetch } = useAgencyEvents(agency?.id ?? null, daysAhead);
  const [assignSheet, setAssignSheet] = useState<AgencyUpcomingEvent | null>(null);
  const [assigning, setAssigning] = useState<string | null>(null);

  // Group events by venue
  const byVenue = useMemo(() => {
    const map = new Map<string, { label: string; events: AgencyUpcomingEvent[] }>();
    for (const e of events) {
      const key = e.venue_id || e.organizer_user_id || 'other';
      if (!map.has(key)) map.set(key, { label: e.venue_name || tt('Organisateur', 'Organizer'), events: [] });
      map.get(key)!.events.push(e);
    }
    return [...map.values()];
  }, [events, language]);

  const handleAssign = async (promoterId: string, eventId: string, assign: boolean) => {
    setAssigning(promoterId);
    const { error } = await (supabase as any).rpc('assign_agency_promoter_to_event', {
      p_promoter_id: promoterId,
      p_event_id: eventId,
      p_assign: assign,
    });
    setAssigning(null);
    if (error) { toast.error(error.message); return; }
    toast.success(assign ? tt('Assigné', 'Assigned') : tt('Retiré', 'Removed'));
    refetch();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <SectionLabel>{tt('Événements à venir', 'Upcoming events')}</SectionLabel>
        <div className="flex gap-1">
          {RANGE_OPTIONS.map(o => (
            <button
              key={o.days}
              onClick={() => setDaysAhead(o.days)}
              style={{
                padding: '5px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                background: daysAhead === o.days ? INNER_BG : 'transparent',
                border: `1px solid ${daysAhead === o.days ? BORDER : 'rgba(255,255,255,0.08)'}`,
                color: daysAhead === o.days ? T1 : T3,
              }}
            >
              {language === 'fr' ? o.label : o.labelEn}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="py-10 text-center" style={{ color: T3, fontSize: 13 }}>{tt('Chargement…', 'Loading…')}</div>
      ) : events.length === 0 ? (
        <PromoEmpty
          icon={Calendar}
          title={tt('Aucun événement à venir', 'No upcoming events')}
          description={tt(
            'Aucun événement prévu chez vos clubs partenaires dans cette période.',
            'No events scheduled at your partner clubs in this period.'
          )}
        />
      ) : (
        <div className="space-y-4">
          {byVenue.map(({ label, events: clubEvents }) => (
            <div key={label} className="space-y-2">
              <p style={{ color: T3, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {label}
              </p>
              {clubEvents.map(ev => (
                <PromoCard key={ev.event_id} style={{ padding: 12 }}>
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p style={{ color: T1, fontSize: 13.5, fontWeight: 640 }}>{ev.title}</p>
                      <p style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>
                        {formatDate(ev.start_at, language)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-none">
                      {Number(ev.assigned_promoter_count) > 0 && (
                        <PromoPill tone="success">
                          <Users className="h-3 w-3 inline mr-0.5" />
                          {ev.assigned_promoter_count}
                        </PromoPill>
                      )}
                      <PromoButton size="sm" onClick={() => setAssignSheet(ev)}>
                        <Users className="h-3.5 w-3.5" /> {tt('Assigner', 'Assign')}
                      </PromoButton>
                    </div>
                  </div>
                </PromoCard>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Assignment sheet */}
      {assignSheet && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.75)' }}
          onClick={() => setAssignSheet(null)}
        >
          <div
            className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl overflow-hidden"
            style={{ background: '#111', border: `1px solid rgba(255,255,255,0.08)`, maxHeight: '80vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between" style={{ padding: '16px 16px 8px' }}>
              <div>
                <p style={{ color: T1, fontSize: 14, fontWeight: 660 }}>{assignSheet.title}</p>
                <p style={{ color: T3, fontSize: 11.5 }}>{formatDate(assignSheet.start_at, language)}</p>
              </div>
              <button
                onClick={() => setAssignSheet(null)}
                style={{ color: T3, cursor: 'pointer', background: 'none', border: 'none' }}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div style={{ padding: '8px 0 16px' }}>
              {promoters.length === 0 ? (
                <p style={{ color: T3, fontSize: 13, padding: '8px 16px' }}>
                  {tt('Aucun promoteur dans votre agence.', 'No promoters in your agency.')}
                </p>
              ) : (
                promoters.map(p => {
                  const isVenueMatch =
                    (assignSheet.venue_id && p.venue_id === assignSheet.venue_id) ||
                    (assignSheet.organizer_user_id && p.organizer_user_id === assignSheet.organizer_user_id);
                  return (
                    <div
                      key={p.id}
                      className="flex items-center gap-3"
                      style={{
                        padding: '10px 16px',
                        opacity: isVenueMatch ? 1 : 0.5,
                        borderBottom: '1px solid rgba(255,255,255,0.04)',
                      }}
                    >
                      <PromoAvatar src={p.profile_image_url} fallback={promoterName(p).slice(0, 1)} size={34} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate" style={{ color: T1, fontSize: 13.5 }}>{promoterName(p)}</p>
                        <p className="truncate" style={{ color: T3, fontSize: 11 }}>
                          {p.venues?.name || p.venue_id || ''}
                          {!isVenueMatch && ` · ${tt('club différent', 'different club')}`}
                        </p>
                      </div>
                      <PromoButton
                        size="sm"
                        variant={isVenueMatch ? 'secondary' : 'ghost'}
                        onClick={() => handleAssign(p.id, assignSheet.event_id, true)}
                        disabled={assigning === p.id || !isVenueMatch}
                      >
                        {assigning === p.id ? '…' : <Check className="h-3.5 w-3.5" />}
                      </PromoButton>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
