import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Wine, Calendar } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { format } from 'date-fns';
import { enUS, es, fr } from 'date-fns/locale';

interface PackCredit {
  id: string;
  total_credits: number;
  used_credits: number;
  pack_id: string;
  event_id: string | null;
  expires_at: string | null;
  venue_id: string;
}

interface EventInfo {
  id: string;
  title: string;
  start_at: string;
  end_at: string | null;
}

interface DrinkCreditsCardProps {
  venueId?: string;
  ticketId?: string;
  compact?: boolean;
}

// 2h lead before doors + 2h grace after close = "the night of the event"
// window (mirrors the server gate in use-drink-credit).
const WINDOW_MS = 2 * 60 * 60 * 1000;

export function DrinkCreditsCard({ venueId, ticketId, compact = false }: DrinkCreditsCardProps) {
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const [credits, setCredits] = useState<PackCredit[]>([]);
  const [events, setEvents] = useState<Record<string, EventInfo>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    fetchCredits();
  }, [user, venueId, ticketId]);

  const fetchCredits = async () => {
    if (!user) return;

    let query = supabase
      .from('order_pack_credits')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (venueId) query = query.eq('venue_id', venueId);
    if (ticketId) query = query.eq('ticket_order_id', ticketId);

    const { data } = await query;

    if (data) {
      const now = new Date().toISOString();
      // Show all credits for active events (not yet expired), including fully used ones
      const activeCredits = data.filter(c => (!c.expires_at || c.expires_at > now));
      setCredits(activeCredits);

      // Resolve the soirée each credit is bound to, so we can show its name + date.
      const eventIds = [...new Set(activeCredits.map(c => c.event_id).filter(Boolean))] as string[];
      if (eventIds.length > 0) {
        const { data: evs } = await supabase
          .from('events')
          .select('id, title, start_at, end_at')
          .in('id', eventIds);
        if (evs) {
          const map: Record<string, EventInfo> = {};
          evs.forEach(e => { map[e.id] = e as EventInfo; });
          setEvents(map);
        }
      }
    }
    setLoading(false);
  };

  const getLocale = () => (language === 'fr' ? fr : language === 'es' ? es : enUS);

  if (loading || credits.length === 0) return null;

  const totalRemaining = credits.reduce((sum, c) => sum + (c.total_credits - c.used_credits), 0);
  // Hide the entire card when no credits remain
  if (totalRemaining <= 0) return null;
  const totalAll = credits.reduce((sum, c) => sum + c.total_credits, 0);

  if (compact) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20"
      >
        <Wine className="h-4 w-4 text-amber-400" />
        <span className="text-sm font-medium">
          {t('upsell.creditsAvailable').replace('{count}', String(totalRemaining))}
        </span>
      </motion.div>
    );
  }

  // Group credits by the soirée they belong to (null event_id = venue-wide / legacy).
  const groups = new Map<string, PackCredit[]>();
  for (const c of credits) {
    const key = c.event_id || '__venue__';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }

  const now = Date.now();
  const entries = [...groups.entries()]
    .map(([key, list]) => {
      const ev = key === '__venue__' ? null : events[key];
      const remaining = list.reduce((s, c) => s + (c.total_credits - c.used_credits), 0);
      const total = list.reduce((s, c) => s + c.total_credits, 0);
      const used = list.reduce((s, c) => s + c.used_credits, 0);
      let status: 'live' | 'upcoming' | 'venue' = 'venue';
      if (ev) {
        const start = new Date(ev.start_at).getTime() - WINDOW_MS;
        const end = new Date(ev.end_at || ev.start_at).getTime() + WINDOW_MS;
        status = now >= start && now <= end ? 'live' : 'upcoming';
      }
      return { key, ev, list, remaining, total, used, status };
    })
    .filter(g => g.remaining > 0);

  // Live first, then upcoming by date, venue-wide last.
  const order: Record<string, number> = { live: 0, upcoming: 1, venue: 2 };
  entries.sort((a, b) => {
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    if (a.ev && b.ev) return new Date(a.ev.start_at).getTime() - new Date(b.ev.start_at).getTime();
    return 0;
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <Card className="overflow-hidden border-border/40 bg-card">
        <div className="p-4">
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Wine className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">{t('upsell.yourDrinkCredits')}</h3>
            </div>
            <Badge variant="secondary" className="text-xs font-bold">
              {totalRemaining} / {totalAll}
            </Badge>
          </div>

          {/* One row per soirée the credits are bound to */}
          <div className="space-y-2">
            {entries.map((g) => (
              <div key={g.key} className="p-3 rounded-lg bg-muted/30 border border-border/30">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-sm font-medium truncate">
                    {g.ev ? g.ev.title : t('upsell.creditVenueWide')}
                  </span>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {t('upsell.creditsUsed')
                      .replace('{used}', String(g.used))
                      .replace('{total}', String(g.total))}
                  </span>
                </div>

                {/* Date + validity status */}
                {g.ev && (
                  <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                    <Calendar className="h-3 w-3 text-muted-foreground" />
                    <span className="text-[11px] text-muted-foreground capitalize">
                      {format(new Date(g.ev.start_at), 'EEE d MMM', { locale: getLocale() })}
                    </span>
                    {g.status === 'live' ? (
                      <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-green-500/15 text-green-400">
                        {t('upsell.creditAvailableTonight')}
                      </span>
                    ) : (
                      <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400">
                        {t('upsell.creditNightOnly')}
                      </span>
                    )}
                  </div>
                )}

                {/* Visual dots */}
                <div className="flex gap-1.5 flex-wrap">
                  {Array.from({ length: g.total }).map((_, i) => (
                    <div
                      key={i}
                      className={`w-6 h-6 rounded-full flex items-center justify-center transition-all ${
                        i < g.used
                          ? 'bg-muted/50 text-muted-foreground'
                          : 'bg-amber-500/20 text-amber-400'
                      }`}
                    >
                      <Wine className={`h-3 w-3 ${i < g.used ? 'opacity-30' : ''}`} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Usage instructions */}
          <div className="mt-3 space-y-1">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
              {t('upsell.creditUsageTitle')}
            </p>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {t('upsell.creditUsageEvent')}
            </p>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
