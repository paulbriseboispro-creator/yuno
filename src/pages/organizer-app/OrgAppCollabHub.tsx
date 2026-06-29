import { useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Handshake, Calendar, Building2, UserPlus } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { OrgPage, RED, T1, T3, F_BORDER } from '@/components/org-ui';
import { CollabEventsTab } from '@/components/organizer-app/collab/CollabEventsTab';
import { PartnerClubsTab } from '@/components/organizer-app/collab/PartnerClubsTab';
import { InviteClubTab } from '@/components/organizer-app/collab/InviteClubTab';

/**
 * Organizer Collaborations hub — single tabbed page mirroring the club's
 * /owner/collaborations. Three tabs driven by ?tab=: co-events (Soirées),
 * partner-club management (Clubs partenaires), and inviting an external club
 * (Inviter). Replaces the previously split /organizer-app/partners +
 * /organizer-app/collaborations pages so both entities share the same UX shape.
 */
export default function OrgAppCollabHub() {
  const { language } = useLanguage();
  const t = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'events';

  const TABS = [
    { value: 'events', label: t('Soirées', 'Events', 'Eventos'), Icon: Calendar },
    { value: 'partners', label: t('Clubs partenaires', 'Partner clubs', 'Clubes asociados'), Icon: Building2 },
    { value: 'invite', label: t('Inviter', 'Invite', 'Invitar'), Icon: UserPlus },
  ];

  return (
    <OrgPage className="mx-auto max-w-[1340px]">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="flex items-center gap-2" style={{ color: T1, fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>
          <Handshake className="h-5 w-5 flex-none" style={{ color: RED }} />
          {t('Collaborations', 'Collaborations', 'Colaboraciones')}
        </h1>
        <p style={{ color: T3, fontSize: 13, marginTop: 4 }}>
          {t(
            'Gère tes clubs partenaires et les soirées co-organisées.',
            'Manage your partner clubs and co-hosted events.',
            'Gestiona tus clubes asociados y los eventos coorganizados.',
          )}
        </p>
      </motion.div>

      {/* Tab bar */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="mt-5">
        <div className="relative flex" style={{ borderBottom: `1px solid ${F_BORDER}`, gap: 0 }}>
          {TABS.map(({ value, label, Icon }) => {
            const active = tab === value;
            return (
              <button
                key={value}
                onClick={() => setParams({ tab: value })}
                className="relative flex items-center gap-1.5 cursor-pointer transition-colors duration-150"
                style={{ padding: '10px 16px', color: active ? T1 : T3, fontSize: 13.5, fontWeight: active ? 640 : 500, background: 'transparent', border: 'none', marginBottom: -1 }}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
                {active && (
                  <motion.div
                    layoutId="org-collab-tab-indicator"
                    className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full"
                    style={{ background: RED, boxShadow: '0 0 8px rgba(232,25,44,0.5)' }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </motion.div>

      {/* Tab content */}
      <div className="mt-5">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
          >
            {tab === 'events' && <CollabEventsTab />}
            {tab === 'partners' && <PartnerClubsTab />}
            {tab === 'invite' && <InviteClubTab />}
          </motion.div>
        </AnimatePresence>
      </div>
    </OrgPage>
  );
}
