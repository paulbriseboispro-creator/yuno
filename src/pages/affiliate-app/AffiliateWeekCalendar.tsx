import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { format, addDays, startOfDay, isToday, parseISO } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { useLanguage } from '@/contexts/LanguageContext';
import { CheckCircle, Pencil, FileText, ChevronLeft, ChevronRight, Link2, Loader2, X } from 'lucide-react';
import {
  AffPage, AffHeading, AffSpinner, AffButton, DarkInput,
  RED, POS, WARN, T1, T2, T3, BORDER, F_BORDER, C_FAINT, CARD_BG, CARD_SHADOW, INNER_BG,
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
  ok:          { dot: POS, label: 'aff.week.statusOk' },
  missing_url: { dot: WARN, label: 'aff.week.statusMissingUrl' },
  soldout:     { dot: RED, label: 'aff.week.statusSoldout' },
  draft:       { dot: T3, label: 'aff.week.statusDraft' },
};

// Colle telle quelle une adresse complète ; ajoute https:// à un domaine nu.
// Renvoie null pour un champ vidé (le lien est retiré), false pour une saisie
// qui n'est pas une adresse.
function normalizeTicketUrl(raw: string): string | null | false {
  const v = raw.trim();
  if (!v) return null;
  const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withScheme);
    if (!u.hostname.includes('.')) return false;
    return u.toString();
  } catch {
    return false;
  }
}

function NavButton({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className="flex items-center justify-center rounded-xl transition-colors"
      style={{ width: 32, height: 32, background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}
      onMouseEnter={(e) => { e.currentTarget.style.color = T1; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.16)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = T2; e.currentTarget.style.borderColor = BORDER; }}
    >
      {children}
    </button>
  );
}

