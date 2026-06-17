import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Wine, Ticket, Crown } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { OwnerHeader } from '@/components/OwnerHeader';
import { OwnerPageSkeleton } from '@/components/DashboardSkeleton';
import { useVenueContext } from '@/hooks/useVenueContext';
import { OwnerDrinkOrders } from '@/components/owner/OwnerDrinkOrders';
import { OwnerTicketOrders } from '@/components/owner/OwnerTicketOrders';
import { OwnerVipOrders } from '@/components/owner/OwnerVipOrders';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED  = '#E8192C';
const T1   = 'rgba(255,255,255,0.96)';
const T3   = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';

const TABS = [
  { key: 'drinks',  labelKey: 'owner.drinks', fallback: 'Drinks',     Icon: Wine   },
  { key: 'tickets', labelKey: null,           fallback: 'Tickets',    Icon: Ticket },
  { key: 'vip',     labelKey: null,           fallback: 'VIP Tables', Icon: Crown  },
] as const;

type TabKey = typeof TABS[number]['key'];

export default function OwnerOrders() {
  const { t } = useLanguage();
  const { venueId, loading: venueLoading } = useVenueContext();
  const [activeTab, setActiveTab] = useState<TabKey>('drinks');

  if (venueLoading || !venueId) return <OwnerPageSkeleton />;

  return (
    <div className="min-h-screen pb-28" style={{ background: '#000' }}>
      {/* Ambient vignette */}
      <div className="fixed inset-0 pointer-events-none z-0"
        style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(255,255,255,.025),transparent 55%)' }} />

      <OwnerHeader title={t('owner.ordersManagement')} />

      <div className="relative z-10 mx-auto max-w-[1340px] px-4 sm:px-6 pt-2">
        {/* Tab bar */}
        <div className="flex gap-0.5 mb-5" style={{ borderBottom: `1px solid ${BORDER}` }}>
          {TABS.map(({ key, labelKey, fallback, Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className="relative inline-flex items-center gap-2 px-4 py-3 text-[13.5px] font-[560] transition-colors duration-150 cursor-pointer"
              style={{ color: activeTab === key ? T1 : T3 }}
            >
              <Icon className="w-4 h-4" />
              <span className="hidden sm:inline">{labelKey ? t(labelKey) : fallback}</span>
              {activeTab === key && (
                <span
                  className="absolute left-3 right-3 rounded-full"
                  style={{ bottom: -1, height: 2, background: RED, boxShadow: `0 0 10px rgba(232,25,44,0.6)` }}
                />
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
          >
            {activeTab === 'drinks'  && <OwnerDrinkOrders  venueId={venueId} />}
            {activeTab === 'tickets' && <OwnerTicketOrders venueId={venueId} />}
            {activeTab === 'vip'     && <OwnerVipOrders    venueId={venueId} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
