import { motion } from 'framer-motion';
import {
  Globe, MapPin, Link2, Users, BarChart2, Bell, Send, ListChecks, Wallet,
  type LucideIcon,
} from 'lucide-react';

import { useLanguage } from '@/contexts/LanguageContext';
import { useAffiliateShell } from '@/contexts/AffiliateShellContext';
import {
  AffPage, AffHeading, AffCard, RED, T1, T2, BORDER, C_FAINT,
} from '@/components/affiliate/affiliate-ui';

type HelpSection = { icon: LucideIcon; titleKey: string; bodyKey: string; accent?: boolean };

const ADMIN_SECTIONS: HelpSection[] = [
  { icon: Globe,      titleKey: 'aff.help.model.title',     bodyKey: 'aff.help.model.body', accent: true },
  { icon: Wallet,     titleKey: 'aff.help.yunoClubs.title', bodyKey: 'aff.help.yunoClubs.body' },
  { icon: MapPin,     titleKey: 'aff.help.clubs.title',     bodyKey: 'aff.help.clubs.body' },
  { icon: Link2,      titleKey: 'aff.help.linktree.title',  bodyKey: 'aff.help.linktree.body' },
  { icon: Users,      titleKey: 'aff.help.team.title',      bodyKey: 'aff.help.team.body' },
  { icon: BarChart2,  titleKey: 'aff.help.analytics.title', bodyKey: 'aff.help.analytics.body' },
  { icon: Bell,       titleKey: 'aff.help.notifs.title',    bodyKey: 'aff.help.notifs.body' },
];

const MEMBER_SECTIONS: HelpSection[] = [
  { icon: Send,       titleKey: 'aff.help.mySpace.title',    bodyKey: 'aff.help.mySpace.body', accent: true },
  { icon: ListChecks, titleKey: 'aff.help.myLinktree.title', bodyKey: 'aff.help.myLinktree.body' },
  { icon: BarChart2,  titleKey: 'aff.help.myStats.title',    bodyKey: 'aff.help.myStats.body' },
];

/**
 * Mode d'emploi in-app de l'espace affilié. Le chef d'agence et les managers
 * voient le fonctionnement complet du modèle ; les promoteurs voient leur
 * parcours (assignations → lien promo → linktree → stats).
 */
export default function AffiliateHelp() {
  const { t } = useLanguage();
  const shell = useAffiliateShell();
  const isTeamView = shell?.role === 'member';
  const sections = isTeamView ? MEMBER_SECTIONS : ADMIN_SECTIONS;

  return (
    <AffPage maxWidth={760}>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <AffHeading title={t('aff.help.title')} subtitle={t('aff.help.subtitle')} />
      </motion.div>

      <div className="space-y-3">
        {sections.map((s, i) => (
          <motion.div key={s.titleKey}
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 + i * 0.04 }}>
            <AffCard padding={18}>
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-none mt-0.5"
                  style={s.accent
                    ? { background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.22)' }
                    : { background: C_FAINT, border: `1px solid ${BORDER}` }}>
                  <s.icon className="h-4 w-4" style={{ color: s.accent ? RED : T2 }} />
                </div>
                <div className="min-w-0">
                  <p style={{ color: T1, fontSize: 14, fontWeight: 600 }}>{t(s.titleKey)}</p>
                  <p style={{ color: T2, fontSize: 12.5, lineHeight: 1.6, marginTop: 4, whiteSpace: 'pre-line' }}>
                    {t(s.bodyKey)}
                  </p>
                </div>
              </div>
            </AffCard>
          </motion.div>
        ))}
      </div>

      <p style={{ color: T2, fontSize: 12 }}>
        {t('aff.help.contact')}{' '}
        <a href="mailto:support@yunoapp.eu" style={{ color: RED, fontWeight: 600 }}>support@yunoapp.eu</a>
      </p>
    </AffPage>
  );
}
