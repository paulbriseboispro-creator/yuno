import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Clock, Search, SearchX, X } from 'lucide-react';
import type { OwnerHelpArticle, OwnerHelpCategory } from '@/data/ownerHelpContent';
import { searchHelp, searchTokens } from '@/lib/helpSearch';
import { transitions, useReducedMotion } from '@/lib/motion';
import { AskAiRow } from './HelpAskAi';
import { HelpAiChat, type HelpAiChatHandle } from './HelpAiChat';
import { HelpSupportCards } from './HelpSupportCards';
import {
  ArticleRow, BORDER, C_FAINT, HCard, Highlight, IconTile, INNER_BG, Kicker, Pill, SectionHead,
  T1, T2, T3, articleCountLabel, articleReadMinutes, categoryColor, fmt, rgba,
} from './helpUi';

type T = (k: string) => string;

// ─── Barre de recherche ───────────────────────────────────────────────────────
function SearchBox({ t, value, onChange, onEnter, inputRef }: {
  t: T; value: string; onChange: (v: string) => void; onEnter: () => void; inputRef: React.RefObject<HTMLInputElement>;
}) {
  const [focus, setFocus] = useState(false);
  return (
    <div
      className="flex items-center gap-2.5 pl-4 pr-2 transition-all duration-150"
      style={{
        height: 52,
        borderRadius: 14,
        background: focus ? 'rgb(var(--ink)/0.05)' : INNER_BG,
        border: `1px solid ${focus ? 'rgba(232,25,44,0.5)' : 'rgb(var(--ink)/0.12)'}`,
        boxShadow: focus ? '0 0 0 4px rgba(232,25,44,0.10), 0 18px 40px -28px rgba(0,0,0,.9)' : '0 18px 40px -28px rgba(0,0,0,.9)',
      }}
    >
      <Search style={{ width: 18, height: 18, color: focus ? T1 : T3 }} className="flex-none" aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        enterKeyHint="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter(); } if (e.key === 'Escape') onChange(''); }}
        placeholder={t('ohelp.ui.searchPlaceholder')}
        aria-label={t('ohelp.ui.searchPlaceholder')}
        autoComplete="off"
        className="flex-1 min-w-0 bg-transparent outline-none [&::-webkit-search-cancel-button]:hidden"
        style={{ color: T1, fontSize: 15 }}
      />
      {value ? (
        <button
          type="button"
          onClick={() => { onChange(''); inputRef.current?.focus(); }}
          aria-label={t('ohelp.ui.clearSearch')}
          className="flex-none flex items-center justify-center cursor-pointer transition-colors hover:bg-white/[0.08]"
          style={{ width: 32, height: 32, borderRadius: 9, color: T2 }}
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      ) : (
        <kbd
          className="hidden sm:inline-flex items-center justify-center flex-none"
          style={{ height: 24, minWidth: 24, padding: '0 7px', borderRadius: 7, border: `1px solid ${BORDER}`, background: C_FAINT, color: T3, fontSize: 11.5, fontFamily: 'inherit' }}
          title={t('ohelp.ui.searchKbdHint')}
        >
          /
        </kbd>
      )}
    </div>
  );
}

// ─── Tuile de thème ───────────────────────────────────────────────────────────
function CategoryTile({ t, category, onClick, index, reduced }: {
  t: T; category: OwnerHelpCategory; onClick: () => void; index: number; reduced: boolean | null;
}) {
  const [hover, setHover] = useState(false);
  const color = categoryColor(category.id);
  return (
    <motion.button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={{ ...transitions.pop, delay: 0.04 + index * 0.03 }}
      className="relative overflow-hidden flex flex-col items-start gap-3 text-left cursor-pointer transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-[#E8192C]/60"
      style={{
        padding: '18px 18px 16px',
        borderRadius: 16,
        background: `radial-gradient(ellipse 80% 60% at 0% 0%, ${rgba(color, hover ? 0.18 : 0.09)} 0%, transparent 60%), ${hover ? 'rgb(var(--ink)/0.045)' : INNER_BG}`,
        border: `1px solid ${hover ? rgba(color, 0.42) : rgba(color, 0.18)}`,
        minHeight: 118,
      }}
    >
      <IconTile name={category.icon} size={38} accent={hover} color={color} />
      <div className="min-w-0 w-full">
        <div className="truncate" style={{ color: T1, fontSize: 14.5, fontWeight: 600, letterSpacing: '-0.005em' }}>{t(category.labelKey)}</div>
        <div style={{ color: hover ? T2 : T3, fontSize: 12, marginTop: 3 }} className="transition-colors duration-150">
          {articleCountLabel(t, category.articles.length)}
        </div>
      </div>
    </motion.button>
  );
}

