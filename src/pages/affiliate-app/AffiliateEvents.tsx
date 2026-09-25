import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Plus, Pencil, Trash2, AlertTriangle, ExternalLink, History, CheckCircle, FileText, CalendarOff } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';
import { format, parseISO } from 'date-fns';
import { isAffiliateEventOver } from '@/lib/affiliateEventTime';
import { fr, es, enUS } from 'date-fns/locale';
import {
  AffPage, AffHeading, AffCard, Pill, AffButton, AffLinkButton, AffSpinner, AffEmpty,
  RED, POS, WARN, T1, T2, T3, BORDER, C_FAINT,
} from '@/components/affiliate/affiliate-ui';

type EventRow = {
  id: string;
  name: string;
  event_date: string;
  status: string;
  external_ticket_url: string | null;
  is_sold_out: boolean;
  flyer_url: string | null;
  affiliate_venues: { name: string } | null;
};

const STATUS_TONE: Record<string, 'muted' | 'success' | 'warn'> = {
  draft: 'muted', published: 'success', featured: 'warn',
};
const STATUS_LABEL_KEY: Record<string, string> = {
  draft: 'aff.events.statusDraft', published: 'aff.events.statusPublished', featured: 'aff.events.statusFeatured',
};

const FILTERS = ['all', 'draft', 'published', 'featured'] as const;
type Filter = (typeof FILTERS)[number];
const FILTER_LABEL_KEY: Record<Filter, string> = {
  all: 'aff.events.filterAll', draft: 'aff.events.statusDraft', published: 'aff.events.statusPublished', featured: 'aff.events.statusFeatured',
};

