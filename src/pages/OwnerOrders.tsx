import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Wine, Ticket, Crown } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { OwnerHeader } from '@/components/OwnerHeader';
import { OwnerPageSkeleton } from '@/components/DashboardSkeleton';
import { useVenueContext } from '@/hooks/useVenueContext';
import { supabase } from '@/integrations/supabase/client';
import { OwnerDrinkOrders } from '@/components/owner/OwnerDrinkOrders';
import { OwnerTicketOrders } from '@/components/owner/OwnerTicketOrders';
import { OwnerVipOrders } from '@/components/owner/OwnerVipOrders';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED  = '#E8192C';
const T1   = 'rgba(255,255,255,0.96)';
const T3   = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';

const ALL_TABS = [
  { key: 'drinks',  labelKey: 'owner.drinks', fallback: 'Drinks',     Icon: Wine   },
  { key: 'tickets', labelKey: null,           fallback: 'Tickets',    Icon: Ticket },
  { key: 'vip',     labelKey: null,           fallback: 'VIP Tables', Icon: Crown  },
] as const;

type TabKey = typeof ALL_TABS[number]['key'];

export default function OwnerOrders() {
  const { t } = useLanguage();
  const { venueId, organizerUserId, scope, loading: venueLoading } = useVenueContext();
  const isOrganizerScope = scope === 'organizer';
  const [searchParams] = useSearchParams();
  // Notification deep-link: jump to a tab and auto-open a specific order's detail.
  const focusOrderId = searchParams.get('focus') ?? undefined;

  // Organizers don't run a bar — no drinks tab. They sell tickets + VIP tables.
  const tabs = useMemo(
    () => (isOrganizerScope ? ALL_TABS.filter((tb) => tb.key !== 'drinks') : ALL_TABS),
    [isOrganizerScope],
  );

  const defaultTab: TabKey = isOrganizerScope ? 'tickets' : 'drinks';
  const requestedTab = searchParams.get('tab') as TabKey | null;
  const validRequestedTab = requestedTab && tabs.some((tb) => tb.key === requestedTab) ? requestedTab : null;
  const [activeTab, setActiveTab] = useState<TabKey>(validRequestedTab ?? defaultTab);

  // Keep the tab in sync when the URL changes (e.g. clicking another notification
  // while this page is already open).
  useEffect(() => {
    if (validRequestedTab) setActiveTab(validRequestedTab);
  }, [validRequestedTab]);

  // Organizer scope: gather the event ids this organizer can see sales for —
  // events they lead, plus club-led co-events they partner on (except org_hosted,
  // where the club alone manages sales). Mirrors the ticketing scope, minus the
  // date filter (orders are a full sales history, past events included).
  const [orgEventIds, setOrgEventIds] = useState<string[] | null>(null);
  useEffect(() => {
    if (!isOrganizerScope || !organizerUserId) return;
    let active = true;
    (async () => {
      const { data } = await supabase
        .from('events')
        .select('id')
        .or(`organizer_user_id.eq.${organizerUserId},and(partner_organizer_id.eq.${organizerUserId},event_mode.neq.org_hosted)`);
      if (active) setOrgEventIds((data ?? []).map((e: any) => e.id));
    })();
    return () => { active = false; };
  }, [isOrganizerScope, organizerUserId]);

  if (isOrganizerScope) {
    if (!organizerUserId) return <OwnerPageSkeleton />;
  } else if (venueLoading || !venueId) {
    return <OwnerPageSkeleton />;
  }

  const orgReady = !isOrganizerScope || orgEventIds !== null;

  const tabContent = (
    <>
      {activeTab === 'drinks' && venueId && <OwnerDrinkOrders venueId={venueId} focusOrderId={focusOrderId} />}
      {activeTab === 'tickets' && (
        isOrganizerScope
          ? <OwnerTicketOrders eventIds={orgEventIds ?? []} focusOrderId={focusOrderId} />
          : <OwnerTicketOrders venueId={venueId} focusOrderId={focusOrderId} />
      )}
      {activeTab === 'vip' && (
        isOrganizerScope
          ? <OwnerVipOrders eventIds={orgEventIds ?? []} focusOrderId={focusOrderId} />
          : <OwnerVipOrders venueId={venueId} focusOrderId={focusOrderId} />
      )}
    </>
  );

  return (
    <div className={isOrganizerScope ? '' : 'min-h-screen pb-28'} style={isOrganizerScope ? undefined : { background: '#000' }}>
      {/* Ambient vignette (venue scope only — org scope inherits the app layout). */}
      {!isOrganizerScope && (
        <div className="fixed inset-0 pointer-events-none z-0"
          style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(255,255,255,.025),transparent 55%)' }} />
      )}

      {!isOrganizerScope && <OwnerHeader title={t('owner.ordersManagement')} />}

      <div className="relative z-10 mx-auto max-w-[1340px] px-4 sm:px-6 pt-4 sm:pt-2">
        {/* Org scope has no OwnerHeader — give the page its own title. */}
        {isOrganizerScope && (
          <h1 className="mb-5 text-[20px] font-semibold tracking-[-0.01em]" style={{ color: T1 }}>
            {t('owner.ordersManagement')}
          </h1>
        )}

        {/* Tab bar */}
        <div className="flex gap-0.5 mb-5" style={{ borderBottom: `1px solid ${BORDER}` }}>
          {tabs.map(({ key, labelKey, fallback, Icon }) => (
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
        {!orgReady ? (
          <div className="flex items-center justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-2" style={{ borderColor: `${BORDER} ${BORDER} ${BORDER} ${RED}` }} />
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
            >
              {tabContent}
            </motion.div>
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
