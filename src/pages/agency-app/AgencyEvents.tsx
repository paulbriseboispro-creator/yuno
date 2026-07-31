import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAgency } from '@/hooks/useAgency';
import { useAgencyData, promoterName } from '@/hooks/useAgencyData';
import { useAgencyEvents, AgencyUpcomingEvent } from '@/hooks/useAgencyEvents';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { toast } from 'sonner';
import { Calendar, Users, X, Check, Target, Ticket, Sliders } from 'lucide-react';
import {
  PromoCard, PromoButton, PromoEmpty, PromoAvatar, PromoPill, SectionLabel,
  T1, T2, T3, RED, POS, INNER_BG, BORDER,
} from '@/components/promoter/promoter-ui';

type AssignInfo = { assigned: boolean; goal: string; maxTickets: string; gl: boolean; tables: boolean };

const RANGE_OPTIONS = [
  { label: '7j', labelEn: '7d', labelEs: '7d', days: 7 },
  { label: '30j', labelEn: '30d', labelEs: '30d', days: 30 },
  { label: '90j', labelEn: '90d', labelEs: '90d', days: 90 },
];

function formatDate(iso: string, lang: string) {
  return new Date(iso).toLocaleDateString(lang === 'fr' ? 'fr-FR' : lang === 'es' ? 'es-ES' : 'en-GB', {
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
  // Réglages par soirée (objectif, plafond billets, accès GL/tables) par promoteur.
  const [info, setInfo] = useState<Record<string, AssignInfo>>({});
  const [tuning, setTuning] = useState<string | null>(null);

  const loadAssignments = useCallback(async (eventId: string, ids: string[]) => {
    if (!ids.length) { setInfo({}); return; }
    const { data, error } = await (supabase as any).from('promoter_event_assignments')
      .select('promoter_id, goal_target, max_tickets, can_access_guestlist, can_access_tables')
      .eq('event_id', eventId).in('promoter_id', ids);
    if (error) console.error('event assignments load error:', error);
    const map: Record<string, AssignInfo> = {};
    for (const a of (data ?? []) as any[]) {
      map[a.promoter_id] = {
        assigned: true,
        goal: a.goal_target != null ? String(a.goal_target) : '',
        maxTickets: a.max_tickets != null ? String(a.max_tickets) : '',
        gl: !!a.can_access_guestlist,
        tables: a.can_access_tables !== false,
      };
    }
    setInfo(map);
  }, []);

  useEffect(() => {
    if (assignSheet) loadAssignments(assignSheet.event_id, promoters.map(p => p.id));
    else { setInfo({}); setTuning(null); }
  }, [assignSheet, promoters, loadAssignments]);

  const setField = (pid: string, patch: Partial<AssignInfo>) =>
    setInfo(prev => ({ ...prev, [pid]: { ...(prev[pid] ?? { assigned: true, goal: '', maxTickets: '', gl: false, tables: true }), ...patch } }));

  const saveTuning = async (promoterId: string, eventId: string) => {
    const it = info[promoterId];
    if (!it) return;
    const { error } = await (supabase as any).rpc('set_agency_promoter_event_assignment', {
      p_promoter_id: promoterId,
      p_event_id: eventId,
      p_goal_target: it.goal.trim() === '' ? null : Math.max(0, parseInt(it.goal) || 0),
      p_max_tickets: it.maxTickets.trim() === '' ? null : Math.max(0, parseInt(it.maxTickets) || 0),
      p_can_access_guestlist: it.gl,
      p_can_access_tables: it.tables,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(tt('Réglages enregistrés', 'Settings saved'));
    setField(promoterId, { assigned: true });
    refetch();
  };

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
    await loadAssignments(eventId, promoters.map(p => p.id));
    if (!assign) setTuning(t => t === promoterId ? null : t);
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
              {language === 'fr' ? o.label : language === 'es' ? o.labelEs : o.labelEn}
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
                  // Un promoteur n'est pas en monopole sur son club de
                  // rattachement : on peut l'assigner sur toute soirée des
                  // clubs partenaires — la mention « club différent » reste à
                  // titre d'information.
                  const isVenueMatch =
                    (assignSheet.venue_id && p.venue_id === assignSheet.venue_id) ||
                    (assignSheet.organizer_user_id && p.organizer_user_id === assignSheet.organizer_user_id);
                  const it = info[p.id];
                  const isAssigned = !!it?.assigned;
                  const isTuning = tuning === p.id;
                  return (
                    <div key={p.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <div className="flex items-center gap-3" style={{ padding: '10px 16px' }}>
                        <PromoAvatar src={p.profile_image_url} fallback={promoterName(p).slice(0, 1)} size={34} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate" style={{ color: T1, fontSize: 13.5 }}>{promoterName(p)}</p>
                          <p className="truncate" style={{ color: T3, fontSize: 11 }}>
                            {p.venues?.name || p.venue_id || ''}
                            {!isVenueMatch && ` · ${tt('club différent', 'different club')}`}
                          </p>
                        </div>
                        {isAssigned && (
                          <button onClick={() => setTuning(isTuning ? null : p.id)} title={tt('Réglages soirée', 'Event settings')}
                            style={{ color: isTuning ? RED : T3, background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
                            <Sliders className="h-4 w-4" />
                          </button>
                        )}
                        <PromoButton
                          size="sm"
                          variant={isAssigned ? 'secondary' : (isVenueMatch ? 'secondary' : 'ghost')}
                          onClick={() => handleAssign(p.id, assignSheet.event_id, !isAssigned)}
                          disabled={assigning === p.id}
                        >
                          {assigning === p.id ? '…' : isAssigned ? <X className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                        </PromoButton>
                      </div>

                      {isAssigned && isTuning && (
                        <div style={{ padding: '4px 16px 12px 62px' }} className="space-y-2">
                          <div className="flex items-center gap-2">
                            <Target className="h-3.5 w-3.5" style={{ color: T3 }} />
                            <input type="number" min={0} value={it.goal} onChange={e => setField(p.id, { goal: e.target.value })}
                              placeholder={tt('Objectif ventes', 'Sales goal')} className="outline-none"
                              style={{ width: 120, background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '6px 9px', color: T1, fontSize: 12.5 }} />
                            <Ticket className="h-3.5 w-3.5" style={{ color: T3 }} />
                            <input type="number" min={0} value={it.maxTickets} onChange={e => setField(p.id, { maxTickets: e.target.value })}
                              placeholder={tt('Plafond billets', 'Ticket cap')} className="outline-none"
                              style={{ width: 120, background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '6px 9px', color: T1, fontSize: 12.5 }} />
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <button onClick={() => setField(p.id, { gl: !it.gl })} style={{ padding: '5px 10px', borderRadius: 8, fontSize: 11.5, cursor: 'pointer', background: it.gl ? 'rgba(52,211,153,0.12)' : INNER_BG, color: it.gl ? POS : T2, border: `1px solid ${it.gl ? 'rgba(52,211,153,0.3)' : BORDER}` }}>
                              {tt('Accès guest list', 'Guest list access')} {it.gl ? '✓' : '✗'}
                            </button>
                            <button onClick={() => setField(p.id, { tables: !it.tables })} style={{ padding: '5px 10px', borderRadius: 8, fontSize: 11.5, cursor: 'pointer', background: it.tables ? 'rgba(52,211,153,0.12)' : INNER_BG, color: it.tables ? POS : T2, border: `1px solid ${it.tables ? 'rgba(52,211,153,0.3)' : BORDER}` }}>
                              {tt('Accès tables', 'Tables access')} {it.tables ? '✓' : '✗'}
                            </button>
                            <PromoButton size="sm" onClick={() => saveTuning(p.id, assignSheet.event_id)}>{tt('Enregistrer', 'Save')}</PromoButton>
                          </div>
                        </div>
                      )}
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