// ─── Accueil ──────────────────────────────────────────────────────────────────
export function HelpHome({
  t, categories, query, onQueryChange, onOpenArticle, onOpenCategory, onContact, recentIds, scope, language, basePath,
}: {
  t: T;
  categories: OwnerHelpCategory[];
  query: string;
  onQueryChange: (q: string) => void;
  onOpenArticle: (article: OwnerHelpArticle, sectionIndex?: number) => void;
  onOpenCategory: (id: string) => void;
  onContact: () => void;
  recentIds: string[];
  scope: string;
  language: string;
  basePath: string;
}) {
  const reduced = useReducedMotion();
  const inputRef = useRef<HTMLInputElement>(null);
  const chatRef = useRef<HelpAiChatHandle>(null);

  // « / » focalise la recherche depuis n'importe où sur la page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) { e.preventDefault(); inputRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const allArticles = useMemo(() => categories.flatMap((c) => c.articles.map((a) => ({ article: a, category: c }))), [categories]);
  const results = useMemo(() => searchHelp(categories, query, t), [categories, query, t]);
  const tokens = useMemo(() => searchTokens(query), [query]);
  const searching = query.trim().length >= 2;

  const popular = useMemo(() => {
    const quick = allArticles.filter((x) => x.article.quickStart);
    const fill = allArticles.filter((x) => !x.article.quickStart);
    return [...quick, ...fill].slice(0, 6);
  }, [allArticles]);

  const recent = useMemo(
    () => recentIds.map((id) => allArticles.find((x) => x.article.id === id)).filter((x): x is { article: OwnerHelpArticle; category: OwnerHelpCategory } => Boolean(x)).slice(0, 4),
    [recentIds, allArticles],
  );

  // Suggestions de l'assistant : les premiers guides de démarrage, dans la langue.
  const chips = useMemo(
    () => popular.slice(0, 3).map(({ article }) => ({ label: t(article.titleKey), prompt: fmt(t('ohelp.ui.aiExplainPrompt'), { title: t(article.titleKey) }) })),
    [popular, t],
  );

  const fade = (delay: number) => ({
    initial: reduced ? { opacity: 0 } : { opacity: 0, y: 10 },
    animate: reduced ? { opacity: 1 } : { opacity: 1, y: 0 },
    transition: { ...transitions.reveal, duration: 0.35, delay },
  });

  const chat = (
    <HelpAiChat ref={chatRef} t={t} scope={scope} language={language} categories={categories} basePath={basePath} chips={chips} />
  );

  return (
    <div className="space-y-4">
      {/* ── Héros : titre + recherche ── */}
      <motion.div {...fade(0)} className="text-center pt-4 sm:pt-10 pb-2">
        <h1 style={{ color: T1, fontSize: 'clamp(26px,4vw,38px)', fontWeight: 600, letterSpacing: '-0.025em', lineHeight: 1.1, margin: 0 }}>
          {t('ohelp.ui.heroTitle')}
        </h1>
        <p className="mx-auto" style={{ color: T2, fontSize: 15, marginTop: 10, maxWidth: 520, lineHeight: 1.5 }}>
          {t('ohelp.ui.heroSub')}
        </p>
        <div className="mx-auto mt-6" style={{ maxWidth: 600 }}>
          <SearchBox
            t={t}
            value={query}
            onChange={onQueryChange}
            inputRef={inputRef}
            onEnter={() => { if (results[0]) onOpenArticle(results[0].article, results[0].sectionIndex >= 0 ? results[0].sectionIndex : undefined); }}
          />
        </div>
      </motion.div>

      {searching ? (
        /* ── Résultats ── */
        <motion.div key="results" {...fade(0)} className="space-y-4">
          <HCard style={{ padding: 20 }}>
            <SectionHead
              title={results.length === 1 ? fmt(t('ohelp.ui.resultsForOne'), { q: query.trim() }) : fmt(t('ohelp.ui.resultsFor'), { n: results.length, q: query.trim() })}
            />
            {results.length > 0 ? (
              <div className="space-y-2">
                {results.map((r) => (
                  <ArticleRow
                    key={r.article.id}
                    icon={r.article.icon}
                    color={categoryColor(r.category.id)}
                    title={<Highlight text={t(r.article.titleKey)} tokens={tokens} />}
                    desc={<Highlight text={r.snippet} tokens={tokens} />}
                    meta={
                      <>
                        <Pill color={categoryColor(r.category.id)}>{t(r.category.labelKey)}</Pill>
                        {r.sectionHeading && <span style={{ color: T3, fontSize: 11.5 }}>{fmt(t('ohelp.ui.inSection'), { h: r.sectionHeading })}</span>}
                      </>
                    }
                    onClick={() => onOpenArticle(r.article, r.sectionIndex >= 0 ? r.sectionIndex : undefined)}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-8 px-4">
                <SearchX className="h-9 w-9 mx-auto mb-3" style={{ color: 'rgb(var(--ink)/0.14)' }} aria-hidden="true" />
                <p style={{ color: T1, fontSize: 14.5, fontWeight: 600 }}>{t('ohelp.ui.noResultsTitle')}</p>
                <p className="mx-auto" style={{ color: T3, fontSize: 13, marginTop: 4, maxWidth: 380 }}>{t('ohelp.ui.noResultsDesc')}</p>
              </div>
            )}
            <div className="mt-3">
              <AskAiRow t={t} query={query.trim()} onAsk={(q) => chatRef.current?.ask(q)} />
            </div>
          </HCard>
          {chat}
        </motion.div>
      ) : (
        <>
          {/* ── Reprendre ── */}
          {recent.length > 0 && (
            <motion.div {...fade(0.05)}>
              <HCard style={{ padding: '16px 20px' }}>
                <div className="flex items-center gap-2 mb-3">
                  <Clock className="w-3.5 h-3.5" style={{ color: T3 }} aria-hidden="true" />
                  <Kicker>{t('ohelp.ui.recent')}</Kicker>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {recent.map(({ article, category }) => (
                    <ArticleRow key={article.id} compact icon={article.icon} color={categoryColor(category.id)} title={t(article.titleKey)} desc={t(category.labelKey)} onClick={() => onOpenArticle(article)} />
                  ))}
                </div>
              </HCard>
            </motion.div>
          )}

          {/* ── Parcourir par thème ── */}
          <motion.div {...fade(0.08)}>
            <HCard style={{ padding: 20 }}>
              <SectionHead title={t('ohelp.ui.browseByCategory')} sub={t('ohelp.ui.browseSub')} />
              <div className="grid gap-3 grid-cols-2 lg:grid-cols-3">
                {categories.map((c, i) => (
                  <CategoryTile key={c.id} t={t} category={c} index={i} reduced={reduced} onClick={() => onOpenCategory(c.id)} />
                ))}
              </div>
            </HCard>
          </motion.div>

          {/* ── Articles populaires ── */}
          <motion.div {...fade(0.12)}>
            <HCard style={{ padding: 20 }}>
              <SectionHead title={t('ohelp.ui.popular')} sub={t('ohelp.ui.popularSub')} />
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {popular.map(({ article, category }) => (
                  <ArticleRow
                    key={article.id}
                    icon={article.icon}
                    color={categoryColor(category.id)}
                    title={t(article.titleKey)}
                    desc={t(article.descKey)}
                    meta={
                      <>
                        <span style={{ color: categoryColor(category.id), fontSize: 11.5, fontWeight: 600 }}>{t(category.labelKey)}</span>
                        <span style={{ color: 'rgb(var(--ink)/0.18)', fontSize: 11 }}>·</span>
                        <span style={{ color: T3, fontSize: 11.5 }}>{fmt(t('ohelp.ui.readTime'), { n: articleReadMinutes(article, t) })}</span>
                      </>
                    }
                    onClick={() => onOpenArticle(article)}
                  />
                ))}
              </div>
            </HCard>
          </motion.div>

          {/* ── Encore besoin d'aide ? ── */}
          <motion.div {...fade(0.16)}>
            <HCard glow style={{ padding: 20 }}>
              <SectionHead title={t('ohelp.ui.stillNeedHelp')} sub={t('ohelp.ui.stillNeedHelpSub')} />
              <div className="space-y-3">
                {chat}
                <HelpSupportCards t={t} onContact={onContact} />
              </div>
            </HCard>
          </motion.div>
        </>
      )}
    </div>
  );
}
