import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CalendarDays, ChevronRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { usePromoterData } from '@/contexts/PromoterDataContext';
import { PromoterPage, PromoHeading } from '@/components/promoter/promoter-app-shell';
import { DateRangeFilter, type DateRange } from '@/components/promoter/DateRangeFilter';
import {
  PromoCard, PromoPill, PromoProgress, PromoEmpty,
  RED, T1, T3, BORDER,
} from '@/components/promoter/promoter-ui';
import { Skeleton } from '@/components/ui/skeleton';
import { promoterConversionRate } from '@/lib/promoterMetrics';
import type { PromoterEventStats } from '@/types/promoter';

export default function PromoterEvents() {
  const { t, language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const navigate = useNavigate();
  const { promoter, events } = usePromoterData();

  const [dateRange, setDateRange] = useState<DateRange>('upcoming');
  const [eventStats, setEventStats] = useState<PromoterEventStats[]>([]);
  const [statsLoading, setStatsLoading] = useState(true);

  // Linkage authoritative : « Mes Événements » ne montre QUE les soirées
  // auxquelles le promoteur est rattaché (assignations actives) — exactement le
  // même jeu que son linktree public. Pas de rattachement ⇒ rien à promouvoir,
  // donc rien à afficher.
  const fetchEventStats = useCallback(async () => {
    if (!promoter?.id) return;
    setStatsLoading(true);

    const { data: assgn } = await supabase.from('promoter_event_assignments')
      .select('event_id, goal_target')
      .eq('promoter_id', promoter.id)
      .eq('status', 'active');

    const eventIds = (assgn || []).map(a => a.event_id);
    if (!eventIds.length) { setEventStats([]); setStatsLoading(false); return; }

    const { data: evtsRaw } = await supabase.from('events')
      .select('id, title, start_at, end_at').in('id', eventIds);

    // Le sélecteur de date choisit QUELLES soirées afficher, pas une fenêtre
    // glissante sur les stats (chaque carte montre le bilan complet de sa soirée).
    // « À venir » (défaut) : soirées live + à venir, la live/la plus proche en
    // tête. Les fenêtres passées (7/30/90 j) : soirées terminées dans la période,
    // la plus récente d'abord.
    const nowMs = Date.now();
    const windowDays = dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : dateRange === '90d' ? 90 : 0;
    const endMs = (e: { start_at: string; end_at: string }) =>
      new Date(e.end_at || e.start_at).getTime();
    const filtered = (evtsRaw || [])
      .filter(e => {
        if (dateRange === 'upcoming') return endMs(e) >= nowMs;
        if (dateRange === 'all') return true;
        return endMs(e) < nowMs && new Date(e.start_at).getTime() >= nowMs - windowDays * 86400000;
      })
      .sort((a, b) => {
        const sa = new Date(a.start_at).getTime(), sb = new Date(b.start_at).getTime();
        return dateRange === 'upcoming' ? sa - sb : sb - sa;
      });

    const shownIds = filtered.map(e => e.id);
    if (!shownIds.length) { setEventStats([]); setStatsLoading(false); return; }

    const { data: clicks } = await supabase.from('promoter_clicks').select('event_id').eq('promoter_id', promoter.id).in('event_id', shownIds);
    const { data: convs } = await supabase.from('promoter_conversions').select('event_id, amount, commission, conversion_type, status').eq('promoter_id', promoter.id).in('event_id', shownIds);

    const clickMap: Record<string, number> = {};
    (clicks || []).forEach(c => { if (c.event_id) clickMap[c.event_id] = (clickMap[c.event_id] || 0) + 1; });

    const convMap: Record<string, { tickets: number; tables: number; revenue: number; commission: number }> = {};
    (convs || []).forEach(c => {
      if (!c.event_id) return;
      if (!convMap[c.event_id]) convMap[c.event_id] = { tickets: 0, tables: 0, revenue: 0, commission: 0 };
      const live = c.status !== 'cancelled';
      if (live && c.conversion_type === 'ticket' && (c.amount || 0) > 0) convMap[c.event_id].tickets++;
      else if (live && c.conversion_type === 'table' && (c.amount || 0) > 0) convMap[c.event_id].tables++;
      convMap[c.event_id].revenue += c.amount || 0;
      convMap[c.event_id].commission += c.commission || 0;
    });

    const goalMap = new Map((assgn || []).map(a => [a.event_id, a.goal_target]));

    setEventStats(filtered.map(e => {
      const cl = clickMap[e.id] || 0;
      const cv = convMap[e.id] || { tickets: 0, tables: 0, revenue: 0, commission: 0 };
      const gt = goalMap.get(e.id) || undefined;
      return {
        eventId: e.id,
        eventTitle: e.title,
        eventDate: e.start_at,
        clicks: cl,
        ticketsSold: cv.tickets,
        tablesReserved: cv.tables,
        revenue: cv.revenue,
        commission: cv.commission,
        conversionRate: promoterConversionRate(cv.tickets + cv.tables, cl),
        goalTarget: gt,
        goalProgress: gt ? Math.min(100, (cv.tickets / gt) * 100) : undefined,
      };
    }));
    setStatsLoading(false);
  }, [promoter?.id, dateRange]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchEventStats(); }, [fetchEventStats]);

  const getEventStatus = (start: string, end?: string) => {
    const now = new Date();
    const s = new Date(start);
    if (end && new Date(end) < now) return 'past';
    if (s > now) return 'upcoming';
    return 'active';
  };

  const fmtEur = (n: number) => `${n.toFixed(2)}€`;

  return (
    <PromoterPage>
      <PromoHeading title={t('promoter.myEvents')} subtitle={tt('Le bilan complet de chaque soirée rattachée', 'The full report of every linked event', 'El balance completo de cada evento vinculado')} />

      <DateRangeFilter value={dateRange} onChange={setDateRange} includeUpcoming />

      {statsLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <PromoCard key={i}>
              <Skeleton className="h-5 w-2/3 bg-white/5" />
              <div className="grid grid-cols-4 gap-2 mt-3">
                {[1, 2, 3, 4].map(j => <Skeleton key={j} className="h-12 bg-white/5" />)}
              </div>
            </PromoCard>
          ))}
        </div>
      ) : eventStats.length === 0 ? (
        <PromoEmpty icon={CalendarDays} title={t('promoter.noEvents')} />
      ) : (
        <div className="space-y-3">
          {eventStats.map((es, i) => {
            const evtData = events.find(e => e.id === es.eventId);
            const status = getEventStatus(es.eventDate, evtData?.end_at);
            return (
              <motion.div
                key={es.eventId}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.04, 0.3) }}
              >
                <PromoCard onClick={() => navigate(`/promoter/event/${es.eventId}`)}>
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <h3 className="min-w-0 flex-1 font-semibold text-sm truncate" style={{ color: T1 }}>{es.eventTitle}</h3>
                      <PromoPill tone={status === 'active' ? 'red' : status === 'upcoming' ? 'success' : 'muted'}>
                        {status === 'active' ? t('promoter.active') : status === 'upcoming' ? t('promoter.upcomingEvents') : t('promoter.pastEvents')}
                      </PromoPill>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0" style={{ color: T3 }} />
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                    <div className="min-w-0">
                      <p className="truncate text-lg font-bold tabular-nums" style={{ color: T1, letterSpacing: '-0.02em' }}>{es.ticketsSold}</p>
                      <p className="truncate text-xs" style={{ color: T3 }}>{t('promoter.ticketsSold')}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-lg font-bold tabular-nums" style={{ color: T1, letterSpacing: '-0.02em' }}>{fmtEur(es.revenue)}</p>
                      <p className="truncate text-xs" style={{ color: T3 }}>{t('promoter.revenue')}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-lg font-bold tabular-nums" style={{ color: RED, letterSpacing: '-0.02em' }}>{fmtEur(es.commission)}</p>
                      <p className="truncate text-xs" style={{ color: T3 }}>{t('promoter.commission')}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-lg font-bold tabular-nums" style={{ color: T1, letterSpacing: '-0.02em' }}>{es.conversionRate.toFixed(1)}%</p>
                      <p className="truncate text-xs" style={{ color: T3 }}>{t('promoter.conversionRate')}</p>
                    </div>
                  </div>
                  {es.goalTarget && es.goalProgress !== undefined && (
                    <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${BORDER}` }}>
                      <div className="flex justify-between gap-2 text-xs mb-1.5" style={{ color: T3 }}>
                        <span className="min-w-0 truncate">{t('promoter.goalProgress')}</span>
                        <span className="shrink-0 tabular-nums">{es.ticketsSold}/{es.goalTarget}</span>
                      </div>
                      <PromoProgress value={es.goalProgress} height={5} />
                    </div>
                  )}
                </PromoCard>
              </motion.div>
            );
          })}
        </div>
      )}
    </PromoterPage>
  );
}
