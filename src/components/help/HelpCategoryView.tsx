import { motion } from 'framer-motion';
import { Zap } from 'lucide-react';
import type { OwnerHelpArticle, OwnerHelpCategory } from '@/data/ownerHelpContent';
import { transitions, useReducedMotion } from '@/lib/motion';
import { ArticleRow, BORDER, HCard, IconTile, INNER_BG, Kicker, Pill, T1, T2, T3, articleCountLabel, articleReadMinutes, fmt } from './helpUi';

type T = (k: string) => string;

export function HelpCategoryView({
  t, category, categories, onOpenArticle, onOpenCategory,
}: {
  t: T;
  category: OwnerHelpCategory;
  categories: OwnerHelpCategory[];
  onOpenArticle: (article: OwnerHelpArticle) => void;
  onOpenCategory: (id: string) => void;
}) {
  const reduced = useReducedMotion();
  const others = categories.filter((c) => c.id !== category.id);
  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={{ ...transitions.reveal, duration: 0.3 }}
      className="space-y-4 pt-4 sm:pt-8"
    >
      {/* En-tête du thème */}
      <div className="flex items-center gap-4">
        <IconTile name={category.icon} size={52} accent />
        <div className="min-w-0">
          <Kicker>{t('ohelp.ui.guidesKicker')}</Kicker>
          <h1 className="truncate" style={{ color: T1, fontSize: 'clamp(22px,3vw,30px)', fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.15, margin: '2px 0 0' }}>
            {t(category.labelKey)}
          </h1>
          <p style={{ color: T3, fontSize: 12.5, marginTop: 4 }}>{articleCountLabel(t, category.articles.length)}</p>
        </div>
      </div>

      <HCard style={{ padding: 20 }}>
        <div className="space-y-2">
          {category.articles.map((article, i) => (
            <motion.div
              key={article.id}
              initial={reduced ? { opacity: 0 } : { opacity: 0, x: -6 }}
              animate={reduced ? { opacity: 1 } : { opacity: 1, x: 0 }}
              transition={{ ...transitions.pop, delay: 0.03 + i * 0.03 }}
              className="flex items-center gap-3"
            >
              <span className="hidden sm:block tabular-nums flex-none w-6 text-right" style={{ color: T3, fontSize: 12.5 }}>
                {String(i + 1).padStart(2, '0')}
              </span>
              <div className="flex-1 min-w-0">
                <ArticleRow
                  icon={article.icon}
                  title={t(article.titleKey)}
                  desc={t(article.descKey)}
                  meta={
                    <>
                      <span style={{ color: T3, fontSize: 11.5 }}>{fmt(t('ohelp.ui.readTime'), { n: articleReadMinutes(article, t) })}</span>
                      {article.quickStart && (
                        <Pill hot style={{ padding: '2px 8px', fontSize: 10.5 }}>
                          <Zap style={{ width: 11, height: 11 }} aria-hidden="true" />
                          {t('ohelp.ui.quickStartBadge')}
                        </Pill>
                      )}
                    </>
                  }
                  onClick={() => onOpenArticle(article)}
                />
              </div>
            </motion.div>
          ))}
        </div>
      </HCard>

      {others.length > 0 && (
        <div style={{ padding: '4px 2px' }}>
          <Kicker>{t('ohelp.ui.otherCategories')}</Kicker>
          <div className="flex flex-wrap gap-2 mt-3">
            {others.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onOpenCategory(c.id)}
                className="inline-flex items-center gap-2 cursor-pointer transition-all duration-150 hover:bg-white/[0.06] hover:border-white/20"
                style={{ padding: '7px 12px 7px 9px', borderRadius: 999, border: `1px solid ${BORDER}`, background: INNER_BG, color: T2, fontSize: 12.5, fontWeight: 500 }}
              >
                <IconTile name={c.icon} size={22} />
                {t(c.labelKey)}
                <span style={{ color: T3, fontSize: 11 }}>{c.articles.length}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}
