import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { format } from 'date-fns';
import { fr, enUS, es } from 'date-fns/locale';
import { Handshake, Clock, Building2, ArrowRight, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import {
  OrgPage, OrgPageHeader, OrgCard, OrgPill, OrgSectionLabel, OrgEmptyState,
  T1, T2, T3, BORDER, INNER_BG,
} from '@/components/org-ui';
import { OrgPendingProposals } from '@/components/organizer-app/OrgPendingProposals';
import { CollabActionControls } from '@/components/collab/CollabActionControls';

const dateFnsLocale = (lng: string) => (lng === 'fr' ? fr : lng === 'es' ? es : enUS);

interface CoEvent {
  id: string;
  title: string;
  poster_url: string | null;
  start_at: string;
  end_at: string;
  is_active: boolean;
  collab_paused_at: string | null;
  clubName: string;
  contractStatus: string | null;
}

/**
 * Organizer collaborations hub — parity with the club's /owner/collaborations.
 * Two zones: incoming co-event proposals to accept/decline (OrgPendingProposals)
 * and the organizer's active co-events, each with the double-consent pause/delete
 * controls. Before this page, an organizer had no persistent surface for co-events
 * sent by Yuno clubs — only a transient dashboard banner — and no notification.
 */
export default function OrgAppCollaborations() {
  const { user } = useAuth();
  const { language } = useLanguage();
  const t = (frTxt: string, en: string, esTxt?: string) => translate(language, frTxt, en, esTxt);
  const [events, setEvents] = useState<CoEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPast, setShowPast] = useState(false);

  const load = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    const { data, error } = await supabase
      .from('events')
      .select('id, title, poster_url, start_at, end_at, is_active, organizer_user_id, partner_organizer_id, venue_id, partner_venue_id, collab_paused_at')
      .or(`partner_organizer_id.eq.${user.id},and(organizer_user_id.eq.${user.id},partner_venue_id.not.is.null)`)
      .order('start_at', { ascending: false });
    if (error) { console.error(error); setLoading(false); return; }

    const rows = data || [];
    const venueIds = Array.from(new Set(rows.map((e) => e.venue_id ?? e.partner_venue_id).filter(Boolean) as string[]));
    const eventIds = rows.map((e) => e.id);
    const [{ data: venues }, { data: contracts }] = await Promise.all([
      venueIds.length ? supabase.from('venues').select('id, name').in('id', venueIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      eventIds.length
        ? supabase.from('event_collab_contracts' as never).select('event_id, status').in('event_id' as never, eventIds as never)
        : Promise.resolve({ data: [] }),
    ]);
    const vMap = new Map((venues as { id: string; name: string }[] | null || []).map((v) => [v.id, v.name]));
    const cMap = new Map(((contracts as unknown as { event_id: string; status: string }[]) || []).map((c) => [c.event_id, c.status]));

    setEvents(rows.map((e): CoEvent => ({
      id: e.id, title: e.title, poster_url: e.poster_url, start_at: e.start_at, end_at: e.end_at,
      is_active: e.is_active, collab_paused_at: e.collab_paused_at,
      clubName: vMap.get((e.venue_id ?? e.partner_venue_id) as string) || t('Un club', 'A club', 'Un club'),
      contractStatus: cMap.get(e.id) ?? null,
    })));
    setLoading(false);
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
    if (!user) return;
    const ch = supabase
      .channel(`org-collab-hub-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events', filter: `partner_organizer_id=eq.${user.id}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events', filter: `organizer_user_id=eq.${user.id}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, load]);

  const now = Date.now();
  const upcoming = events.filter((e) => new Date(e.end_at).getTime() >= now);
  const past = events.filter((e) => new Date(e.end_at).getTime() < now);

  return (
    <OrgPage className="mx-auto max-w-[1340px]">
      <OrgPageHeader
        title={t('Collaborations', 'Collaborations', 'Colaboraciones')}
        subtitle={t(
          'Les soirées co-organisées avec des clubs Yuno : propositions reçues et co-soirées en cours.',
          'Events co-hosted with Yuno clubs: incoming proposals and active co-events.',
          'Eventos coorganizados con clubes Yuno: propuestas recibidas y coeventos activos.',
        )}
      />

      <div className="space-y-6">
        {/* Incoming proposals to accept/decline */}
        <OrgPendingProposals />

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" style={{ color: T3 }} /></div>
        ) : events.length === 0 ? (
          <OrgEmptyState
            icon={Handshake}
            title={t('Aucune co-soirée pour le moment.', 'No co-events yet.', 'Aún no hay coeventos.')}
            description={t(
              'Quand un club Yuno te propose de co-organiser une soirée, elle apparaît ici. Tu peux aussi proposer un partenariat depuis « Clubs partenaires ».',
              'When a Yuno club proposes to co-host an event, it shows up here. You can also request a partnership from “Partner clubs”.',
              'Cuando un club Yuno te propone coorganizar un evento, aparece aquí. También puedes solicitar un partenariado desde “Clubes asociados”.',
            )}
          />
        ) : (
          <>
            <section>
              <div className="mb-3"><OrgSectionLabel>{t('Co-soirées', 'Co-events', 'Coeventos')} ({upcoming.length})</OrgSectionLabel></div>
              {upcoming.length === 0 ? (
                <OrgEmptyState icon={Handshake} title={t('Aucune co-soirée à venir.', 'No upcoming co-events.', 'No hay coeventos próximos.')} />
              ) : (
                <div className="grid gap-3">
                  {upcoming.map((e) => <CoEventCard key={e.id} event={e} onChanged={load} />)}
                </div>
              )}
            </section>

            {past.length > 0 && (
              <section>
                <button
                  onClick={() => setShowPast(!showPast)}
                  className="flex w-full items-center justify-between"
                  style={{ padding: '10px 16px', borderRadius: 12, background: INNER_BG, border: `1px solid ${BORDER}`, color: T2, fontSize: 13 }}
                >
                  <span className="flex items-center gap-2">
                    <Clock className="h-4 w-4" style={{ color: T3 }} />
                    {t('Co-soirées passées', 'Past co-events', 'Coeventos pasados')}
                    <span style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 6, padding: '1px 8px', fontSize: 11, color: T3 }}>{past.length}</span>
                  </span>
                  {showPast ? <ChevronUp className="h-4 w-4" style={{ color: T3 }} /> : <ChevronDown className="h-4 w-4" style={{ color: T3 }} />}
                </button>
                {showPast && (
                  <div className="mt-3 grid gap-3" style={{ opacity: 0.7 }}>
                    {past.map((e) => <CoEventCard key={e.id} event={e} onChanged={load} />)}
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </OrgPage>
  );
}

function CoEventCard({ event, onChanged }: { event: CoEvent; onChanged: () => void }) {
  const { language } = useLanguage();
  const t = (frTxt: string, en: string, esTxt?: string) => translate(language, frTxt, en, esTxt);
  const cs = event.contractStatus;
  const accepted = cs === 'active' || cs === 'locked' || cs === 'closed';
  const awaiting = cs === 'pending_signatures';
  const isPaused = !!event.collab_paused_at;

  const statusPill = isPaused
    ? { tone: 'warn' as const, label: t('En pause', 'Paused', 'En pausa') }
    : accepted
      ? { tone: 'success' as const, label: t('Active', 'Active', 'Activa') }
      : awaiting
        ? { tone: 'warn' as const, label: t('À valider', 'To review', 'Por revisar') }
        : { tone: 'muted' as const, label: t('En préparation', 'Draft', 'Borrador') };

  return (
    <OrgCard>
      <div className="flex items-start gap-4 p-4">
        {event.poster_url ? (
          <img src={event.poster_url} alt="" className="h-16 w-12 flex-none rounded-lg object-cover" style={{ border: `1px solid ${BORDER}` }} />
        ) : (
          <div className="flex h-16 w-12 flex-none items-center justify-center rounded-lg" style={{ background: INNER_BG }}>
            <Building2 className="h-5 w-5" style={{ color: T3 }} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate" style={{ color: T1, fontSize: 14.5, fontWeight: 600 }}>{event.title}</h3>
            <OrgPill tone={statusPill.tone}>{statusPill.label}</OrgPill>
          </div>
          <p className="mt-0.5" style={{ color: T2, fontSize: 12 }}>{t('Avec', 'With', 'Con')} {event.clubName}</p>
          <p className="mt-1 flex items-center gap-1.5" style={{ color: T3, fontSize: 11 }}>
            <Clock className="h-3 w-3" />{format(new Date(event.start_at), 'd MMM yyyy · HH:mm', { locale: dateFnsLocale(language) })}
          </p>

          <div className="mt-3">
            <CollabActionControls eventId={event.id} myRole="organizer" isPaused={isPaused} onChanged={onChanged} />
          </div>
        </div>

        <Link
          to={`/organizer-app/events/${event.id}`}
          className="inline-flex flex-none items-center gap-1 self-start rounded-lg px-3 py-2"
          style={{ background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.30)', color: '#FF5C63', fontSize: 12, fontWeight: 600, textDecoration: 'none' }}
        >
          {t('Ouvrir', 'Open', 'Abrir')} <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </OrgCard>
  );
}
