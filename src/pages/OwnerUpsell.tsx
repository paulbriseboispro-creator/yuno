import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { OwnerHeader } from '@/components/OwnerHeader';
import { OwnerPageSkeleton } from '@/components/DashboardSkeleton';
import { LanguageSelector } from '@/components/LanguageSelector';
import { useLanguage } from '@/contexts/LanguageContext';
import { useVenueContext } from '@/hooks/useVenueContext';
import { ShoppingCart, Percent, Ticket } from 'lucide-react';
import { OwnerUpsellCartRules } from '@/components/owner/upsell/OwnerUpsellCartRules';
import { OwnerUpsellPromos } from '@/components/owner/upsell/OwnerUpsellPromos';
import { OwnerUpsellTicketOffers } from '@/components/owner/upsell/OwnerUpsellTicketOffers';
import { CollabReadOnlyBanner } from '@/components/CollabReadOnlyBanner';
import { UPage, RED, T1, T3, BORDER } from '@/components/owner/upsell/upsell-ui';

type TabKey = 'ticket' | 'cart' | 'promos';

export default function OwnerUpsell() {
  const { t } = useLanguage();
  const { venueId, loading: venueLoading } = useVenueContext();
  const [activeTab, setActiveTab] = useState<TabKey>('ticket');

  if (venueLoading) return <OwnerPageSkeleton />;

  if (!venueId) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: '#000' }}>
        <p style={{ color: T3 }}>{t('owner.noVenueAssigned')}</p>
      </div>
    );
  }

  const tabs: { id: TabKey; label: string; shortLabel: string; icon: typeof Ticket }[] = [
    { id: 'ticket', label: t('owner.ups.tabTicket'), shortLabel: t('owner.ups.tabTicket'), icon: Ticket },
    { id: 'cart', label: t('upsell.tabCartOffers'), shortLabel: t('upsell.tabCartShort'), icon: ShoppingCart },
    { id: 'promos', label: t('upsell.tabPromos'), shortLabel: 'Promos', icon: Percent },
  ];

  return (
    <div className="min-h-screen" style={{ background: '#000' }}>
      <OwnerHeader
        title={t('upsell.title')}
        showBackButton={true}
        backTo="/owner/dashboard"
        rightContent={<LanguageSelector />}
      />

      <UPage maxWidth={960}>
        <CollabReadOnlyBanner action={t('collab.action.editUpsells')} />

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-[13px]"
          style={{ color: T3 }}
        >
          {t('upsell.subtitle')}
        </motion.p>

        {/* Tab bar (design system 6.3) */}
        <div className="flex gap-0.5" style={{ borderBottom: `1px solid ${BORDER}` }}>
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="relative inline-flex items-center gap-2 px-4 py-3 text-[13.5px] font-[560] transition-colors duration-150 cursor-pointer"
                style={{ color: isActive ? T1 : T3 }}
              >
                <Icon className="w-4 h-4" />
                <span className="hidden sm:inline">{tab.label}</span>
                <span className="sm:hidden">{tab.shortLabel}</span>
                {isActive && (
                  <span
                    className="absolute left-3 right-3 rounded-full"
                    style={{ bottom: -1, height: 2, background: RED, boxShadow: '0 0 10px rgba(232,25,44,0.6)' }}
                  />
                )}
              </button>
            );
          })}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
          >
            {activeTab === 'ticket' && <OwnerUpsellTicketOffers venueId={venueId} />}
            {activeTab === 'cart' && <OwnerUpsellCartRules venueId={venueId} />}
            {activeTab === 'promos' && <OwnerUpsellPromos venueId={venueId} />}
          </motion.div>
        </AnimatePresence>
      </UPage>
    </div>
  );
}
