import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Rocket, Globe, Link2, Users, BarChart2, Send, ListChecks, Wallet,
  Building2, Settings, ChevronDown, Search, CalendarDays, MessageSquare,
  Landmark, FileSignature, UserPlus, Shield, type LucideIcon,
} from 'lucide-react';

import { useLanguage } from '@/contexts/LanguageContext';
import { useAffiliateShell } from '@/contexts/AffiliateShellContext';
import {
  AffPage, AffHeading, AffCard, RED, T1, T2, T3, BORDER, C_FAINT,
} from '@/components/affiliate/affiliate-ui';

type ManualArticle = { id: string; icon: LucideIcon; titleKey: string; bodyKey: string };
type ManualChapter = { id: string; icon: LucideIcon; labelKey: string; articles: ManualArticle[] };

/**
 * Mode d'emploi complet de l'espace agence — même ambition que le centre
 * d'aide owner : chapitres calqués sur la sidebar, articles détaillés pas à
 * pas, recherche plein texte. Le chef d'agence (et les managers) voient tout ;
 * les promoteurs voient leur parcours.
 */
const CHAPTERS: ManualChapter[] = [
  {
    id: 'start',
    icon: Rocket,
    labelKey: 'aff.manual.cat.start',
    articles: [
      { id: 'model', icon: Globe, titleKey: 'aff.manual.model.title', bodyKey: 'aff.manual.model.body' },
      { id: 'firstSteps', icon: ListChecks, titleKey: 'aff.manual.firstSteps.title', bodyKey: 'aff.manual.firstSteps.body' },
    ],
  },
  {
    id: 'team',
    icon: Users,
    labelKey: 'aff.manual.cat.team',
    articles: [
      { id: 'invite', icon: UserPlus, titleKey: 'aff.manual.invite.title', bodyKey: 'aff.manual.invite.body' },
      { id: 'groupsRules', icon: Shield, titleKey: 'aff.manual.groupsRules.title', bodyKey: 'aff.manual.groupsRules.body' },
      { id: 'assignments', icon: CalendarDays, titleKey: 'aff.manual.assignments.title', bodyKey: 'aff.manual.assignments.body' },
      { id: 'tracking', icon: MessageSquare, titleKey: 'aff.manual.tracking.title', bodyKey: 'aff.manual.tracking.body' },
    ],
  },
  {
    id: 'yuno',
    icon: Building2,
    labelKey: 'aff.manual.cat.yuno',
    articles: [
      { id: 'contracts', icon: FileSignature, titleKey: 'aff.manual.contracts.title', bodyKey: 'aff.manual.contracts.body' },
      { id: 'events', icon: CalendarDays, titleKey: 'aff.manual.events.title', bodyKey: 'aff.manual.events.body' },
      { id: 'stats', icon: BarChart2, titleKey: 'aff.manual.stats.title', bodyKey: 'aff.manual.stats.body' },
      { id: 'finance', icon: Landmark, titleKey: 'aff.manual.finance.title', bodyKey: 'aff.manual.finance.body' },
    ],
  },
  {
    id: 'external',
    icon: Globe,
    labelKey: 'aff.manual.cat.external',
    articles: [
      { id: 'extCatalog', icon: Building2, titleKey: 'aff.manual.extCatalog.title', bodyKey: 'aff.manual.extCatalog.body' },
      { id: 'linktree', icon: Link2, titleKey: 'aff.manual.linktree.title', bodyKey: 'aff.manual.linktree.body' },
      { id: 'traffic', icon: BarChart2, titleKey: 'aff.manual.traffic.title', bodyKey: 'aff.manual.traffic.body' },
    ],
  },
  {
    id: 'settings',
    icon: Settings,
    labelKey: 'aff.manual.cat.settings',
    articles: [
      { id: 'profile', icon: Settings, titleKey: 'aff.manual.profile.title', bodyKey: 'aff.manual.profile.body' },
    ],
  },
];

