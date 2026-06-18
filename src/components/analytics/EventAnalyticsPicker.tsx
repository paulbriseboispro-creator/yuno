import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Calendar, ChevronRight, Sparkles } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { format, isToday } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';

// ─── Yuno pro-dashboard design tokens ─────────────────────────────────────────
const RED = '#E8192C';
const POS = '#34D399';
const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';
const CARD_BG = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

interface EventRow {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  poster_url: string | null;
  max_tickets: number | null;
  sold: number;
}

type Status = 'past' | 'tonight' | 'upcoming';

function statusOf(e: EventRow): Status {
  const start = new Date(e.start_at);
  const end = new Date(e.end_at).getTime();
  const now = Date.now();
  if (isToday(start)) return 'tonight';
  if (end < now) return 'past';
  return 'upcoming';
}

interface Props {
  /** Venue scope. While null (venue still loading) the picker shows a skeleton. */
  venueId: string | null;
  /** Fired with the chosen event id — caller opens that event's analysis. */
  onSelect: (eventId: string) => void;
}

/**
 * Calendar-style event picker for the analytics Event mode. Replaces the bare
 * <select>: events render as full cards (poster, date, sold + fill), grouped by
 * month, most recent first. Picking a card opens that night's analysis.
 */
export function EventAnalyticsPicker({ venueId, onSelect }: Props) {
  const { t, language } = useLanguage();
  const locale = language === 'fr' ? fr : language === 'es' ? es : enUS;
  const [rows, setRows] = useState<EventRow[] | null>(null);

  useEffect(() => {
    if (!venueId) return;
    let cancelled = false;
    (async () => {
      const { data: evs } = await supabase
        .from('events')
        .select('id, title, start_at, end_at, poster_url, max_tickets')
        .eq('venue_id', venueId)
        .order('start_at', { ascending: false })
        .limit(60);
      const list = evs || [];
      const ids = list.map((e) => e.id);
      const soldByEvent: Record<string, number> = {};
      if (ids.length > 0) {
        const { data: tks } = await supabase
          .from('tickets')
          .select('event_id, quantity')
          .eq('status', 'paid')
          .in('event_id', ids);
        (tks || []).forEach((tk: { event_id: string; quantity: number | null }) => {
          soldByEvent[tk.event_id] = (soldByEvent[tk.event_id] || 0) + (tk.quantity || 0);
        });
      }
      if (cancelled) return;
      setRows(list.map((e) => ({ ...e, sold: soldByEvent[e.id] || 0 })));
    })();
    return () => { cancelled = true; };
  }, [venueId]);

  // — Loading skeleton
  if (!rows) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} style={{ height: 232, background: 'rgba(255,255,255,0.04)', borderRadius: 16 }} className="animate-pulse" />
        ))}
      </div>
    );
  }

  // — Empty state
  if (rows.length === 0) {
    return (
      <div className="text-center py-16">
        <Calendar className="h-10 w-10 mx-auto mb-4" style={{ color: T3 }} />
        <p style={{ color: T2, fontSize: 14 }}>{t('owner.an.noEventsToAnalyze')}</p>
      </div>
    );
  }

  // — Group by month (rows already sorted by start_at desc)
  const groups: { key: string; label: string; events: EventRow[] }[] = [];
  for (const e of rows) {
    const d = new Date(e.start_at);
    const key = format(d, 'yyyy-MM');
    let g = groups.find((x) => x.key === key);
    if (!g) {
      g = { key, label: format(d, 'MMMM yyyy', { locale }), events: [] };
      groups.push(g);
    }
    g.events.push(e);
  }

  const statusChip: Record<Status, { label: string; color: string; bg: string }> = {
    past: { label: t('owner.an.statusPast'), color: T2, bg: 'rgba(255,255,255,0.07)' },
    tonight: { label: t('owner.an.statusTonight'), color: POS, bg: 'rgba(52,211,153,0.12)' },
    upcoming: { label: t('owner.an.statusUpcoming'), color: RED, bg: 'rgba(232,25,44,0.12)' },
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 style={{ color: T1, fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em' }}>
          {t('owner.an.pickEventTitle')}
        </h2>
        <p style={{ color: T3, fontSize: 13, marginTop: 4 }}>{t('owner.an.pickEventSub')}</p>
      </div>

      {groups.map((g) => (
        <div key={g.key} className="space-y-3">
          <div className="flex items-center gap-2">
            <Calendar className="w-3.5 h-3.5" style={{ color: T3 }} />
            <span style={{ color: T2, fontSize: 12.5, fontWeight: 600, textTransform: 'capitalize', letterSpacing: '0.02em' }}>
              {g.label}
            </span>
            <div className="flex-1 h-px" style={{ background: BORDER }} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {g.events.map((e, i) => {
              const status = statusOf(e);
              const chip = statusChip[status];
              const fillPct = e.max_tickets && e.max_tickets > 0
                ? Math.min(100, Math.round((e.sold / e.max_tickets) * 100))
                : null;
              return (
                <motion.button
                  key={e.id}
                  type="button"
                  onClick={() => onSelect(e.id)}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.03, 0.2) }}
                  whileHover={{ y: -3 }}
                  className="group text-left overflow-hidden cursor-pointer"
                  style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 16, boxShadow: CARD_SHADOW }}
                >
                  {/* Poster */}
                  <div className="relative" style={{ height: 116, background: 'rgba(255,255,255,0.03)' }}>
                    {e.poster_url ? (
                      <img src={e.poster_url} alt="" className="w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Sparkles className="w-6 h-6" style={{ color: T3 }} />
                      </div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 h-12" style={{ background: 'linear-gradient(to top, rgba(10,10,12,0.9), transparent)' }} />
                    <span
                      className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded-full"
                      style={{ background: chip.bg, color: chip.color, fontSize: 10.5, fontWeight: 600, backdropFilter: 'blur(8px)' }}
                    >
                      {chip.label}
                    </span>
                  </div>

                  {/* Body */}
                  <div className="p-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate" style={{ color: T1, fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em' }}>
                          {e.title}
                        </p>
                        <p style={{ color: T3, fontSize: 11.5, marginTop: 2, textTransform: 'capitalize' }}>
                          {format(new Date(e.start_at), 'EEE d MMM yyyy', { locale })}
                        </p>
                      </div>
                      <ChevronRight className="w-4 h-4 flex-none mt-0.5 transition-transform group-hover:translate-x-0.5" style={{ color: T3 }} />
                    </div>

                    {/* Sold + fill */}
                    <div className="mt-3">
                      <div className="flex items-baseline justify-between">
                        <span className="tabular-nums" style={{ color: T1, fontSize: 15, fontWeight: 640 }}>
                          {e.sold}
                          <span style={{ color: T3, fontSize: 11.5, fontWeight: 500, marginLeft: 4 }}>
                            {t('owner.an.ticketsSoldShort')}
                          </span>
                        </span>
                        {fillPct !== null && (
                          <span className="tabular-nums" style={{ color: fillPct >= 90 ? POS : T2, fontSize: 12, fontWeight: 600 }}>
                            {fillPct}%
                          </span>
                        )}
                      </div>
                      {fillPct !== null && (
                        <div className="h-1.5 rounded-full mt-1.5 overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${fillPct}%`, background: fillPct >= 90 ? POS : `linear-gradient(90deg,${RED}99,${RED})` }}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </motion.button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