export default function AffiliateWeekCalendar() {
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;
  const { toast } = useToast();
  const [affId, setAffId] = useState<string | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [weekOffset, setWeekOffset] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftUrl, setDraftUrl] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);

  // Fenêtre glissante de 7 jours, décalée d'une semaine à chaque pas.
  const weekStart = addDays(startOfDay(new Date()), weekOffset * 7);
  const weekEnd = addDays(weekStart, 6);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data: aff } = await supabase.from('affiliates').select('id').eq('user_id', user.id).single();
      if (cancelled) return;
      if (!aff) { setLoading(false); return; }
      setAffId(aff.id);
    })();
    return () => { cancelled = true; };
  }, [user]);

  const fetchEvents = useCallback(async (id: string, from: Date, to: Date) => {
    setLoading(true);
    const { data } = await supabase
      .from('affiliate_events')
      .select('id, name, event_date, status, is_sold_out, external_ticket_url, flyer_url')
      .eq('affiliate_id', id)
      .gte('event_date', format(from, 'yyyy-MM-dd'))
      .lte('event_date', format(to, 'yyyy-MM-dd'))
      .order('event_date');
    setEvents(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!affId) return;
    setEditingId(null);
    fetchEvents(affId, weekStart, weekEnd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [affId, weekOffset, fetchEvents]);

  const toggleSoldOut = async (id: string, current: boolean) => {
    const { error } = await supabase.from('affiliate_events').update({ is_sold_out: !current }).eq('id', id);
    if (error) { toast({ title: t('aff.week.error'), description: error.message, variant: 'destructive' }); return; }
    setEvents(prev => prev.map(e => e.id === id ? { ...e, is_sold_out: !current } : e));
    toast({ title: current ? t('aff.week.backOnSale') : t('aff.week.markedSoldOut') });
  };

  const openLinkEditor = (ev: EventRow) => {
    setEditingId(ev.id);
    setDraftUrl(ev.external_ticket_url ?? '');
  };

  const closeLinkEditor = () => {
    setEditingId(null);
    setDraftUrl('');
  };

  const saveLink = async (ev: EventRow) => {
    const url = normalizeTicketUrl(draftUrl);
    if (url === false) {
      toast({ title: t('aff.week.linkInvalid'), description: t('aff.week.linkInvalidHint'), variant: 'destructive' });
      return;
    }
    setSavingId(ev.id);
    // La base décide du statut : le verrou plateforme publie la soirée dès
    // qu'un lien arrive et la repasse en brouillon dès qu'on le retire.
    const { data, error } = await supabase
      .from('affiliate_events')
      .update({ external_ticket_url: url })
      .eq('id', ev.id)
      .select('id, name, event_date, status, is_sold_out, external_ticket_url, flyer_url')
      .single();
    setSavingId(null);
    if (error || !data) {
      toast({ title: t('aff.week.error'), description: error?.message, variant: 'destructive' });
      return;
    }
    const saved = data as EventRow;
    setEvents(prev => prev.map(e => (e.id === saved.id ? saved : e)));
    closeLinkEditor();
    if (!saved.external_ticket_url) {
      toast({ title: t('aff.week.linkCleared'), description: t('aff.week.linkClearedHint') });
    } else if (saved.status === 'published' || saved.status === 'featured') {
      toast({ title: t('aff.week.linkPublished'), description: saved.name });
    } else {
      toast({ title: t('aff.week.linkSaved'), description: saved.name });
    }
  };

  const eventsForDay = (dateStr: string) => events.filter(e => e.event_date === dateStr);

  const heading =
    weekOffset === 0 ? t('aff.nav.week')
    : weekOffset === 1 ? t('aff.week.nextWeek')
    : weekOffset === -1 ? t('aff.week.lastWeek')
    : `${t('aff.week.weekOf')} ${format(weekStart, 'd MMMM', { locale: dateLocale })}`;

  return (
    <AffPage>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <AffHeading
          title={heading}
          subtitle={`${t('aff.week.subtitle')} — ${format(weekStart, 'd MMM', { locale: dateLocale })} → ${format(weekEnd, 'd MMM yyyy', { locale: dateLocale })}`}
          right={
            <div className="flex items-center gap-2">
              {weekOffset !== 0 && (
                <button
                  onClick={() => setWeekOffset(0)}
                  className="rounded-xl transition-colors"
                  style={{ height: 32, padding: '0 12px', fontSize: 12, fontWeight: 560, background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = T1; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.16)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = T2; e.currentTarget.style.borderColor = BORDER; }}
                >
                  {t('aff.week.today')}
                </button>
              )}
              <NavButton onClick={() => setWeekOffset(w => w - 1)} title={t('aff.week.prevWeek')}>
                <ChevronLeft className="h-4 w-4" />
              </NavButton>
              <NavButton onClick={() => setWeekOffset(w => w + 1)} title={t('aff.week.nextWeekAction')}>
                <ChevronRight className="h-4 w-4" />
              </NavButton>
            </div>
          }
        />
      </motion.div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4">
        {Object.values(STATUS_STYLE).map((s) => (
          <div key={s.label} className="flex items-center gap-1.5">
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.dot, display: 'inline-block' }} />
            <span style={{ fontSize: 11.5, color: T3 }}>{t(s.label)}</span>
          </div>
        ))}
      </div>

      {loading ? <AffSpinner /> : (
      /* Days */
      <div className="space-y-3">
        {days.map((day, di) => {
          const dateStr = format(day, 'yyyy-MM-dd');
          const dayEvents = eventsForDay(dateStr);
          const dayLabel = format(day, 'EEEE d MMMM', { locale: dateLocale });
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
                  {isNow && <span style={{ marginLeft: 8, fontSize: 11, color: 'rgba(232,25,44,0.75)' }}>{t('aff.week.today')}</span>}
                </span>
                <span style={{ fontSize: 11, color: T3 }}>{dayEvents.length} {dayEvents.length !== 1 ? t('aff.week.eventMany') : t('aff.week.eventOne')}</span>
              </div>

              {/* Events */}
              {dayEvents.length === 0 ? (
                <div className="px-4 py-3" style={{ fontSize: 11.5, color: T3, fontStyle: 'italic' }}>{t('aff.week.noEvents')}</div>
              ) : (
                <div className="divide-y" style={{ borderColor: F_BORDER }}>
                  {dayEvents.map(ev => {
                    const status = getDayStatus(ev);
                    const style = STATUS_STYLE[status];
                    const noLink = !ev.external_ticket_url;
                    const isEditing = editingId === ev.id;
                    return (
                      <div key={ev.id} style={{ borderLeft: `3px solid ${style.dot}` }}>
                      <div
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
                            <span style={{ fontSize: 11, color: T3 }}>{t(style.label)}</span>
                          </div>
                        </div>

                        {/* Lien billetterie manquant : la seule action qui compte ici */}
                        {noLink && !isEditing && (
                          <button onClick={() => openLinkEditor(ev)}
                            title={t('aff.week.addLink')}
                            className="flex items-center gap-1.5 rounded-lg flex-none transition-colors"
                            style={{ height: 28, padding: '0 10px', fontSize: 11.5, fontWeight: 560, color: WARN, background: 'rgba(251,191,36,0.10)', border: '1px solid rgba(251,191,36,0.28)' }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(251,191,36,0.18)')}
                            onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(251,191,36,0.10)')}>
                            <Link2 className="h-3.5 w-3.5" />
                            <span className="hidden sm:inline">{t('aff.week.addLink')}</span>
                          </button>
                        )}

                        {/* Actions */}
                        <div className="flex items-center gap-1 flex-none">
                          {!noLink && (
                            <button onClick={() => (isEditing ? closeLinkEditor() : openLinkEditor(ev))}
                              title={t('aff.week.editLink')}
                              className="p-1.5 transition-colors" style={{ color: isEditing ? RED : T3 }}
                              onMouseEnter={(e) => (e.currentTarget.style.color = RED)} onMouseLeave={(e) => (e.currentTarget.style.color = isEditing ? RED : T3)}>
                              <Link2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button onClick={() => toggleSoldOut(ev.id, ev.is_sold_out)}
                            title={ev.is_sold_out ? t('aff.week.putBackOnSale') : t('aff.week.markSoldOut')}
                            className="p-1.5 transition-colors" style={{ color: ev.is_sold_out ? RED : T3 }}
                            onMouseEnter={(e) => (e.currentTarget.style.color = RED)} onMouseLeave={(e) => (e.currentTarget.style.color = ev.is_sold_out ? RED : T3)}>
                            <CheckCircle className="h-3.5 w-3.5" />
                          </button>
                          <Link to={`/affiliate/events/${ev.id}/brief`} title={t('aff.week.brief')}
                            className="p-1.5 transition-colors" style={{ color: T3 }}
                            onMouseEnter={(e) => (e.currentTarget.style.color = RED)} onMouseLeave={(e) => (e.currentTarget.style.color = T3)}>
                            <FileText className="h-3.5 w-3.5" />
                          </Link>
                          <Link to={`/affiliate/events/${ev.id}/edit`} title={t('aff.week.edit')}
                            className="p-1.5 transition-colors" style={{ color: T3 }}
                            onMouseEnter={(e) => (e.currentTarget.style.color = T1)} onMouseLeave={(e) => (e.currentTarget.style.color = T3)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Link>
                        </div>
                      </div>

                      {/* Éditeur de lien en ligne */}
                      {isEditing && (
                        <div className="flex items-center gap-2 px-4 pb-3" style={{ paddingLeft: 63 }}>
                          <DarkInput
                            type="url"
                            autoFocus
                            value={draftUrl}
                            onChange={setDraftUrl}
                            placeholder={t('aff.week.linkPlaceholder')}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveLink(ev);
                              if (e.key === 'Escape') closeLinkEditor();
                            }}
                          />
                          <AffButton size="sm" onClick={() => saveLink(ev)}
                            disabled={savingId === ev.id || draftUrl.trim() === (ev.external_ticket_url ?? '')}>
                            {savingId === ev.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : (noLink ? t('aff.week.linkPublish') : t('aff.week.linkSave'))}
                          </AffButton>
                          <button onClick={closeLinkEditor} title={t('aff.week.linkCancel')}
                            className="p-1.5 flex-none transition-colors" style={{ color: T3 }}
                            onMouseEnter={(e) => (e.currentTarget.style.color = T1)} onMouseLeave={(e) => (e.currentTarget.style.color = T3)}>
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                      </div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
      )}
    </AffPage>
  );
}
