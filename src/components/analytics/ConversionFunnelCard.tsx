import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Eye, ShoppingCart, CreditCard, Trophy, Percent, ChevronRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useOrganizerEventIds } from '@/hooks/useOrganizerEventIds';
import { buildOrganizerScopeOr } from './scopeFilter';

type Scope =
  | { kind: 'venue'; venueId: string }
  | { kind: 'organizer'; organizerUserId: string }
  | { kind: 'event'; eventId: string };

interface Props {
  scope: Scope;
  /** ISO start date inclusive */
  from?: string;
  /** ISO end date inclusive */
  to?: string;
  className?: string;
}

interface FunnelData {
  visitors: number;
  addedToCart: number;
  proceededToCheckout: number;
  completed: number;
}

/**
 * Reusable conversion funnel card.
 * Reads from `visitor_sessions` and aggregates Visites → Panier → Checkout → Conversion.
 */
export function ConversionFunnelCard({ scope, from, to, className }: Props) {
  const { language } = useLanguage();
  const t = (fr: string, en: string) => (language === 'fr' ? fr : en);
  const [data, setData] = useState<FunnelData | null>(null);
  const organizerUserId = scope.kind === 'organizer' ? scope.organizerUserId : null;
  const { eventIds, venueIds } = useOrganizerEventIds(organizerUserId);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let query: any = supabase
        .from('visitor_sessions')
        .select('id, added_to_cart, proceeded_to_checkout, completed_order, event_id, venue_id, organizer_user_id');

      if (scope.kind === 'venue') {
        query = query.eq('venue_id', scope.venueId);
      } else if (scope.kind === 'event') {
        query = query.eq('event_id', scope.eventId);
      } else if (scope.kind === 'organizer') {
        query = query.or(buildOrganizerScopeOr(scope.organizerUserId, eventIds, venueIds));
      }

      if (from) query = query.gte('visited_at', from);
      if (to) query = query.lte('visited_at', to);

      const { data: rows, error } = await query.limit(10000);
      if (cancelled) return;
      if (error) {
        console.warn('[ConversionFunnelCard] error', error);
        setData({ visitors: 0, addedToCart: 0, proceededToCheckout: 0, completed: 0 });
        return;
      }
      const visitors = rows?.length ?? 0;
      const addedToCart = (rows ?? []).filter((r: any) => r.added_to_cart).length;
      const proceededToCheckout = (rows ?? []).filter((r: any) => r.proceeded_to_checkout).length;
      const completed = (rows ?? []).filter((r: any) => r.completed_order).length;
      setData({ visitors, addedToCart, proceededToCheckout, completed });
    })();
    return () => { cancelled = true; };
  }, [scope.kind, (scope as any).venueId, (scope as any).eventId, (scope as any).organizerUserId, from, to, eventIds.join(','), venueIds.join(',')]);

  const safe = data ?? { visitors: 0, addedToCart: 0, proceededToCheckout: 0, completed: 0 };
  const conversionRate = safe.visitors > 0 ? (safe.completed / safe.visitors) * 100 : 0;
  const pct = (n: number) => (safe.visitors > 0 ? `${((n / safe.visitors) * 100).toFixed(1)}%` : '0%');

  const steps = [
    { label: t('Visiteurs', 'Visitors'), value: safe.visitors, icon: Eye, rate: '100%' },
    { label: t('Panier', 'Added to cart'), value: safe.addedToCart, icon: ShoppingCart, rate: pct(safe.addedToCart) },
    { label: t('Checkout', 'Checkout'), value: safe.proceededToCheckout, icon: CreditCard, rate: pct(safe.proceededToCheckout) },
    { label: t('Conversion', 'Conversion'), value: safe.completed, icon: Trophy, rate: pct(safe.completed) },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className={className}>
      <Card className="glass-card p-6 rounded-2xl">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-3">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 p-2.5 rounded-xl border border-primary/20">
              <Percent className="h-5 w-5 text-primary" />
            </div>
            <h3 className="text-lg font-semibold text-foreground">
              {t('Funnel de conversion', 'Conversion funnel')}
            </h3>
          </div>
          <div className="text-left sm:text-right bg-primary/5 px-4 py-2 rounded-xl border border-primary/20">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">
              {t('Taux global', 'Global rate')}
            </p>
            <p className="text-2xl font-bold text-primary metric-value">{conversionRate.toFixed(1)}%</p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, i) => (
            <div key={step.label} className="relative">
              <Card className="glass-card p-4 rounded-xl hover:scale-[1.02] transition-all duration-300">
                <div className="flex items-center gap-2 mb-2">
                  <step.icon className="h-4 w-4 text-primary" />
                  <span className="text-xs uppercase tracking-wider text-muted-foreground">{step.label}</span>
                </div>
                <div className="text-2xl font-bold text-foreground">{step.value.toLocaleString()}</div>
                <div className="text-xs text-primary mt-1">{step.rate}</div>
              </Card>
              {i < steps.length - 1 && (
                <div className="hidden lg:flex absolute top-1/2 -right-4 transform -translate-y-1/2 text-muted-foreground/30">
                  <ChevronRight className="h-6 w-6" />
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>
    </motion.div>
  );
}