const MEMBER_SECTIONS: ManualArticle[] = [
  { id: 'mySpace', icon: Send, titleKey: 'aff.help.mySpace.title', bodyKey: 'aff.help.mySpace.body' },
  { id: 'myLinktree', icon: ListChecks, titleKey: 'aff.help.myLinktree.title', bodyKey: 'aff.help.myLinktree.body' },
  { id: 'myStats', icon: BarChart2, titleKey: 'aff.help.myStats.title', bodyKey: 'aff.help.myStats.body' },
  { id: 'myPayout', icon: Wallet, titleKey: 'aff.manual.myPayout.title', bodyKey: 'aff.manual.myPayout.body' },
];

function ArticleCard({ article, defaultOpen }: { article: ManualArticle; defaultOpen?: boolean }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <AffCard padding={0}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 text-left"
        style={{ padding: '14px 16px', cursor: 'pointer', background: 'none', border: 'none', outline: 'none' }}
      >
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-none"
          style={{ background: C_FAINT, border: `1px solid ${BORDER}` }}>
          <article.icon className="h-4 w-4" style={{ color: T2 }} />
        </div>
        <p className="flex-1 min-w-0" style={{ color: T1, fontSize: 13.5, fontWeight: 620 }}>{t(article.titleKey)}</p>
        <ChevronDown
          className="h-4 w-4 flex-none"
          style={{ color: T3, transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 150ms ease' }}
        />
      </button>
      {open && (
        <div style={{ padding: '0 16px 16px 60px' }}>
          <p style={{ color: T2, fontSize: 12.5, lineHeight: 1.65, whiteSpace: 'pre-line', margin: 0 }}>
            {t(article.bodyKey)}
          </p>
        </div>
      )}
    </AffCard>
  );
}

export default function AffiliateHelp() {
  const { t } = useLanguage();
  const shell = useAffiliateShell();
  const isTeamView = shell?.role === 'member';
  const [query, setQuery] = useState('');

  // Recherche plein texte sur titres + corps, dans la langue active.
  const filteredChapters = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return CHAPTERS;
    return CHAPTERS
      .map(ch => ({
        ...ch,
        articles: ch.articles.filter(a =>
          t(a.titleKey).toLowerCase().includes(q) || t(a.bodyKey).toLowerCase().includes(q)
        ),
      }))
      .filter(ch => ch.articles.length > 0);
  }, [query, t]);

  if (isTeamView) {
    return (
      <AffPage maxWidth={760}>
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <AffHeading title={t('aff.help.title')} subtitle={t('aff.help.subtitle')} />
        </motion.div>
        <div className="space-y-3">
          {MEMBER_SECTIONS.map((s, i) => (
            <motion.div key={s.id}
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 + i * 0.04 }}>
              <ArticleCard article={s} defaultOpen={i === 0} />
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

  return (
    <AffPage maxWidth={760}>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <AffHeading title={t('aff.manual.title')} subtitle={t('aff.manual.subtitle')} />
      </motion.div>

      {/* Recherche */}
      <div className="relative">
        <Search className="h-4 w-4 absolute" style={{ color: T3, left: 14, top: '50%', transform: 'translateY(-50%)' }} />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t('aff.manual.searchPh')}
          className="w-full outline-none"
          style={{
            background: C_FAINT, border: `1px solid ${BORDER}`, borderRadius: 12,
            padding: '11px 14px 11px 40px', color: T1, fontSize: 13.5,
          }}
        />
      </div>

      {filteredChapters.length === 0 ? (
        <p style={{ color: T3, fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
          {t('aff.manual.noResults')}
        </p>
      ) : (
        filteredChapters.map((ch, ci) => (
          <div key={ch.id} className="space-y-2">
            <motion.div
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.03 + ci * 0.03 }}
              className="flex items-center gap-2"
              style={{ marginTop: ci > 0 ? 10 : 0 }}
            >
              <ch.icon className="h-4 w-4" style={{ color: RED }} />
              <p style={{
                color: T3, fontSize: 11.5, fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0,
              }}>
                {t(ch.labelKey)}
              </p>
            </motion.div>
            {ch.articles.map(a => (
              <ArticleCard key={a.id} article={a} defaultOpen={!!query.trim()} />
            ))}
          </div>
        ))
      )}

      <p style={{ color: T2, fontSize: 12 }}>
        {t('aff.help.contact')}{' '}
        <a href="mailto:support@yunoapp.eu" style={{ color: RED, fontWeight: 600 }}>support@yunoapp.eu</a>
      </p>
    </AffPage>
  );
}