export default function AffiliateEvents() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { t, language } = useLanguage();
  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;
  const [events, setEvents] = useState<EventRow[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(true);
  // Les soirées terminées sont MASQUÉES, jamais supprimées : les effacer
  // emportait en cascade les ventes déclarées, les commissions, les
  // assignations promoteurs et le rattachement des vues/clics (25/09/2026,
  // soirées du soir même comprises). Un simple interrupteur d'affichage.
  const [showPast, setShowPast] = useState(false);

  useEffect(() => {
    if (user) fetchEvents();
  }, [user]);

  const fetchEvents = async () => {
    if (!user) return;
    setLoading(true);
    const { data: aff } = await supabase.from('affiliates').select('id').eq('user_id', user.id).single();
    if (!aff) { setLoading(false); return; }

    const { data } = await supabase
      .from('affiliate_events')
      .select('id, name, event_date, status, external_ticket_url, is_sold_out, flyer_url, affiliate_venues(name)')
      .eq('affiliate_id', aff.id)
      .order('event_date', { ascending: false });

    setEvents(data ?? []);
    setLoading(false);
  };

  const toggleSoldOut = async (id: string, currentValue: boolean) => {
    const { error } = await supabase
      .from('affiliate_events')
      .update({ is_sold_out: !currentValue })
      .eq('id', id);
    if (error) {
      toast({ title: t('aff.events.errorTitle'), description: error.message, variant: 'destructive' });
      return;
    }
    setEvents((prev) => prev.map((e) => e.id === id ? { ...e, is_sold_out: !currentValue } : e));
    toast({ title: currentValue ? t('aff.events.backOnSaleToast') : t('aff.events.soldOutToast') });
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('aff.events.deleteConfirm'))) return;
    const { error } = await supabase.from('affiliate_events').delete().eq('id', id);
    if (error) {
      toast({ title: t('aff.events.errorTitle'), description: error.message, variant: 'destructive' });
      return;
    }
    setEvents((prev) => prev.filter((e) => e.id !== id));
    toast({ title: t('aff.events.deletedToast') });
  };

  const now = new Date();
  const isOver = (e: EventRow) => isAffiliateEventOver(e.event_date, now);
  const pastCount = events.filter(isOver).length;
  const upcomingCount = events.length - pastCount;
  const visible = showPast ? events : events.filter((e) => !isOver(e));
  const filtered = filter === 'all' ? visible : visible.filter((e) => e.status === filter);
  const missingLink = events.filter((e) => !e.external_ticket_url && !isOver(e)).length;

  // Groupement par date : chaque jour a son en-tête, les soirées à venir en
  // premier (plus proche → plus lointaine), le passé ensuite (plus récent
  // d'abord). Rend lisible une longue liste d'occurrences récurrentes.
  const todayStr = format(now, 'yyyy-MM-dd');
  const groups = new Map<string, EventRow[]>();
  for (const e of filtered) {
    const arr = groups.get(e.event_date);
    if (arr) arr.push(e); else groups.set(e.event_date, [e]);
  }
  // « À venir » = pas encore finie : la soirée d'hier soir reste en tête
  // jusqu'au lendemain midi (cf. isAffiliateEventOver).
  const upcomingDates = [...groups.keys()].filter((d) => !isAffiliateEventOver(d, now)).sort();
  const pastDates = [...groups.keys()].filter((d) => isAffiliateEventOver(d, now)).sort().reverse();
  const orderedDates = [...upcomingDates, ...pastDates];

  if (loading) return <AffSpinner />;

  return (
    <AffPage>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <AffHeading
          title={t('aff.events.title')}
          subtitle={`${t('aff.events.upcomingCount').replace('{count}', String(upcomingCount))}${pastCount > 0 ? ` · ${(pastCount > 1 ? t('aff.events.pastCountMany') : t('aff.events.pastCountOne')).replace('{count}', String(pastCount))}` : ''}`}
          right={
            <div className="flex items-center gap-2">
              {pastCount > 0 && (
                <AffButton variant="ghost" size="sm" onClick={() => setShowPast((v) => !v)}>
                  <History className="h-3.5 w-3.5" />
                  {(showPast ? t('aff.events.hidePastBtn') : t('aff.events.showPastBtn')).replace('{count}', String(pastCount))}
                </AffButton>
              )}
              <AffLinkButton to="/affiliate/events/new" size="sm">
                <Plus className="h-4 w-4" /> {t('aff.events.newEvent')}
              </AffLinkButton>
            </div>
          }
        />
      </motion.div>

      {/* Alert */}
      {missingLink > 0 && (
        <div className="flex items-center gap-3 rounded-2xl px-4 py-3.5"
          style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.22)' }}>
          <AlertTriangle className="h-4 w-4 flex-none" style={{ color: WARN }} />
          <p style={{ color: T2, fontSize: 12.5 }}>
            <strong style={{ color: T1 }}>{missingLink}</strong> {missingLink > 1 ? t('aff.events.missingLinkMany') : t('aff.events.missingLinkOne')}
          </p>
        </div>
      )}

      {/* Filter bar */}
      <div className="flex gap-1 flex-wrap p-1 rounded-xl w-fit" style={{ background: 'rgb(var(--ink)/0.025)', border: `1px solid ${BORDER}` }}>
        {FILTERS.map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className="px-3 py-1.5 rounded-lg text-[12.5px] font-medium cursor-pointer transition-all duration-150"
            style={filter === f
              ? { color: '#fff', background: RED, boxShadow: `0 0 14px -4px ${RED}88` }
              : { color: T3 }}>
            {t(FILTER_LABEL_KEY[f])}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <AffEmpty
          icon={CalendarOff}
          title={`${t('aff.events.emptyTitle')}${filter !== 'all' ? ` · ${t(FILTER_LABEL_KEY[filter])}` : ''}`}
          description={t('aff.events.emptyDesc')}
          action={<AffLinkButton to="/affiliate/events/new" size="sm"><Plus className="h-4 w-4" /> {t('aff.events.createEvent')}</AffLinkButton>}
        />
      ) : (
        <div className="space-y-5">
          {orderedDates.map((dateStr) => {
            const dayEvents = groups.get(dateStr)!;
            const d = parseISO(dateStr);
            const isTodayGroup = dateStr === todayStr;
            const isPastGroup = isAffiliateEventOver(dateStr, now);
            return (
              <div key={dateStr}>
                {/* En-tête de jour */}
                <div className="flex items-center gap-2 px-1 mb-2">
                  <span className="capitalize" style={{ fontSize: 12.5, fontWeight: 650, color: isTodayGroup ? RED : isPastGroup ? T3 : T2, letterSpacing: '0.01em' }}>
                    {format(d, 'EEEE d MMM yyyy', { locale: dateLocale })}
                  </span>
                  {isTodayGroup && <span style={{ fontSize: 10.5, fontWeight: 600, color: RED, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('aff.week.today')}</span>}
                  <span style={{ fontSize: 11, color: T3 }}>· {dayEvents.length} {dayEvents.length > 1 ? t('aff.week.eventMany') : t('aff.week.eventOne')}</span>
                </div>

                <AffCard padding={0}>
                  <div className="divide-y" style={{ borderColor: BORDER }}>
                    {dayEvents.map((event, i) => {
                      const past = isOver(event);
                      return (
                        <motion.div key={event.id}
                          initial={{ opacity: 0 }} animate={{ opacity: past ? 0.5 : 1 }} transition={{ delay: Math.min(i * 0.025, 0.3) }}
                          className="flex items-center gap-4 px-4 py-3 transition-colors"
                          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgb(var(--ink)/0.02)')}
                          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                        >
                          {/* Flyer thumbnail */}
                          <div className="w-12 h-12 rounded-lg overflow-hidden flex-none flex items-center justify-center" style={{ background: C_FAINT, border: `1px solid ${BORDER}` }}>
                            {event.flyer_url ? (
                              <img src={event.flyer_url} alt={event.name} className="w-full h-full object-cover" />
                            ) : (
                              <span className="tabular-nums" style={{ color: T3, fontSize: 16, fontWeight: 700 }}>{format(parseISO(event.event_date), 'd')}</span>
                            )}
                          </div>

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{event.name}</p>
                              {event.is_sold_out && <Pill tone="red">{t('aff.events.soldOutPill')}</Pill>}
                            </div>
                            <p style={{ color: T3, fontSize: 11.5, marginTop: 1 }}>
                              {event.affiliate_venues?.name ?? t('aff.events.noVenue')}
                            </p>
                          </div>

                          {/* Ticket URL indicator */}
                          <div className="flex-none hidden md:block">
                            {event.external_ticket_url ? (
                              <a href={event.external_ticket_url} target="_blank" rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-[11.5px] font-medium" style={{ color: POS }}>
                                <ExternalLink className="h-3 w-3" /> {t('aff.events.linkActive')}
                              </a>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[11.5px] font-medium" style={{ color: WARN }}>
                                <AlertTriangle className="h-3 w-3" /> {t('aff.events.linkMissing')}
                              </span>
                            )}
                          </div>

                          {/* Status + actions */}
                          <div className="flex items-center gap-1.5 flex-none">
                            <Pill tone={STATUS_TONE[event.status] ?? 'muted'}>{STATUS_LABEL_KEY[event.status] ? t(STATUS_LABEL_KEY[event.status]) : event.status}</Pill>
                            <button onClick={() => toggleSoldOut(event.id, event.is_sold_out)}
                              title={event.is_sold_out ? t('aff.events.markOnSale') : t('aff.events.markSoldOut')}
                              className="p-1.5 transition-colors" style={{ color: event.is_sold_out ? RED : T3 }}
                              onMouseEnter={(e) => (e.currentTarget.style.color = RED)} onMouseLeave={(e) => (e.currentTarget.style.color = event.is_sold_out ? RED : T3)}>
                              <CheckCircle className="h-3.5 w-3.5" />
                            </button>
                            <Link to={`/affiliate/events/${event.id}/brief`} title={t('aff.events.briefTitle')}
                              className="p-1.5 transition-colors" style={{ color: T3 }}
                              onMouseEnter={(e) => (e.currentTarget.style.color = RED)} onMouseLeave={(e) => (e.currentTarget.style.color = T3)}>
                              <FileText className="h-3.5 w-3.5" />
                            </Link>
                            <Link to={`/affiliate/events/${event.id}/edit`} title={t('aff.events.editTitle')}
                              className="p-1.5 transition-colors" style={{ color: T3 }}
                              onMouseEnter={(e) => (e.currentTarget.style.color = T1)} onMouseLeave={(e) => (e.currentTarget.style.color = T3)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Link>
                            <button onClick={() => handleDelete(event.id)} className="p-1.5 transition-colors" style={{ color: T3 }} title={t('aff.events.deleteTitle')}
                              onMouseEnter={(e) => (e.currentTarget.style.color = RED)} onMouseLeave={(e) => (e.currentTarget.style.color = T3)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                </AffCard>
              </div>
            );
          })}
        </div>
      )}
    </AffPage>
  );
}
