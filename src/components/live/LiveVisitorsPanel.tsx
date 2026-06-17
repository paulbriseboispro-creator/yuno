import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { motion } from 'framer-motion';
import { Eye, ShoppingCart, CreditCard, CheckCircle2, Lock } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED      = '#E8192C';
const POS      = '#34D399';
const T1       = 'rgba(255,255,255,0.96)';
const T2       = 'rgba(255,255,255,0.58)';
const T3       = 'rgba(255,255,255,0.36)';
const BORDER   = 'rgba(255,255,255,0.085)';
const F_BORDER = 'rgba(255,255,255,0.055)';
const TILE_BG  = 'rgba(255,255,255,0.025)';
const CARD_BG  = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

interface LivePing {
  session_id: string;
  stage: string;
  page_path: string | null;
  cart_value_cents: number | null;
  last_seen: string;
  event_id: string | null;
  user_id: string | null;
}

interface Props {
  venueId?: string | null;
  organizerUserId?: string | null;
  eventId?: string | null;
  hasAccess?: boolean;
  upgradeMessage?: string;
}

const STAGE_CONFIG = {
  browsing: { icon: Eye,          color: T2,                   labelKey: 'owner.live.stageBrowsing' },
  cart:     { icon: ShoppingCart, color: '#FCD34D',            labelKey: 'owner.live.stageCart' },
  checkout: { icon: CreditCard,   color: 'rgba(167,139,250,1)', labelKey: 'owner.live.stageCheckout' },
  paid:     { icon: CheckCircle2, color: POS,                  labelKey: 'owner.live.stageConverted' },
} as const;

export function LiveVisitorsPanel({ venueId, organizerUserId, eventId, hasAccess = true, upgradeMessage }: Props) {
  const { t } = useLanguage();
  const [pings, setPings] = useState<LivePing[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!hasAccess) { setLoading(false); return; }
    if (!venueId && !organizerUserId && !eventId) return;

    let cancelled = false;
    const fetchPings = async () => {
      try {
        const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        let query = supabase
          .from('live_visitor_pings')
          .select('session_id, stage, page_path, cart_value_cents, last_seen, event_id, user_id')
          .gte('last_seen', cutoff)
          .order('last_seen', { ascending: false });

        if (eventId) query = query.eq('event_id', eventId);
        else if (venueId) query = query.eq('venue_id', venueId);
        else if (organizerUserId) query = query.eq('organizer_user_id', organizerUserId);

        const { data } = await query.limit(200);
        if (!cancelled) setPings((data as any[]) || []);
      } catch (err) {
        console.error('[LiveVisitorsPanel]', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchPings();
    const interval = setInterval(fetchPings, 5000);
    const channel = supabase
      .channel(`live_pings_${venueId || organizerUserId || eventId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'live_visitor_pings' }, fetchPings)
      .subscribe();

    return () => { cancelled = true; clearInterval(interval); supabase.removeChannel(channel); };
  }, [venueId, organizerUserId, eventId, hasAccess]);

  if (!hasAccess) {
    return (
      <div
        className="text-center"
        style={{ padding: 24, background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW }}
      >
        <Lock className="h-8 w-8 mx-auto mb-3" style={{ color: RED }} />
        <p style={{ color: T1, fontSize: 15, fontWeight: 600, marginBottom: 6 }}>
          {t('owner.live.visitorsViewTitle')}
        </p>
        <p style={{ color: T3, fontSize: 13, maxWidth: 320, margin: '0 auto' }}>
          {upgradeMessage || t('owner.live.visitorsViewLocked')}
        </p>
      </div>
    );
  }

  const counts = {
    browsing: pings.filter(p => p.stage === 'browsing').length,
    cart:     pings.filter(p => p.stage === 'cart').length,
    checkout: pings.filter(p => p.stage === 'checkout').length,
    paid:     pings.filter(p => p.stage === 'paid').length,
  };
  const total = pings.length;
  const cartValueTotal = pings.reduce((s, p) => s + Number(p.cart_value_cents || 0), 0) / 100;
  const conversionRate = total > 0 ? Math.round((counts.paid / total) * 100) : 0;

  return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '20px 22px', overflow: 'hidden' }}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: POS }} />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ background: POS }} />
          </span>
          <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em' }}>
            {t('owner.live.visitorsHeading')}
          </h3>
          <span
            className="tabular-nums px-2 py-0.5 rounded-full"
            style={{ background: 'rgba(255,255,255,0.06)', border: `1px solid ${BORDER}`, color: T2, fontSize: 11.5, fontWeight: 600 }}
          >
            {total}
          </span>
        </div>
        <div style={{ color: T3, fontSize: 12 }}>
          {t('owner.live.converted')}{' '}
          <span className="tabular-nums" style={{ color: POS, fontWeight: 600 }}>{conversionRate}%</span>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        {(Object.keys(STAGE_CONFIG) as (keyof typeof STAGE_CONFIG)[]).map(stage => {
          const config = STAGE_CONFIG[stage];
          const Icon = config.icon;
          const value = counts[stage];
          return (
            <motion.div
              key={stage}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              style={{ padding: '10px 12px', borderRadius: 12, background: TILE_BG, border: `1px solid ${BORDER}` }}
            >
              <div className="flex items-center gap-2 mb-2">
                <Icon className="h-3.5 w-3.5" style={{ color: config.color }} />
                <span style={{ color: T3, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {t(config.labelKey)}
                </span>
              </div>
              <div className="tabular-nums" style={{ color: config.color, fontSize: 24, fontWeight: 640, letterSpacing: '-0.02em' }}>
                {value}
              </div>
            </motion.div>
          );
        })}
      </div>

      {cartValueTotal > 0 && (
        <div style={{ borderTop: `1px solid ${F_BORDER}`, paddingTop: 12, color: T3, fontSize: 12 }}>
          {t('owner.live.activeCartValue')}{': '}
          <span className="tabular-nums" style={{ color: T1, fontWeight: 640 }}>{cartValueTotal.toFixed(0)} €</span>
        </div>
      )}

      {total === 0 && !loading && (
        <p className="text-center py-4" style={{ color: T3, fontSize: 12 }}>
          {t('owner.live.noVisitorsNow')}
        </p>
      )}
    </div>
  );
}
