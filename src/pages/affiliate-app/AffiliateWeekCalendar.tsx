import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { format, addDays, startOfDay, isToday, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { CheckCircle, Pencil, FileText, AlertTriangle } from 'lucide-react';
import {
  AffPage, AffHeading, AffSpinner,
  RED, POS, WARN, T1, T2, T3, BORDER, F_BORDER, C_FAINT, CARD_BG, CARD_SHADOW,
} from '@/components/affiliate/affiliate-ui';

type EventRow = {
  id: string;
  name: string;
  event_date: string;
  status: string;
  is_sold_out: boolean;
  external_ticket_url: string | null;
  flyer_url: string | null;
};

type DayStatus = 'soldout' | 'missing_url' | 'ok' | 'draft';

function getDayStatus(ev: EventRow): DayStatus {
  if (ev.is_sold_out) return 'soldout';
  if (ev.status === 'draft') return 'draft';
  if (!ev.external_ticket_url) return 'missing_url';
  return 'ok';
}

const STATUS_STYLE: Record<DayStatus, { dot: string; label: string }> = {
  ok:          { dot: POS, label: 'Publié' },
  missing_url: { dot: WARN, label: 'URL manquante' },
  soldout:     { dot: RED, label: 'Complet' },
  draft:       { dot: T3, label: 'Brouillon' },
};

export default function AffiliateWeekCalendar() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);

  const today = startOfDay(new Date());
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));

  useEffect(() => {
    if (user) init();
  }, [user]);

  const init = async () => {
    const { data: aff } = await supabase.from('affiliates').select('id').eq('user_id', user!.id).single();
    if (!aff) { setLoading(false); return; }
    await fetchEvents(aff.id);
  };

  const fetchEvents = async (affId: string) => {
    setLoading(true);
    const from = format(today, 'yyyy-MM-dd');
    const to = format(addDays(today, 6), 'yyyy-MM-dd');
    const { data } = await supabase
      .from('affiliate_events')
      .select('id, name, event_date, status, is_sold_out, external_ticket_url, flyer_url')
      .eq('affiliate_id', affId)
      .gte('event_date', from)
      .lte('event_date', to)
      .order('event_date');
    setEvents(data ?? []);
    setLoading(false);
  };

  const toggleSoldOut = async (id: string, current: boolean) => {
    const { error } = await supabase.from('affiliate_events').update({ is_sold_out: !current }).eq('id', id);
    if (error) { toast({ title: 'Erreur', description: error.message, variant: 'destructive' }); return; }
    setEvents(prev => prev.map(e => e.id === id ? { ...e, is_sold_out: !current } : e));
    toast({ title: current ? 'Soirée remise en vente' : 'Marquée comme complète' });
  };

  const eventsForDay = (dateStr: string) => events.filter(e => e.event_date === dateStr);

  if (loading) return <AffSpinner />;

  return (
    <AffPage>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <AffHeading
          title="Cette semaine"
          subtitle={`Vue 7 jours — ${format(today, 'd MMM', { locale: fr })} → ${format(addDays(today, 6), 'd MMM yyyy', { locale: fr })}`}
        />
      </motion.div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4">
        {Object.values(STATUS_STYLE).map((s) => (
          <div key={s.label} className="flex items-center gap-1.5">
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.dot, display: 'inline-block' }} />
            <span style={{ fontSize: 11.5, color: T3 }}>{s.label}</span>
          </div>
        ))}
      </div>

      {/* Days */}
      <div className="space-y-3">
        {days.map((day, di) => {
          const dateStr = format(day, 'yyyy-MM-dd');
          const dayEvents = eventsForDay(dateStr);
          const dayLabel = format(day, 'EEEE d MMMM', { locale: fr });
          const isNow = isToday(day);

          return (
            <motion.div key={dateStr}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(di * 0.04, 0.3) }}
              className="rounded-2xl overflow-hidden"
              style={{
                background: isNow
                  ? 'radial-gradient(ellipse 70% 60% at 90% -20%, rgba(232,25,44,0.07) 0%, transparent 65%),' + CARD_BG
                  : CARD_BG,
                border: `1px solid ${isNow ? 'rgba(232,25,44,0.28)' : BORDER}`,
                boxShadow: CARD_SHADOW,
              }}>
              {/* Day header */}
              <div className="px-4 py-2.5 flex items-center justify-between"
                style={{ borderBottom: dayEvents.length > 0 ? `1px solid ${F_BORDER}` : 'none', background: isNow ? 'rgba(232,25,44,0.06)' : 'rgba(255,255,255,0.02)' }}>
                <span className="capitalize" style={{ fontSize: 13.5, fontWeight: 600, color: isNow ? RED : T2 }}>
                  {dayLabel}
                  {isNow && <span style={{ marginLeft: 8, fontSize: 11, color: 'rgba(232,25,44,0.75)' }}>Aujourd'hui</span>}
                </span>
                <span style={{ fontSize: 11, color: T3 }}>{dayEvents.length} soirée{dayEvents.length !== 1 ? 's' : ''}</span>
              </div>

              {/* Events */}
              {dayEvents.length === 0 ? (
                <div className="px-4 py-3" style={{ fontSize: 11.5, color: T3, fontStyle: 'italic' }}>Aucune soirée planifiée</div>
              ) : (
                <div className="divide-y" style={{ borderColor: F_BORDER }}>
                  {dayEvents.map(ev => {
                    const status = getDayStatus(ev);
                    const style = STATUS_STYLE[status];
                    return (
                      <div key={ev.id} style={{ borderLeft: `3px solid ${style.dot}` }}
                        className="flex items-center gap-3 px-4 py-3 transition-colors"
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                        {/* Flyer */}
                        <div className="w-9 h-9 rounded-lg overflow-hidden flex-none flex items-center justify-center" style={{ background: C_FAINT, border: `1px solid ${BORDER}` }}>
                          {ev.flyer_url ? (
                            <img src={ev.flyer_url} alt={ev.name} className="w-full h-full object-cover" />
                          ) : (
                            <span className="tabular-nums" style={{ color: T3, fontSize: 12, fontWeight: 700 }}>{format(parseISO(ev.event_date), 'd')}</span>
                          )}
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <p className="truncate" style={{ color: T1, fontSize: 13, fontWeight: 560 }}>{ev.name}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: style.dot, display: 'inline-block' }} />
                            <span style={{ fontSize: 11, color: T3 }}>{style.label}</span>
                          </div>
                        </div>

                        {status === 'missing_url' && <AlertTriangle className="h-3.5 w-3.5 flex-none" style={{ color: WARN }} />}

                        {/* Actions */}
                        <div className="flex items-center gap-1 flex-none">
                          <button onClick={() => toggleSoldOut(ev.id, ev.is_sold_out)}
                            title={ev.is_sold_out ? 'Remettre en vente' : 'Marquer complet'}
                            className="p-1.5 transition-colors" style={{ color: ev.is_sold_out ? RED : T3 }}
                            onMouseEnter={(e) => (e.currentTarget.style.color = RED)} onMouseLeave={(e) => (e.currentTarget.style.color = ev.is_sold_out ? RED : T3)}>
                            <CheckCircle className="h-3.5 w-3.5" />
                          </button>
                          <Link to={`/affiliate/events/${ev.id}/brief`} title="Brief"
                            className="p-1.5 transition-colors" style={{ color: T3 }}
                            onMouseEnter={(e) => (e.currentTarget.style.color = RED)} onMouseLeave={(e) => (e.currentTarget.style.color = T3)}>
                            <FileText className="h-3.5 w-3.5" />
                          </Link>
                          <Link to={`/affiliate/events/${ev.id}/edit`} title="Modifier"
                            className="p-1.5 transition-colors" style={{ color: T3 }}
                            onMouseEnter={(e) => (e.currentTarget.style.color = T1)} onMouseLeave={(e) => (e.currentTarget.style.color = T3)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Link>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
    </AffPage>
  );
}
