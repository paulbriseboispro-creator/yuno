import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShoppingCart, CheckCircle, Ticket, Users, RotateCcw, Crown, Shirt, Pause, Radio } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { FeedItem, FeedFilter, FeedItemType } from '@/hooks/useLiveNightData';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED      = '#E8192C';
const POS      = '#34D399';
const T1       = 'rgba(255,255,255,0.96)';
const T2       = 'rgba(255,255,255,0.58)';
const T3       = 'rgba(255,255,255,0.36)';
const BORDER   = 'rgba(255,255,255,0.085)';
const F_BORDER = 'rgba(255,255,255,0.055)';
const CARD_BG  = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

interface Props {
  feed: FeedItem[];
  isPaused: boolean;
  onTogglePause: () => void;
}

const typeConfig: Record<FeedItemType, { icon: typeof ShoppingCart; color: string; labelKey: string }> = {
  order_created: { icon: ShoppingCart, color: T2,         labelKey: 'live.feedOrderCreated' },
  order_ready:   { icon: CheckCircle,  color: POS,        labelKey: 'live.feedOrderReady' },
  order_served:  { icon: CheckCircle,  color: POS,        labelKey: 'live.feedOrderServed' },
  ticket_scanned:{ icon: Ticket,       color: T2,         labelKey: 'live.feedTicketScanned' },
  vip_scanned:   { icon: Crown,        color: '#FCD34D',  labelKey: 'live.feedVipScanned' },
  refund:        { icon: RotateCcw,    color: RED,        labelKey: 'live.feedRefund' },
  table_booked:  { icon: Crown,        color: '#FCD34D',  labelKey: 'live.feedTableBooked' },
  cloakroom:     { icon: Shirt,        color: T2,         labelKey: 'live.feedCloakroom' },
};

const filterTypes: Record<FeedFilter, FeedItemType[]> = {
  all:    [],
  orders: ['order_created', 'order_ready', 'order_served'],
  entry:  ['ticket_scanned', 'vip_scanned'],
  staff:  ['order_ready', 'order_served', 'cloakroom'],
  issues: ['refund'],
};

export function LiveActivityFeed({ feed, isPaused, onTogglePause }: Props) {
  const { t } = useLanguage();
  const [filter, setFilter] = useState<FeedFilter>('all');

  const filteredFeed = filter === 'all' ? feed : feed.filter(item => filterTypes[filter].includes(item.type));

  const filters: { key: FeedFilter; label: string }[] = [
    { key: 'all',    label: t('live.filterAll') },
    { key: 'orders', label: t('live.filterOrders') },
    { key: 'entry',  label: t('live.filterEntry') },
    { key: 'staff',  label: t('live.filterStaff') },
    { key: 'issues', label: t('live.filterIssues') },
  ];

  const formatTime = (ts: string) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, overflow: 'hidden' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${F_BORDER}` }}>
        <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em' }}>
          {t('live.activityFeed')}
        </h3>
        <button
          onClick={onTogglePause}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg cursor-pointer transition-all duration-150"
          style={isPaused
            ? { background: 'rgba(251,191,36,0.10)', border: '1px solid rgba(251,191,36,0.25)', color: '#FCD34D' }
            : { background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.22)', color: POS }
          }
        >
          {isPaused ? <Pause className="h-3 w-3" /> : <Radio className="h-3 w-3" />}
          <span style={{ fontSize: 11.5, fontWeight: 600 }}>
            {isPaused ? t('live.paused') : t('live.live')}
          </span>
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-0.5 px-4 py-2" style={{ borderBottom: `1px solid ${F_BORDER}`, overflowX: 'auto' }}>
        {filters.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className="whitespace-nowrap px-3 py-1.5 rounded-lg cursor-pointer transition-all duration-150"
            style={filter === f.key
              ? { color: RED, background: 'rgba(232,25,44,0.10)', border: '1px solid rgba(232,25,44,0.20)', fontSize: 12, fontWeight: 600 }
              : { color: T3, border: '1px solid transparent', fontSize: 12 }
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      <ScrollArea className="h-[320px]">
        <div className="p-2 space-y-0.5">
          <AnimatePresence initial={false}>
            {filteredFeed.length === 0 ? (
              <p className="text-center py-8" style={{ color: T3, fontSize: 12 }}>
                {t('live.noActivity')}
              </p>
            ) : (
              filteredFeed.map(item => {
                const config = typeConfig[item.type];
                const Icon = config.icon;
                return (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="flex items-center gap-3 px-3 py-2 rounded-xl"
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: config.color }} />
                    <div className="flex-1 min-w-0">
                      <p className="truncate" style={{ fontSize: 12.5 }}>
                        <span style={{ color: T3 }}>{t(config.labelKey)}</span>
                        {' '}
                        <span style={{ color: T1 }}>{item.description}</span>
                      </p>
                      {item.actor && (
                        <p className="truncate" style={{ fontSize: 10.5, color: T3 }}>{item.actor}</p>
                      )}
                    </div>
                    <span className="tabular-nums shrink-0" style={{ color: T3, fontSize: 10.5 }}>
                      {formatTime(item.timestamp)}
                    </span>
                  </motion.div>
                );
              })
            )}
          </AnimatePresence>
        </div>
      </ScrollArea>
    </div>
  );
}
